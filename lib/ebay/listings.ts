import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeLike } from "@/lib/labelLookup";
import {
  assignListingSku,
  directListings,
  kitListingUses,
  parsePackLabel,
  type DirectListing,
  type ItemEbayView,
  type KitEdge,
  type KitListingUse,
} from "@/lib/ebay/packs";
import { ACTIVE_LIST_PAGE_SIZE, fetchActiveListPage, TradingCallError, type ActiveListPage, type ActiveListing } from "@/lib/ebay/trading";
import { writeEbayLog } from "@/lib/ebay/log";
import { forceRefreshAccessToken, validAccessToken } from "@/lib/ebay/oauth";
import { getServiceSupabase } from "@/lib/supabaseAdmin";

const MAX_PAGES = 500;
const UPSERT_CHUNK = 200;
const SKU_CHUNK = 100;

export type ListingWrite = {
  ebay_item_id: string;
  sku: string | null;
  variation_sku: string | null;
  title: string | null;
  quantity_available: number | null;
  listing_status: string;
  listing_url: string | null;
  picture_url: string | null;
  item_id: string | null;
  base_sku: string | null;
  pack_qty: number;
  matched_manually: boolean;
  fetched_at: string;
};

export type ListingsPullResult = {
  active: number;
  unmatched: number;
  ended: number;
  fetchedAt: string;
};

export type ListingsSummary = {
  available: boolean;
  active: number | null;
  unmatched: number | null;
  fetchedAt: string | null;
};

type ListingsStore = {
  itemsForSkus(skus: string[]): Promise<{ id: string; sku: string }[]>;
  upsert(rows: ListingWrite[]): Promise<void>;
  endMissing(fetchedAt: string): Promise<number>;
};

export type { DirectListing, ItemEbayView, KitListingUse };

export function listingMatchSku(row: { sku: string | null; variationSku: string | null }): string | null {
  const variation = row.variationSku?.trim() ?? "";
  if (variation) return variation;
  const sku = row.sku?.trim() ?? "";
  return sku || null;
}

export { resolveSkuMap } from "@/lib/ebay/packs";

export function uniqueEbayItemIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter((id) => /^\d+$/.test(id)))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

export { ebayItemUrl } from "@/lib/ebay/itemUrl";

export function listingRowKey(ebayItemId: string, variationSku: string | null): string {
  return `${ebayItemId}\u0000${variationSku?.trim() ?? ""}`;
}

export function withPreservedManualMatch(row: ListingWrite, manualItemIds: ReadonlyMap<string, string>): ListingWrite {
  if (row.item_id) return { ...row, matched_manually: false };
  const kept = manualItemIds.get(listingRowKey(row.ebay_item_id, row.variation_sku));
  if (!kept) return { ...row, matched_manually: false };
  return { ...row, item_id: kept, matched_manually: true };
}

export function listingsColumnMissing(error: { code?: string; message?: string } | null, column: string): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  const needle = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(needle, "i").test(message)) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;
  return /schema cache|does not exist|could not find/i.test(message);
}

export function listingsTableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "PGRST205" || code === "42P01") return true;
  return /ebay_listings/i.test(message) && /schema cache|does not exist|could not find/i.test(message);
}

