"use server";

import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

export async function fetchNextSkuPreview(): Promise<string> {
  const { data, error } = await (await getSupabase()).rpc("peek_item_sku");
  if (error) throw new Error(errorText(error));
  if (typeof data !== "string" || data.length === 0) throw new Error("Could not preview a SKU.");
  return data;
}
