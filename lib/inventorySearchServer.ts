"use server";

import { errorText } from "@/lib/errors";
import { primaryStoragePath } from "@/lib/imageOrder";
import { signedImageUrls } from "@/lib/images";
import {
  applyInventoryStock,
  inventoryHits,
  inventoryQtyTotal,
  inventoryScanCap,
  inventoryStockMode,
  pageInventoryHits,
  parseInventoryPage,
  sortInventoryHits,
  type InventoryContentSource,
  type InventoryHit,
  type InventoryMatch,
  type InventorySort,
  type InventoryStock,
} from "@/lib/inventorySearch";
import { alnumQueryAlternatives } from "@/lib/itemAlnum";
import { labelTaxonomyFields } from "@/lib/labelLookup";
import { searchReceivingScan } from "@/lib/receivingActions";
import { scanSearchNote } from "@/lib/receivingScan";
import type { LabelItem } from "@/lib/types";
import { getSupabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export type InventorySearchResult =
  | {
      ok: true;
      query: string;
      note: string | null;
      /** The current page, already filtered and sorted. */
      hits: InventoryHit[];
      truncated: boolean;
      stock: InventoryStock;
      /** Rows after the qty filter. The summary count uses this. */
      matched: number;
      /** Rows before the qty filter. */
      scanned: number;
      /** For-sale qty of every filtered row, not only this page. Damaged pieces are not included. */
      totalQty: number;
      page: number;
      pages: number;
    }
  | { ok: false; message: string };

type ContentRow = {
  item_id?: unknown;
  qty?: unknown;
  damaged_qty?: unknown;
  bin_id?: unknown;
  cycle_id?: unknown;
};

type ItemRow = {
  id: string;
  sku: string | null;
  name: string | null;
  description: string | null;
  taxonomies: unknown;
  item_images: unknown;
};

const RANGE = 1000;
const ITEM_CHUNK = 80;
const ITEM_COLUMNS = "id, sku, name, description, taxonomies(short_code, long_code, name), item_images(storage_path, sort_order)";

function missingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST204" || error.code === "42703";
}

function chunks(ids: string[]): string[][] {
  const parts: string[][] = [];
  for (let start = 0; start < ids.length; start += ITEM_CHUNK) parts.push(ids.slice(start, start + ITEM_CHUNK));
  return parts;
}

async function eachRange<T>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string; code?: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += RANGE) {
    const result = await load(from, from + RANGE - 1);
    if (result.error) throw new Error(errorText(result.error));
    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length < RANGE) break;
  }
  return rows;
}

function imageRows(value: unknown): { storage_path: string; sort_order: number }[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as { storage_path?: unknown; sort_order?: unknown };
    const path = String(record.storage_path ?? "").trim();
    if (!path) return [];
    const sort = Number(record.sort_order);
    return [{ storage_path: path, sort_order: Number.isFinite(sort) ? sort : 0 }];
  });
}

function toMatch(row: ItemRow): InventoryMatch {
  const taxonomy = labelTaxonomyFields(row.taxonomies);
  return {
    id: row.id,
    sku: row.sku?.trim() ?? "",
    name: row.name?.trim() ?? "",
    description: row.description ?? "",
    shortCode: taxonomy.shortCode,
    longCode: taxonomy.longCode,
    taxonomyName: taxonomy.taxonomyName,
    imagePath: primaryStoragePath(imageRows(row.item_images)),
  };
}

function sortMatchesBySku(matches: readonly InventoryMatch[]): InventoryMatch[] {
  return [...matches].sort(
    (left, right) =>
      left.sku.localeCompare(right.sku, "en", { numeric: true, sensitivity: "base" }) ||
      left.id.localeCompare(right.id),
  );
}