export async function runListingsPull(input: {
  token: string;
  fetchedAt: string;
  entriesPerPage?: number;
  fetchPage: (
    page: number,
    token: string,
  ) => Promise<{ page: ActiveListPage; token: string; rlogid: string | null; requestId: string | null }>;
  store: ListingsStore;
}): Promise<ListingsPullResult & { rlogid: string | null; requestId: string | null }> {
  const entriesPerPage = input.entriesPerPage ?? ACTIVE_LIST_PAGE_SIZE;
  const seen = new Map<string, ActiveListing>();
  let token = input.token;
  let totalPages = 1;
  let rlogid: string | null = null;
  let requestId: string | null = null;

  for (let page = 1; page <= totalPages && page <= MAX_PAGES; page += 1) {
    const result = await input.fetchPage(page, token);
    token = result.token;
    rlogid = result.rlogid ?? rlogid;
    requestId = result.requestId ?? requestId;
    for (const row of result.page.rows) {
      seen.set(`${row.ebayItemId}\u0000${row.variationSku?.trim() ?? ""}`, row);
    }
    if (result.page.totalPages > 0) totalPages = result.page.totalPages;
    else if (result.page.rows.length >= entriesPerPage) totalPages = page + 1;
    if (result.page.rows.length === 0) break;
  }

  const listings = [...seen.values()];
  const labels = listings.map((row) => listingMatchSku(row)).filter((sku): sku is string => Boolean(sku));
  const baseSkus = labels.flatMap((label) => {
    const pack = parsePackLabel(label);
    return pack ? [pack.baseSku] : [];
  });
  const items = await input.store.itemsForSkus([...labels, ...baseSkus]);
  const writes: ListingWrite[] = listings.map((row) => {
    const assigned = assignListingSku(listingMatchSku(row), items);
    return {
      ebay_item_id: row.ebayItemId,
      sku: row.sku,
      variation_sku: row.variationSku,
      title: row.title,
      quantity_available: row.quantityAvailable,
      listing_status: row.listingStatus || "Active",
      listing_url: row.listingUrl,
      picture_url: row.pictureUrl,
      item_id: assigned.itemId,
      base_sku: assigned.baseSku,
      pack_qty: assigned.packQty,
      matched_manually: false,
      fetched_at: input.fetchedAt,
    };
  });
  if (writes.length > 0) await input.store.upsert(writes);
  const ended = await input.store.endMissing(input.fetchedAt);
  const unmatched = writes.filter((row) => row.item_id === null).length;
  return { active: writes.length, unmatched, ended, fetchedAt: input.fetchedAt, rlogid, requestId };
}

export async function pullActiveListings(): Promise<ListingsPullResult> {
  const admin = getServiceSupabase();
  if (!admin) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY on the server.");
  const { connection } = await validAccessToken();
  const fetchedAt = new Date().toISOString();
  try {
    const result = await runListingsPull({
      token: connection.access_token,
      fetchedAt,
      fetchPage: (page, token) =>
        fetchActiveListPage({
          environment: connection.environment,
          token,
          page,
          refresh: async () => (await forceRefreshAccessToken()).access_token,
        }),
      store: supabaseStore(admin),
    });
    await writeEbayLog({
      entity: "listings",
      direction: "read",
      status: "ok",
      message: `Fetched ${result.active} active eBay listings. ${result.unmatched} do not match an item SKU.`,
      detail: {
        active: result.active,
        unmatched: result.unmatched,
        ended: result.ended,
        rlogid: result.rlogid,
        requestId: result.requestId,
      },
    });
    return { active: result.active, unmatched: result.unmatched, ended: result.ended, fetchedAt: result.fetchedAt };
  } catch (error) {
    const trading = error instanceof TradingCallError ? error : null;
    const message = error instanceof Error ? error.message : "eBay listings pull failed.";
    await writeEbayLog({
      entity: "listings",
      direction: "read",
      status: "error",
      message: message.slice(0, 300),
      detail: { rlogid: trading?.rlogid ?? null, requestId: trading?.requestId ?? null },
    });
    throw error;
  }
}

