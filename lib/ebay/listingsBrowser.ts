import type { SupabaseClient } from "@supabase/supabase-js";
import { listingMatchSku, listingsColumnMissing, listingsTableMissing } from "@/lib/ebay/listings";
import { ebayItemUrl } from "@/lib/ebay/itemUrl";
import { safeHttpsUrl } from "@/lib/ebay/trading";
import { itemIdsMatchingAlnum } from "@/lib/itemAlnumSearch";
import { escapeLike } from "@/lib/labelLookup";
import { primaryStoragePath } from "@/lib/imageOrder";
import { ITEM_IMAGE_BUCKET } from "@/lib/imageFiles";
import { getServiceSupabase } from "@/lib/supabaseAdmin";

export const EBAY_LISTINGS_PAGE_SIZE = 50;
const ITEM_LOOKUP_LIMIT = 40;
const MATCH_SEARCH_LIMIT = 8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EbayListingMatchFilter = "all" | "matched" | "unmatched";

export type EbayListingQuery = {
  q: string;
  match: EbayListingMatchFilter;
  page: number;
};

export type EbayListingBrowserRow = {
  id: string;
  ebayItemId: string;
  title: string | null;
  customLabel: string | null;
  parentSku: string | null;
  quantityAvailable: number | null;
  listingUrl: string;
  imageUrl: string | null;
  itemId: string | null;
  itemSku: string | null;
  itemName: string | null;
  packQty: number;
  matchedManually: boolean;
};

