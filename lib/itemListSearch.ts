import type { SupabaseClient } from "@supabase/supabase-js";
import { itemIdsMatchingEbayItemId } from "@/lib/ebay/listings";
import { errorText } from "@/lib/errors";
import { itemListQueryToken } from "@/lib/itemListQuery";

/** Columns the items list matches with a case-insensitive contains search. */
export const ITEM_LIST_TEXT_COLUMNS = [
  "sku",
  "name",
  "description",
  "model",
  "part_number",
  "oem_name",
  "oem_part_number",
  "product_url",
] as const;

/** Every place the items list looks, including related rows. */
export const ITEM_LIST_SEARCH_SOURCES = [
  ...ITEM_LIST_TEXT_COLUMNS,
  "item_attributes.value",
  "manufacturers.name",
  "manufacturer_aliases.alias",
  "ebay_listings.ebay_item_id",
] as const;

export function itemListLikePattern(raw: string): string {
  return `%${raw.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&")}%`;
}

/**
 * Item ids for one items-page query token.
 * Null means the query has no token, so the list is not filtered.
 * An empty array means nothing matched.
 */
export async function itemIdsMatchingListQuery(
  supabase: SupabaseClient,
  q: string,
  options?: { taxonomyId?: string | null; perSourceLimit?: number },
): Promise<string[] | null> {
  const searchText = itemListQueryToken(q);
  if (!searchText) return null;
  const pattern = itemListLikePattern(searchText);
  const taxonomyId = options?.taxonomyId?.trim() || null;
  const limit = options?.perSourceLimit;

  const textQueries = ITEM_LIST_TEXT_COLUMNS.map((column) => {
    let query = supabase.from("items").select("id").ilike(column, pattern);
    if (taxonomyId) query = query.eq("taxonomy_id", taxonomyId);
    if (limit) query = query.limit(limit);
    return query;
  });
  let attributes = supabase.from("item_attributes").select("item_id").ilike("value", pattern);
  if (limit) attributes = attributes.limit(limit);
  let names = supabase.from("manufacturers").select("id").ilike("name", pattern);
  if (limit) names = names.limit(limit);
  let aliases = supabase.from("manufacturer_aliases").select("manufacturer_id").ilike("alias", pattern);
  if (limit) aliases = aliases.limit(limit);

  const [textResults, attributeResult, nameResult, aliasResult, ebayItemIds] = await Promise.all([
    Promise.all(textQueries),
    attributes,
    names,
    aliases,
    itemIdsMatchingEbayItemId(supabase, pattern),
  ]);
  const failed = textResults.find((result) => result.error);
  if (failed?.error) throw new Error(errorText(failed.error));
  if (attributeResult.error) throw new Error(errorText(attributeResult.error));
  if (nameResult.error) throw new Error(errorText(nameResult.error));
  if (aliasResult.error) throw new Error(errorText(aliasResult.error));

  const matched = new Set<string>();
  for (const result of textResults) {
    for (const row of result.data ?? []) {
      if (typeof row.id === "string") matched.add(row.id);
    }
  }
  for (const row of attributeResult.data ?? []) {
    if (typeof row.item_id === "string") matched.add(row.item_id);
  }
  const ebayIds = limit ? ebayItemIds.slice(0, limit) : ebayItemIds;
  for (const id of ebayIds) matched.add(id);

  const makerIds = new Set<string>();
  for (const row of nameResult.data ?? []) {
    if (typeof row.id === "string") makerIds.add(row.id);
  }
  for (const row of aliasResult.data ?? []) {
    if (typeof row.manufacturer_id === "string") makerIds.add(row.manufacturer_id);
  }
  if (makerIds.size > 0) {
    let makerItems = supabase.from("items").select("id").in("manufacturer_id", [...makerIds]);
    if (taxonomyId) makerItems = makerItems.eq("taxonomy_id", taxonomyId);
    if (limit) makerItems = makerItems.limit(limit);
    const made = await makerItems;
    if (made.error) throw new Error(errorText(made.error));
    for (const row of made.data ?? []) {
      if (typeof row.id === "string") matched.add(row.id);
    }
  }

  return [...matched];
}