export async function listingsSummary(): Promise<ListingsSummary> {
  const admin = getServiceSupabase();
  if (!admin) return { available: false, active: null, unmatched: null, fetchedAt: null };
  const active = await admin
    .from("ebay_listings")
    .select("id", { count: "exact", head: true })
    .eq("listing_status", "Active");
  if (active.error) {
    if (listingsTableMissing(active.error)) return { available: false, active: null, unmatched: null, fetchedAt: null };
    throw new Error(active.error.message);
  }
  const unmatched = await admin
    .from("ebay_listings")
    .select("id", { count: "exact", head: true })
    .eq("listing_status", "Active")
    .is("item_id", null);
  if (unmatched.error) throw new Error(unmatched.error.message);
  const latest = await admin
    .from("ebay_listings")
    .select("fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw new Error(latest.error.message);
  const fetchedAt = latest.data && typeof latest.data.fetched_at === "string" ? latest.data.fetched_at : null;
  return { available: true, active: active.count ?? 0, unmatched: unmatched.count ?? 0, fetchedAt };
}

export async function itemIdsMatchingEbayItemId(supabase: SupabaseClient, pattern: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("ebay_listings")
    .select("item_id")
    .ilike("ebay_item_id", pattern)
    .not("item_id", "is", null)
    .limit(1000);
  if (error) {
    if (listingsTableMissing(error)) return [];
    throw new Error(error.message);
  }
  const ids = new Set<string>();
  for (const row of data ?? []) {
    if (typeof row.item_id === "string") ids.add(row.item_id);
  }
  return [...ids];
}

export async function ebayPresenceForItems(
  supabase: SupabaseClient,
  itemIds: readonly string[],
): Promise<Map<string, ItemEbayView>> {
  const ids = [...new Set(itemIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  const views = new Map<string, ItemEbayView>();
  if (ids.length === 0) return views;
  const directRows = await selectActiveListings(supabase, ids);
  if (directRows === "missing") return views;
  const edges = await loadKitEdges(supabase, ids);
  const kitIds = [...new Set((edges ?? []).map((edge) => edge.kitItemId))];
  const kitRows = kitIds.length > 0 ? await selectActiveListings(supabase, kitIds) : [];
  const kitSkus = await itemSkus(supabase, kitIds);
  const listings = kitRows === "missing" ? [] : kitRows;
  for (const id of ids) {
    const own = directRows.filter((row) => row.itemId === id);
    const kits =
      edges === null
        ? []
        : kitListingUses({
            componentId: id,
            edges,
            listings,
            kitSkus,
          });
    views.set(id, { direct: directListings(own), kits });
  }
  return views;
}

export async function ebayViewForItem(supabase: SupabaseClient, itemId: string): Promise<ItemEbayView | null> {
  const directRows = await selectActiveListings(supabase, [itemId]);
  if (directRows === "missing") return null;
  const edges = await loadKitEdges(supabase, [itemId]);
  const kitIds = [...new Set((edges ?? []).map((edge) => edge.kitItemId))];
  const kitRows = kitIds.length > 0 ? await selectActiveListings(supabase, kitIds) : [];
  const kits =
    edges === null || kitRows === "missing"
      ? []
      : kitListingUses({
          componentId: itemId,
          edges,
          listings: kitRows,
          kitSkus: await itemSkus(supabase, kitIds),
        });
  return { direct: directListings(directRows.filter((row) => row.itemId === itemId)), kits };
}

async function selectActiveListings(
  supabase: SupabaseClient,
  itemIds: string[],
): Promise<{ itemId: string; ebayItemId: string; packQty: number }[] | "missing"> {
  const rows: { itemId: string; ebayItemId: string; packQty: number }[] = [];
  for (const chunk of chunks(itemIds, SKU_CHUNK)) {
    for (let from = 0; from < 20_000; from += 1000) {
      const selected = await supabase
        .from("ebay_listings")
        .select("item_id, ebay_item_id, pack_qty")
        .eq("listing_status", "Active")
        .in("item_id", chunk)
        .range(from, from + 999);
      if (selected.error && packColumnsMissing(selected.error)) {
        return selectActiveListingsWithoutPack(supabase, itemIds);
      }
      if (selected.error) {
        if (listingsTableMissing(selected.error)) return "missing";
        throw new Error(selected.error.message);
      }
      for (const row of selected.data ?? []) {
        if (typeof row.item_id !== "string" || typeof row.ebay_item_id !== "string") continue;
        const packQty = typeof row.pack_qty === "number" && row.pack_qty >= 1 ? row.pack_qty : 1;
        rows.push({ itemId: row.item_id, ebayItemId: row.ebay_item_id, packQty });
      }
      if ((selected.data ?? []).length < 1000) break;
    }
  }
  return rows;
}

async function selectActiveListingsWithoutPack(
  supabase: SupabaseClient,
  itemIds: string[],
): Promise<{ itemId: string; ebayItemId: string; packQty: number }[] | "missing"> {
  const rows: { itemId: string; ebayItemId: string; packQty: number }[] = [];
  for (const chunk of chunks(itemIds, SKU_CHUNK)) {
    const selected = await supabase
      .from("ebay_listings")
      .select("item_id, ebay_item_id")
      .eq("listing_status", "Active")
      .in("item_id", chunk)
      .limit(1000);
    if (selected.error) {
      if (listingsTableMissing(selected.error)) return "missing";
      throw new Error(selected.error.message);
    }
    for (const row of selected.data ?? []) {
      if (typeof row.item_id === "string" && typeof row.ebay_item_id === "string") {
        rows.push({ itemId: row.item_id, ebayItemId: row.ebay_item_id, packQty: 1 });
      }
    }
  }
  return rows;
}

async function loadKitEdges(supabase: SupabaseClient, startIds: string[]): Promise<KitEdge[] | null> {
  const edges: KitEdge[] = [];
  let frontier = [...startIds];
  const expanded = new Set<string>();
  for (let depth = 0; depth < 12 && frontier.length > 0; depth += 1) {
    const pending = frontier.filter((id) => !expanded.has(id));
    frontier = [];
    if (pending.length === 0) break;
    for (const id of pending) expanded.add(id);
    for (const chunk of chunks(pending, SKU_CHUNK)) {
      const selected = await supabase
        .from("kit_components")
        .select("kit_item_id, component_item_id, qty_per_kit")
        .in("component_item_id", chunk);
      if (selected.error) {
        if (kitTableMissing(selected.error)) return null;
        throw new Error(selected.error.message);
      }
      for (const row of selected.data ?? []) {
        if (typeof row.kit_item_id !== "string" || typeof row.component_item_id !== "string") continue;
        const qty = typeof row.qty_per_kit === "number" ? row.qty_per_kit : Number(row.qty_per_kit);
        edges.push({ kitItemId: row.kit_item_id, componentItemId: row.component_item_id, qtyPerKit: qty });
        frontier.push(row.kit_item_id);
      }
    }
  }
  return edges;
}

async function itemSkus(supabase: SupabaseClient, itemIds: string[]): Promise<Map<string, string>> {
  const skus = new Map<string, string>();
  for (const chunk of chunks(itemIds, SKU_CHUNK)) {
    const selected = await supabase.from("items").select("id, sku").in("id", chunk);
    if (selected.error) throw new Error(selected.error.message);
    for (const row of selected.data ?? []) {
      if (typeof row.id === "string" && typeof row.sku === "string" && row.sku.trim()) skus.set(row.id, row.sku.trim());
    }
  }
  return skus;
}

function packColumnsMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!/pack_qty|base_sku/i.test(message)) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;
  return /schema cache|does not exist|could not find/i.test(message);
}

function kitTableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = `${error.code ?? ""} ${error.message ?? ""}`;
  return /kit_components/i.test(message) && /schema cache|does not exist|could not find|PGRST205|42P01/i.test(message);
}