async function itemMatchesByIds(supabase: SupabaseClient, itemIds: string[]): Promise<InventoryMatch[]> {
  const ids = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const parts = await Promise.all(
    chunks(ids).map(async (chunk) => {
      const result = await supabase.from("items").select(ITEM_COLUMNS).in("id", chunk);
      if (result.error) throw new Error(errorText(result.error));
      return ((result.data ?? []) as unknown as ItemRow[]).map(toMatch);
    }),
  );
  const byId = new Map(parts.flat().map((match) => [match.id, match]));
  return ids.flatMap((id) => {
    const match = byId.get(id);
    return match ? [match] : [];
  });
}

async function allItemMatches(supabase: SupabaseClient): Promise<InventoryMatch[]> {
  const rows = await eachRange((from, to) =>
    supabase.from("items").select(ITEM_COLUMNS).order("id", { ascending: true }).range(from, to),
  );
  return (rows as unknown as ItemRow[]).map(toMatch);
}

async function primaryImages(supabase: SupabaseClient, itemIds: string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
  const grouped = new Map<string, { storage_path: string; sort_order: number }[]>();
  if (ids.length === 0) return new Map();
  const parts = await Promise.all(
    chunks(ids).map(async (chunk) => {
      const result = await supabase.from("item_images").select("item_id, storage_path, sort_order").in("item_id", chunk);
      if (result.error) throw new Error(errorText(result.error));
      return result.data ?? [];
    }),
  );
  for (const row of parts.flat()) {
    const itemId = String(row.item_id ?? "");
    const path = String(row.storage_path ?? "").trim();
    if (!itemId || !path) continue;
    const sort = Number(row.sort_order);
    const list = grouped.get(itemId) ?? [];
    list.push({ storage_path: path, sort_order: Number.isFinite(sort) ? sort : 0 });
    grouped.set(itemId, list);
  }
  return new Map(ids.map((id) => [id, primaryStoragePath(grouped.get(id) ?? [])]));
}

/**
 * Open bin cycles only. For-sale quantity is `bin_contents.qty`. `damaged_qty` is
 * tracked and is not added to that quantity.
 */
async function contentRowsForItems(supabase: SupabaseClient, itemIds: string[]): Promise<ContentRow[]> {
  const ids = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const parts = await Promise.all(chunks(ids).map((chunk) => contentRowsIn(supabase, chunk)));
  return parts.flat();
}

async function contentRowsIn(supabase: SupabaseClient, itemIds: string[]): Promise<ContentRow[]> {
  const withDamaged = await supabase
    .from("bin_contents")
    .select("item_id, qty, damaged_qty, bin_id, cycle_id")
    .in("item_id", itemIds)
    .or("qty.gt.0,damaged_qty.gt.0")
    .order("id", { ascending: true })
    .range(0, 0);
  if (withDamaged.error && missingColumn(withDamaged.error)) {
    return eachRange((from, to) =>
      supabase
        .from("bin_contents")
        .select("item_id, qty, bin_id, cycle_id")
        .in("item_id", itemIds)
        .gt("qty", 0)
        .order("id", { ascending: true })
        .range(from, to),
    );
  }
  if (withDamaged.error) throw new Error(errorText(withDamaged.error));
  return eachRange((from, to) =>
    supabase
      .from("bin_contents")
      .select("item_id, qty, damaged_qty, bin_id, cycle_id")
      .in("item_id", itemIds)
      .or("qty.gt.0,damaged_qty.gt.0")
      .order("id", { ascending: true })
      .range(from, to),
  );
}

async function allContentRows(supabase: SupabaseClient): Promise<ContentRow[]> {
  const probe = await supabase
    .from("bin_contents")
    .select("item_id, qty, damaged_qty, bin_id, cycle_id")
    .or("qty.gt.0,damaged_qty.gt.0")
    .order("id", { ascending: true })
    .range(0, 0);
  if (probe.error && missingColumn(probe.error)) {
    return eachRange((from, to) =>
      supabase
        .from("bin_contents")
        .select("item_id, qty, bin_id, cycle_id")
        .gt("qty", 0)
        .order("id", { ascending: true })
        .range(from, to),
    );
  }
  if (probe.error) throw new Error(errorText(probe.error));
  return eachRange((from, to) =>
    supabase
      .from("bin_contents")
      .select("item_id, qty, damaged_qty, bin_id, cycle_id")
      .or("qty.gt.0,damaged_qty.gt.0")
      .order("id", { ascending: true })
      .range(from, to),
  );
}

