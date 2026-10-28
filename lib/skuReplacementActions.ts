"use server";

import { errorText } from "@/lib/errors";
import { itemIdsMatchingListQuery } from "@/lib/itemListSearch";
import { rankSalesItemHits, salesItemSearchTokens } from "@/lib/salesItemSearch";
import type { SalesSkuHit } from "@/lib/salesOrders";
import { replacementChoiceAllowed } from "@/lib/skuReplacement";
import { getSupabase } from "@/lib/supabase";

export type ReplacementSearch = { ok: true; hits: SalesSkuHit[] } | { ok: false; message: string };

type ItemRow = {
  id: string;
  sku: string | null;
  name: string | null;
  part_number: string | null;
  oem_part_number: string | null;
  item_type: string | null;
  is_generic?: boolean | null;
};

/** Find SKU for a fulfillment replacement. Services, kits, and generic parts are left out. */
export async function searchReplacementItems(query: string): Promise<ReplacementSearch> {
  try {
    const tokens = salesItemSearchTokens(query);
    if (tokens.length === 0) return { ok: true, hits: [] };
    const supabase = await getSupabase();
    const idLists = await Promise.all(tokens.map((token) => itemIdsMatchingListQuery(supabase, token, { perSourceLimit: 40 })));
    const ids = [...new Set(idLists.flatMap((list) => list ?? []))].slice(0, 120);
    if (ids.length === 0) return { ok: true, hits: [] };
    const rows = await loadReplacementRows(ids);
    const hits = rows
      .filter((row) => replacementChoiceAllowed({ itemType: String(row.item_type ?? ""), generic: Boolean(row.is_generic) }))
      .map((row) => {
        const part = String(row.part_number ?? "");
        const oem = String(row.oem_part_number ?? "");
        const needles = tokens.map((token) => token.toLowerCase());
        const fieldHit = (value: string, needle: string) => value.toLowerCase().includes(needle);
        const partHit = needles.some((needle) => fieldHit(part, needle));
        const oemHit = needles.some((needle) => fieldHit(oem, needle));
        return {
          id: String(row.id),
          sku: String(row.sku ?? ""),
          name: String(row.name ?? ""),
          partNumber: oemHit && !partHit ? oem : part || oem,
          usHts: "",
          eccn: "",
        };
      });
    return { ok: true, hits: rankSalesItemHits(tokens, hits) };
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
}

async function loadReplacementRows(ids: string[]): Promise<ItemRow[]> {
  const supabase = await getSupabase();
  const withGeneric = await supabase
    .from("items")
    .select("id, sku, name, part_number, oem_part_number, item_type, is_generic")
    .in("id", ids);
  if (!withGeneric.error) return (withGeneric.data ?? []) as ItemRow[];
  const message = withGeneric.error.message ?? "";
  if (!/is_generic/i.test(message)) throw new Error(errorText(withGeneric.error));
  const plain = await supabase
    .from("items")
    .select("id, sku, name, part_number, oem_part_number, item_type")
    .in("id", ids);
  if (plain.error) throw new Error(errorText(plain.error));
  return (plain.data ?? []) as ItemRow[];
}