type ListingOmit = {
  pack: boolean;
  picture: boolean;
  manual: boolean;
};

function listingPayload(row: ListingWrite, omit: ListingOmit): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...row };
  if (omit.pack) {
    delete payload.base_sku;
    delete payload.pack_qty;
  }
  if (omit.picture) delete payload.picture_url;
  if (omit.manual) delete payload.matched_manually;
  return payload;
}

function supabaseStore(admin: SupabaseClient): ListingsStore {
  const omit: ListingOmit = { pack: false, picture: false, manual: false };
  return {
    itemsForSkus: (skus) => itemsForSkus(admin, skus),
    upsert: async (rows) => {
      const manualItemIds = await manualItemIdsFor(admin, rows, omit);
      const prepared = omit.manual ? rows : rows.map((row) => withPreservedManualMatch(row, manualItemIds));
      for (const chunk of chunks(prepared, UPSERT_CHUNK)) {
        await upsertListingChunk(admin, chunk, omit);
      }
    },
    endMissing: async (fetchedAt) => {
      const { error, count } = await admin
        .from("ebay_listings")
        .update({ listing_status: "Ended" }, { count: "exact" })
        .eq("listing_status", "Active")
        .lt("fetched_at", fetchedAt);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  };
}

async function manualItemIdsFor(
  admin: SupabaseClient,
  rows: readonly ListingWrite[],
  omit: ListingOmit,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (omit.manual) return found;
  const ids = [...new Set(rows.filter((row) => row.item_id === null).map((row) => row.ebay_item_id))];
  for (const chunk of chunks(ids, SKU_CHUNK)) {
    const selected = await admin
      .from("ebay_listings")
      .select("ebay_item_id, variation_sku, item_id")
      .in("ebay_item_id", chunk)
      .eq("matched_manually", true)
      .not("item_id", "is", null);
    if (selected.error && listingsColumnMissing(selected.error, "matched_manually")) {
      omit.manual = true;
      return new Map();
    }
    if (selected.error) {
      if (listingsTableMissing(selected.error)) return found;
      throw new Error(selected.error.message);
    }
    for (const row of selected.data ?? []) {
      if (typeof row.ebay_item_id !== "string" || typeof row.item_id !== "string") continue;
      const variation = typeof row.variation_sku === "string" ? row.variation_sku : null;
      found.set(listingRowKey(row.ebay_item_id, variation), row.item_id);
    }
  }
  return found;
}

async function upsertListingChunk(admin: SupabaseClient, chunk: ListingWrite[], omit: ListingOmit): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { error } = await admin
      .from("ebay_listings")
      .upsert(chunk.map((row) => listingPayload(row, omit)), { onConflict: "ebay_item_id,variation_key" });
    if (!error) return;
    const before = `${omit.pack}:${omit.picture}:${omit.manual}`;
    if (!omit.pack && packColumnsMissing(error)) omit.pack = true;
    if (!omit.picture && listingsColumnMissing(error, "picture_url")) omit.picture = true;
    if (!omit.manual && listingsColumnMissing(error, "matched_manually")) omit.manual = true;
    if (`${omit.pack}:${omit.picture}:${omit.manual}` === before) throw new Error(error.message);
  }
  throw new Error("eBay listings could not be saved.");
}