export type EbayListingsBrowserResult = {
  available: boolean;
  reason: "ok" | "no-service" | "no-table" | "error";
  message: string | null;
  rows: EbayListingBrowserRow[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  match: EbayListingMatchFilter;
};

export type EbayMatchItem = {
  id: string;
  sku: string;
  name: string;
};

export function parseEbayListingQuery(params: { q?: string; match?: string; page?: string }): EbayListingQuery {
  const q = (params.q ?? "").trim().slice(0, 120);
  const match: EbayListingMatchFilter =
    params.match === "matched" || params.match === "unmatched" ? params.match : "all";
  const pageNumber = Number(params.page);
  const page = Number.isInteger(pageNumber) && pageNumber > 0 ? Math.min(pageNumber, 10_000) : 1;
  return { q, match, page };
}

export function ebayListingSearchFilter(query: string, itemIds: readonly string[]): string | null {
  const parts: string[] = [];
  const trimmed = query.trim();
  if (trimmed) {
    const quoted = quotedLike(trimmed);
    for (const column of ["title", "sku", "variation_sku", "ebay_item_id"]) {
      parts.push(`${column}.ilike.${quoted}`);
    }
  }
  const ids = [...new Set(itemIds.filter((id) => UUID_PATTERN.test(id)))].slice(0, ITEM_LOOKUP_LIMIT);
  if (ids.length > 0) parts.push(`item_id.in.(${ids.join(",")})`);
  return parts.length > 0 ? parts.join(",") : null;
}

export function matchListingDecision(input: {
  listingFound: boolean;
  listingItemId: string | null;
  itemExists: boolean;
}): { ok: true } | { ok: false; status: number; message: string } {
  if (!input.listingFound) return { ok: false, status: 404, message: "That listing was not found." };
  if (!input.itemExists) return { ok: false, status: 404, message: "That item was not found." };
  if (input.listingItemId) return { ok: false, status: 409, message: "This listing is already matched." };
  return { ok: true };
}

export type EbayListingExportLoad =
  | { ok: true; rows: EbayListingBrowserRow[] }
  | { ok: false; status: number; message: string };

const EXPORT_PAGE_SIZE = 1000;
const EXPORT_ROW_CAP = 100_000;

/**
 * Every active listing matching the search and match filter, in the same order as the browser.
 * The page number is ignored so an export is not limited to the rows on screen.
 */
export async function loadEbayListingsForExport(
  parsed: Pick<EbayListingQuery, "q" | "match">,
): Promise<EbayListingExportLoad> {
  const admin = getServiceSupabase();
  if (!admin) return { ok: false, status: 500, message: "Set SUPABASE_SERVICE_ROLE_KEY on the server." };
  const query: EbayListingQuery = { q: parsed.q, match: parsed.match, page: 1 };
  const itemIds = parsed.q ? await itemIdsMatchingQuery(admin, parsed.q) : [];
  const selected = await selectAllListingRows(admin, query, itemIds);
  if (selected === "missing") {
    return { ok: false, status: 400, message: "The listings table is not in the database yet." };
  }
  return { ok: true, rows: await hydrateListingRows(admin, selected) };
}

export async function listEbayListings(parsed: EbayListingQuery): Promise<EbayListingsBrowserResult> {
  const blank = blankResult(parsed);
  const admin = getServiceSupabase();
  if (!admin) {
    return { ...blank, reason: "no-service", message: "Set SUPABASE_SERVICE_ROLE_KEY on the server." };
  }
  const itemIds = parsed.q ? await itemIdsMatchingQuery(admin, parsed.q) : [];
  const selected = await selectListingPage(admin, parsed, itemIds);
  if (selected === "missing") {
    return { ...blank, reason: "no-table", message: "The listings table is not in the database yet." };
  }
  return {
    ...blank,
    available: true,
    reason: "ok",
    rows: await hydrateListingRows(admin, selected.rows),
    total: selected.total,
  };
}

export async function searchItemsToMatch(query: string): Promise<EbayMatchItem[]> {
  const trimmed = query.trim().slice(0, 80);
  if (!trimmed) return [];
  const admin = getServiceSupabase();
  if (!admin) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY on the server.");
  const quoted = quotedLike(trimmed);
  const [selected, alnumIds] = await Promise.all([
    admin.from("items").select("id, sku, name").or(`sku.ilike.${quoted},name.ilike.${quoted}`).order("sku").limit(MATCH_SEARCH_LIMIT),
    itemIdsMatchingAlnum(admin, trimmed, { columns: ["sku", "name"], limit: MATCH_SEARCH_LIMIT }),
  ]);
  if (selected.error) throw new Error(selected.error.message);
  const ilikeRows = [...(selected.data ?? [])];
  const seen = new Set(ilikeRows.flatMap((row) => (typeof row.id === "string" ? [row.id] : [])));
  const missing = alnumIds.filter((id) => !seen.has(id));
  const rows = [...ilikeRows];
  if (missing.length > 0) {
    const extra = await admin.from("items").select("id, sku, name").in("id", missing);
    if (extra.error) throw new Error(extra.error.message);
    rows.unshift(...(extra.data ?? []));
  }
  const items: EbayMatchItem[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    const sku = typeof row.sku === "string" ? row.sku : "";
    const name = typeof row.name === "string" ? row.name : "";
    if (!sku && !name) continue;
    items.push({ id: row.id, sku, name });
    if (items.length === MATCH_SEARCH_LIMIT) break;
  }
  return items;
}

export async function matchEbayListing(listingId: string, itemId: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!UUID_PATTERN.test(listingId) || !UUID_PATTERN.test(itemId)) {
    return { ok: false, status: 400, message: "Choose an item to match." };
  }
  const admin = getServiceSupabase();
  if (!admin) return { ok: false, status: 500, message: "Set SUPABASE_SERVICE_ROLE_KEY on the server." };
  const listing = await admin.from("ebay_listings").select("id, item_id").eq("id", listingId).maybeSingle();
  if (listing.error) {
    if (listingsTableMissing(listing.error)) {
      return { ok: false, status: 400, message: "The listings table is not in the database yet." };
    }
    throw new Error(listing.error.message);
  }
  const item = await admin.from("items").select("id").eq("id", itemId).maybeSingle();
  if (item.error) throw new Error(item.error.message);
  const decision = matchListingDecision({
    listingFound: Boolean(listing.data),
    listingItemId: typeof listing.data?.item_id === "string" ? listing.data.item_id : null,
    itemExists: Boolean(item.data),
  });
  if (!decision.ok) return decision;
  const updated = await updateUnmatchedListing(admin, listingId, itemId);
  if (!updated) return { ok: false, status: 409, message: "This listing is already matched." };
  return { ok: true };
}

function blankResult(parsed: EbayListingQuery): EbayListingsBrowserResult {
  return {
    available: false,
    reason: "error",
    message: null,
    rows: [],
    total: 0,
    page: parsed.page,
    pageSize: EBAY_LISTINGS_PAGE_SIZE,
    q: parsed.q,
    match: parsed.match,
  };
}

function quotedLike(value: string): string {
  return `"%${escapeLike(value).replace(/"/g, '""')}%"`;
}