async function hydrateContents(supabase: SupabaseClient, rows: ContentRow[]): Promise<InventoryContentSource[]> {
  if (rows.length === 0) return [];
  const cycleIds = [...new Set(rows.map((row) => String(row.cycle_id ?? "")).filter(Boolean))];
  const binIds = [...new Set(rows.map((row) => String(row.bin_id ?? "")).filter(Boolean))];
  const [cycleParts, binParts] = await Promise.all([
    Promise.all(
      chunks(cycleIds).map(async (chunk) => {
        const result = await supabase.from("bin_cycles").select("id, status").in("id", chunk);
        if (result.error) throw new Error(errorText(result.error));
        return result.data ?? [];
      }),
    ),
    Promise.all(
      chunks(binIds).map(async (chunk) => {
        const result = await supabase.from("bins").select("id, reference, current_location_id").in("id", chunk);
        if (result.error) throw new Error(errorText(result.error));
        return result.data ?? [];
      }),
    ),
  ]);
  const cycles = cycleParts.flat();
  const bins = binParts.flat();
  const open = new Set(
    cycles.filter((row) => String(row.status ?? "") === "open").map((row) => String(row.id)),
  );
  const locationIds = [
    ...new Set(bins.map((row) => (row.current_location_id == null ? "" : String(row.current_location_id))).filter(Boolean)),
  ];
  const locationParts = await Promise.all(
    chunks(locationIds).map(async (chunk) => {
      const result = await supabase.from("locations").select("id, code").in("id", chunk);
      if (result.error) throw new Error(errorText(result.error));
      return result.data ?? [];
    }),
  );
  const locationById = new Map(locationParts.flat().map((row) => [String(row.id), String(row.code ?? "").trim()]));
  const binById = new Map(
    bins.map((row) => {
      const locationId = row.current_location_id == null ? "" : String(row.current_location_id);
      const location = locationId ? locationById.get(locationId) ?? "" : "";
      return [String(row.id), { reference: String(row.reference ?? ""), locationCode: location || null }] as const;
    }),
  );
  return rows.map((row) => {
    const bin = binById.get(String(row.bin_id ?? ""));
    const damaged = Number(row.damaged_qty ?? 0);
    return {
      itemId: String(row.item_id ?? ""),
      qty: Number(row.qty),
      damagedQty: Number.isFinite(damaged) ? damaged : 0,
      binReference: bin?.reference ?? "",
      locationCode: bin?.locationCode ?? null,
      cycleOpen: open.has(String(row.cycle_id ?? "")),
    };
  });
}

async function openBinContents(supabase: SupabaseClient, itemIds: string[]): Promise<InventoryContentSource[]> {
  return hydrateContents(supabase, await contentRowsForItems(supabase, itemIds));
}

function blankResult(query: string, stock: InventoryStock): Extract<InventorySearchResult, { ok: true }> {
  return {
    ok: true,
    query,
    note: null,
    hits: [],
    truncated: false,
    stock,
    matched: 0,
    scanned: 0,
    totalQty: 0,
    page: 1,
    pages: 1,
  };
}

async function finishInventory(input: {
  query: string;
  note: string | null;
  hits: InventoryHit[];
  truncated: boolean;
  stock: InventoryStock;
  page: number;
  sort: InventorySort | null;
}): Promise<InventorySearchResult> {
  const filtered = applyInventoryStock(input.hits, input.stock, input.truncated);
  const ordered = sortInventoryHits(filtered.hits, input.sort);
  const paged = pageInventoryHits(ordered, input.page);
  const paths = paged.hits.map((hit) => hit.imagePath).filter((path): path is string => Boolean(path));
  const urls = await signedImageUrls(paths);
  return {
    ok: true,
    query: input.query,
    note: input.note,
    hits: paged.hits.map((hit) => ({
      ...hit,
      imageUrl: hit.imagePath ? urls.get(hit.imagePath) ?? null : null,
      imagePath: null,
    })),
    truncated: filtered.truncated,
    stock: input.stock,
    matched: filtered.matched,
    scanned: filtered.scanned,
    totalQty: inventoryQtyTotal(filtered.hits),
    page: paged.page,
    pages: paged.pages,
  };
}