async function itemsForSkus(admin: SupabaseClient, skus: readonly string[]): Promise<{ id: string; sku: string }[]> {
  const wanted = [...new Set(skus.map((sku) => sku.trim()).filter((sku) => sku.length > 0))];
  const found: { id: string; sku: string }[] = [];
  for (const chunk of chunks(wanted, SKU_CHUNK)) {
    const exact = await admin.from("items").select("id, sku").in("sku", chunk);
    if (exact.error) throw new Error(exact.error.message);
    for (const row of exact.data ?? []) {
      if (typeof row.id === "string") found.push({ id: row.id, sku: String(row.sku ?? "") });
    }
  }
  const have = new Set(found.map((row) => row.sku));
  const missing = wanted.filter((sku) => !have.has(sku));
  for (const chunk of chunks(missing, 40)) {
    const filter = chunk.map((sku) => `sku.ilike.${quoteExact(sku)}`).join(",");
    const loose = await admin.from("items").select("id, sku").or(filter);
    if (loose.error) throw new Error(loose.error.message);
    for (const row of loose.data ?? []) {
      if (typeof row.id === "string") found.push({ id: row.id, sku: String(row.sku ?? "") });
    }
  }
  return found;
}

function quoteExact(value: string): string {
  return `"${escapeLike(value).replace(/"/g, '""')}"`;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}