async function itemIdsMatchingQuery(admin: SupabaseClient, query: string): Promise<string[]> {
  const quoted = quotedLike(query);
  const [selected, alnumIds] = await Promise.all([
    admin.from("items").select("id").or(`sku.ilike.${quoted},name.ilike.${quoted}`).limit(ITEM_LOOKUP_LIMIT),
    itemIdsMatchingAlnum(admin, query, { columns: ["sku", "name"], limit: ITEM_LOOKUP_LIMIT }),
  ]);
  if (selected.error) return alnumIds.slice(0, ITEM_LOOKUP_LIMIT);
  const ids = (selected.data ?? []).flatMap((row) => (typeof row.id === "string" ? [row.id] : []));
  return [...new Set([...alnumIds, ...ids])].slice(0, ITEM_LOOKUP_LIMIT);
}

type ListingPage = {
  rows: Record<string, unknown>[];
  total: number;
};

async function selectListingPage(
  admin: SupabaseClient,
  parsed: EbayListingQuery,
  itemIds: readonly string[],
): Promise<ListingPage | "missing"> {
  const counted = await listingQuery(admin, parsed, itemIds, "id", { count: "exact", head: true });
  if (counted.error) {
    if (listingsTableMissing(counted.error)) return "missing";
    throw new Error(counted.error.message);
  }
  const omit = { picture: false, pack: false, manual: false };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const from = (parsed.page - 1) * EBAY_LISTINGS_PAGE_SIZE;
    const selected = await listingQuery(admin, parsed, itemIds, listingColumns(omit))
      .order("item_id", { ascending: true, nullsFirst: true })
      .order("title", { ascending: true })
      .order("id")
      .range(from, from + EBAY_LISTINGS_PAGE_SIZE - 1);
    if (!selected.error) {
      return { rows: (selected.data ?? []) as unknown as Record<string, unknown>[], total: counted.count ?? 0 };
    }
    if (!relaxListingColumns(omit, selected.error)) {
      if (listingsTableMissing(selected.error)) return "missing";
      throw new Error(selected.error.message);
    }
  }
  throw new Error("eBay listings could not be read.");
}

async function selectAllListingRows(
  admin: SupabaseClient,
  parsed: EbayListingQuery,
  itemIds: readonly string[],
): Promise<Record<string, unknown>[] | "missing"> {
  const omit = { picture: false, pack: false, manual: false };
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    let batch: Record<string, unknown>[] | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const selected = await listingQuery(admin, parsed, itemIds, listingColumns(omit))
        .order("item_id", { ascending: true, nullsFirst: true })
        .order("title", { ascending: true })
        .order("id")
        .range(from, from + EXPORT_PAGE_SIZE - 1);
      if (!selected.error) {
        batch = (selected.data ?? []) as unknown as Record<string, unknown>[];
        break;
      }
      if (from === 0 && relaxListingColumns(omit, selected.error)) continue;
      if (listingsTableMissing(selected.error)) return "missing";
      throw new Error(selected.error.message);
    }
    if (!batch) throw new Error("eBay listings could not be read.");
    rows.push(...batch);
    if (batch.length < EXPORT_PAGE_SIZE) return rows;
    from += EXPORT_PAGE_SIZE;
    if (from >= EXPORT_ROW_CAP) throw new Error("Too many listings to export. Narrow the search.");
  }
}

function relaxListingColumns(
  omit: { picture: boolean; pack: boolean; manual: boolean },
  error: { code?: string; message?: string },
): boolean {
  const before = `${omit.picture}:${omit.pack}:${omit.manual}`;
  if (!omit.picture && listingsColumnMissing(error, "picture_url")) omit.picture = true;
  if (!omit.pack && listingsColumnMissing(error, "pack_qty")) omit.pack = true;
  if (!omit.manual && listingsColumnMissing(error, "matched_manually")) omit.manual = true;
  return `${omit.picture}:${omit.pack}:${omit.manual}` !== before;
}

function listingQuery(
  admin: SupabaseClient,
  parsed: EbayListingQuery,
  itemIds: readonly string[],
  columns: string,
  options?: { count?: "exact"; head?: boolean },
) {
  let query = admin.from("ebay_listings").select(columns, options).eq("listing_status", "Active");
  if (parsed.match === "unmatched") query = query.is("item_id", null);
  if (parsed.match === "matched") query = query.not("item_id", "is", null);
  const filter = ebayListingSearchFilter(parsed.q, itemIds);
  if (filter) query = query.or(filter);
  return query;
}