/**
 * A blank search lists the inventory. In stock is every open-cycle for-sale qty above 0.
 * All is every item, including qty 0. A typed search still uses receiving Find.
 */
async function browseInventory(
  supabase: SupabaseClient,
  stock: InventoryStock,
  page: number,
  sort: InventorySort | null,
): Promise<InventorySearchResult> {
  const contents = await hydrateContents(supabase, await allContentRows(supabase));
  const matches =
    stock === "in"
      ? await itemMatchesByIds(
          supabase,
          contents.filter((row) => row.cycleOpen && row.qty > 0).map((row) => row.itemId),
        )
      : await allItemMatches(supabase);
  return finishInventory({
    query: "",
    note: null,
    hits: inventoryHits(sortMatchesBySku(matches), contents),
    truncated: false,
    stock,
    page,
    sort,
  });
}

function mergeScanMatches(scans: readonly { matches: readonly LabelItem[] }[]): InventoryMatch[] {
  const matches: InventoryMatch[] = [];
  const seen = new Set<string>();
  for (const scan of scans) {
    for (const match of scan.matches) {
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      matches.push({
        id: match.id,
        sku: match.sku,
        name: match.name,
        description: match.description,
        shortCode: match.shortCode,
        longCode: match.longCode ?? null,
        taxonomyName: match.taxonomyName ?? null,
        imagePath: null,
      });
    }
  }
  return matches;
}

/**
 * Receiving Find, then for-sale quantity and bin locations for each hit.
 * A blank query lists the inventory instead of waiting for a search.
 * `|` is OR before that scan. `7060DX5|7060PX5` keeps either model.
 * In stock (the default) keeps for-sale quantity above zero. All keeps quantity 0.
 * Damaged quantity is not added. The filter runs before paging, so the count and
 * the total qty describe the filtered list.
 */
export async function searchInventory(
  raw: string,
  stock?: InventoryStock,
  page?: number,
  sort?: InventorySort | null,
): Promise<InventorySearchResult> {
  const mode = inventoryStockMode(stock);
  const query = raw.trim().slice(0, 500);
  const requestedPage = parseInventoryPage(page);
  const ordering = sort ?? null;
  try {
    const supabase = await getSupabase();
    if (!query) return browseInventory(supabase, mode, requestedPage, ordering);
    const terms = alnumQueryAlternatives(query);
    if (terms.length === 0) return blankResult(query, mode);
    const cap = inventoryScanCap(mode);
    const scans = await Promise.all(terms.map((term) => searchReceivingScan(term, cap)));
    const found = scans.some((result) => result.exact || result.matches.length > 0);
    const note =
      scans
        .map((result) =>
          scanSearchNote({
            token: result.token,
            tried: result.tried,
            found: Boolean(result.exact || result.matches.length > 0),
          }),
        )
        .filter((line): line is string => Boolean(line))
        .join(" ") || null;
    if (!found) return { ...blankResult(query, mode), query, note };
    const matches = mergeScanMatches(scans);
    const [contents, images] = await Promise.all([
      openBinContents(
        supabase,
        matches.map((match) => match.id),
      ),
      primaryImages(
        supabase,
        matches.map((match) => match.id),
      ),
    ]);
    for (const match of matches) match.imagePath = images.get(match.id) ?? null;
    return finishInventory({
      query,
      note,
      hits: inventoryHits(matches, contents),
      truncated: scans.some((result) => result.truncated),
      stock: mode,
      page: requestedPage,
      sort: ordering,
    });
  } catch (cause) {
    return { ok: false, message: errorText(cause) };
  }
}
