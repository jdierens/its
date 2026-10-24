import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeLike } from "@/lib/labelLookup";
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
  item_id: string | null;
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
  itemIdsBySku(skus: string[]): Promise<Map<string, string>>;
  upsert(rows: ListingWrite[]): Promise<void>;
  endMissing(fetchedAt: string): Promise<number>;
};

export function listingMatchSku(row: { sku: string | null; variationSku: string | null }): string | null {
  const variation = row.variationSku?.trim() ?? "";
  if (variation) return variation;
  const sku = row.sku?.trim() ?? "";
  return sku || null;
}

export function resolveSkuMap(wanted: readonly string[], items: readonly { id: string; sku: string }[]): Map<string, string> {
  const exact = new Map<string, string>();
  const folded = new Map<string, { id: string; count: number }>();
  for (const item of items) {
    const sku = item.sku.trim();
    if (!sku || !item.id) continue;
    if (!exact.has(sku)) exact.set(sku, item.id);
    const key = sku.toLowerCase();
    const previous = folded.get(key);
    if (!previous) folded.set(key, { id: item.id, count: 1 });
    else if (previous.id !== item.id) folded.set(key, { id: previous.id, count: previous.count + 1 });
  }
  const matched = new Map<string, string>();
  for (const raw of wanted) {
    const sku = raw.trim();
    if (!sku || matched.has(sku)) continue;
    const exactId = exact.get(sku);
    if (exactId) {
      matched.set(sku, exactId);
      continue;
    }
    const loose = folded.get(sku.toLowerCase());
    if (loose && loose.count === 1) matched.set(sku, loose.id);
  }
  return matched;
}

export function uniqueEbayItemIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter((id) => /^\d+$/.test(id)))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

export { ebayItemUrl } from "@/lib/ebay/itemUrl";

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
  const matchSkus = listings
    .map((row) => listingMatchSku(row))
    .filter((sku): sku is string => Boolean(sku));
  const itemIds = await input.store.itemIdsBySku(matchSkus);
  const writes: ListingWrite[] = listings.map((row) => {
    const match = listingMatchSku(row);
    return {
      ebay_item_id: row.ebayItemId,
      sku: row.sku,
      variation_sku: row.variationSku,
      title: row.title,
      quantity_available: row.quantityAvailable,
      listing_status: row.listingStatus || "Active",
      listing_url: row.listingUrl,
      item_id: match ? itemIds.get(match) ?? null : null,
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

export async function ebayIdsForItems(supabase: SupabaseClient, itemIds: readonly string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(itemIds.filter((id) => id.trim().length > 0))];
  const grouped = new Map<string, string[]>();
  if (ids.length === 0) return grouped;
  const rows = await selectListingLinks(supabase, ids);
  const buckets = new Map<string, string[]>();
  for (const row of rows) {
    const current = buckets.get(row.itemId) ?? [];
    current.push(row.ebayItemId);
    buckets.set(row.itemId, current);
  }
  for (const [itemId, ebayItemIds] of buckets) grouped.set(itemId, uniqueEbayItemIds(ebayItemIds));
  return grouped;
}

export async function ebayListingsForItem(supabase: SupabaseClient, itemId: string): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("ebay_listings")
    .select("ebay_item_id")
    .eq("item_id", itemId)
    .eq("listing_status", "Active");
  if (error) {
    if (listingsTableMissing(error)) return null;
    throw new Error(error.message);
  }
  return uniqueEbayItemIds((data ?? []).map((row) => String(row.ebay_item_id ?? "")));
}

async function selectListingLinks(
  supabase: SupabaseClient,
  itemIds: string[],
): Promise<{ itemId: string; ebayItemId: string }[]> {
  const rows: { itemId: string; ebayItemId: string }[] = [];
  for (const chunk of chunks(itemIds, SKU_CHUNK)) {
    for (let from = 0; from < 20_000; from += 1000) {
      const { data, error } = await supabase
        .from("ebay_listings")
        .select("item_id, ebay_item_id")
        .eq("listing_status", "Active")
        .in("item_id", chunk)
        .range(from, from + 999);
      if (error) {
        if (listingsTableMissing(error)) return [];
        throw new Error(error.message);
      }
      for (const row of data ?? []) {
        if (typeof row.item_id === "string" && typeof row.ebay_item_id === "string") {
          rows.push({ itemId: row.item_id, ebayItemId: row.ebay_item_id });
        }
      }
      if ((data ?? []).length < 1000) break;
    }
  }
  return rows;
}

function supabaseStore(admin: SupabaseClient): ListingsStore {
  return {
    itemIdsBySku: (skus) => itemIdsBySku(admin, skus),
    upsert: async (rows) => {
      for (const chunk of chunks(rows, UPSERT_CHUNK)) {
        const { error } = await admin.from("ebay_listings").upsert(chunk, { onConflict: "ebay_item_id,variation_key" });
        if (error) throw new Error(error.message);
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

async function itemIdsBySku(admin: SupabaseClient, skus: readonly string[]): Promise<Map<string, string>> {
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
  return resolveSkuMap(wanted, found);
}

function quoteExact(value: string): string {
  return `"${escapeLike(value).replace(/"/g, '""')}"`;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}
