"use server";

import { errorText } from "@/lib/errors";
import { itemEntriesFromJson, onHandFromRpc, stockRpcMissing, type ItemEntry } from "@/lib/itemStock";
import { getSupabase } from "@/lib/supabase";

const ITEM_ENTRIES_MIGRATION = "supabase/migrations/20261103042000_item_entries.sql";

/** Live for-sale quantity. Zero when the SKU has no open-cycle balance. */
export async function fetchItemOnHand(itemId: string): Promise<number> {
  const id = itemId.trim();
  if (!id) return 0;
  const { data, error } = await (await getSupabase()).rpc("item_for_sale_qty", { p_item: id });
  if (error) throw new Error(errorText(error));
  return onHandFromRpc(data);
}

/** Newest receives, put-aways, moves, and picks for one SKU. */
export async function listItemEntries(itemId: string): Promise<ItemEntry[]> {
  const id = itemId.trim();
  if (!id) return [];
  const { data, error } = await (await getSupabase()).rpc("list_item_entries", {
    p_item_id: id,
    p_limit: 50,
  });
  if (error) {
    if (stockRpcMissing(error)) {
      throw new Error(`Apply ${ITEM_ENTRIES_MIGRATION} before this SKU can list its inventory entries.`);
    }
    throw new Error(errorText(error));
  }
  return itemEntriesFromJson(data);
}
