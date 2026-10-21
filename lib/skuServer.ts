"use server";

import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

export async function fetchReservedSku(): Promise<string> {
  const { data, error } = await (await getSupabase()).rpc("reserve_item_sku");
  if (error) throw new Error(errorText(error));
  if (typeof data !== "string" || data.length === 0) throw new Error("Could not assign a SKU.");
  return data;
}
