"use server";

import { errorText } from "@/lib/errors";
import {
  EBAY_SALES_REP_SETTING_KEY,
  ebaySalesRepFromSetting,
  normalizeSalesRep,
  readEbayDefaultSalesRep,
} from "@/lib/ebaySalesRep";
import { getSupabase } from "@/lib/supabase";

export async function fetchEbayDefaultSalesRep(): Promise<string> {
  return readEbayDefaultSalesRep(await getSupabase());
}

/** Empty is stored as MT. Anything else must be two letters. */
export async function saveEbayDefaultSalesRep(value: string): Promise<string> {
  const rep = value.trim() === "" ? ebaySalesRepFromSetting("") : normalizeSalesRep(value);
  if (!rep) throw new Error("eBay sales rep is 2 letters.");
  const { error } = await (await getSupabase()).from("app_settings").upsert({
    key: EBAY_SALES_REP_SETTING_KEY,
    value: rep,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(errorText(error));
  return rep;
}