function listingColumns(omit: { picture: boolean; pack: boolean; manual: boolean }): string {
  const columns = [
    "id",
    "ebay_item_id",
    "sku",
    "variation_sku",
    "title",
    "quantity_available",
    "listing_status",
    "listing_url",
    "item_id",
    "items(sku, name)",
  ];
  if (!omit.picture) columns.push("picture_url");
  if (!omit.pack) columns.push("pack_qty");
  if (!omit.manual) columns.push("matched_manually");
  return columns.join(", ");
}

async function hydrateListingRows(admin: SupabaseClient, rows: Record<string, unknown>[]): Promise<EbayListingBrowserRow[]> {
  const itemIds = rows.flatMap((row) => (typeof row.item_id === "string" ? [row.item_id] : []));
  const photos = await itemPhotoUrls(admin, itemIds);
  return rows.flatMap((row) => {
    if (typeof row.id !== "string" || typeof row.ebay_item_id !== "string") return [];
    const sku = textOrNull(row.sku);
    const variationSku = textOrNull(row.variation_sku);
    const customLabel = listingMatchSku({ sku, variationSku });
    const item = embeddedItem(row.items);
    const itemId = textOrNull(row.item_id);
    const listingUrl = safeHttpsUrl(textOrNull(row.listing_url)) ?? ebayItemUrl(row.ebay_item_id);
    const packQty = typeof row.pack_qty === "number" && row.pack_qty >= 1 ? row.pack_qty : 1;
    return [
      {
        id: row.id,
        ebayItemId: row.ebay_item_id,
        title: textOrNull(row.title),
        customLabel,
        parentSku: variationSku && sku && sku !== variationSku ? sku : null,
        quantityAvailable: typeof row.quantity_available === "number" ? row.quantity_available : null,
        listingUrl,
        imageUrl: safeHttpsUrl(textOrNull(row.picture_url)) ?? (itemId ? photos.get(itemId) ?? null : null),
        itemId,
        itemSku: item?.sku ?? null,
        itemName: item?.name ?? null,
        packQty,
        matchedManually: row.matched_manually === true,
      },
    ];
  });
}

async function itemPhotoUrls(admin: SupabaseClient, itemIds: readonly string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return urls;
  const selected = await admin.from("item_images").select("item_id, storage_path, sort_order").in("item_id", ids);
  if (selected.error) return urls;
  const grouped = new Map<string, { storage_path: string; sort_order: number }[]>();
  for (const row of selected.data ?? []) {
    if (typeof row.item_id !== "string" || typeof row.storage_path !== "string") continue;
    const sort = typeof row.sort_order === "number" ? row.sort_order : Number(row.sort_order);
    const list = grouped.get(row.item_id) ?? [];
    list.push({ storage_path: row.storage_path, sort_order: Number.isFinite(sort) ? sort : 0 });
    grouped.set(row.item_id, list);
  }
  const paths = [...grouped.values()].flatMap((images) => {
    const path = primaryStoragePath(images);
    return path ? [path] : [];
  });
  if (paths.length === 0) return urls;
  const signed = await admin.storage.from(ITEM_IMAGE_BUCKET).createSignedUrls(paths, 60 * 60);
  if (signed.error) return urls;
  const byPath = new Map<string, string>();
  for (const row of signed.data ?? []) {
    if (row.path && row.signedUrl && !row.error) byPath.set(row.path, row.signedUrl);
  }
  for (const [itemId, images] of grouped) {
    const path = primaryStoragePath(images);
    const url = path ? byPath.get(path) : undefined;
    if (url) urls.set(itemId, url);
  }
  return urls;
}

function embeddedItem(value: unknown): { sku: string | null; name: string | null } | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const record = row as { sku?: unknown; name?: unknown };
  const sku = typeof record.sku === "string" ? record.sku : null;
  const name = typeof record.name === "string" ? record.name : null;
  if (!sku && !name) return null;
  return { sku, name };
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function updateUnmatchedListing(admin: SupabaseClient, listingId: string, itemId: string): Promise<boolean> {
  const withFlag = await admin
    .from("ebay_listings")
    .update({ item_id: itemId, matched_manually: true })
    .eq("id", listingId)
    .is("item_id", null)
    .select("id");
  if (withFlag.error && listingsColumnMissing(withFlag.error, "matched_manually")) {
    const plain = await admin.from("ebay_listings").update({ item_id: itemId }).eq("id", listingId).is("item_id", null).select("id");
    if (plain.error) throw new Error(plain.error.message);
    return (plain.data ?? []).length > 0;
  }
  if (withFlag.error) throw new Error(withFlag.error.message);
  return (withFlag.data ?? []).length > 0;
}
