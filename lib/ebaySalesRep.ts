import type { SupabaseClient } from "@supabase/supabase-js";

/** app_settings key. Not a credential. */
export const EBAY_SALES_REP_SETTING_KEY = "ebay_default_sales_rep";

/** Used when the setting is missing or blank. */
export const DEFAULT_EBAY_SALES_REP = "MT";

/** Two letters, or null. Sales orders store the initials in this shape. */
export function normalizeSalesRep(value: string | null | undefined): string | null {
  const letters = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(letters) ? letters : null;
}

/** The stored setting, or MT when it is empty or not two letters. */
export function ebaySalesRepFromSetting(value: string | null | undefined): string {
  return normalizeSalesRep(value) ?? DEFAULT_EBAY_SALES_REP;
}

/**
 * A saved rep wins. An eBay order with none uses the setting.
 * Any other order with none stays blank.
 */
export function initialSalesRep(input: {
  stored: string | null | undefined;
  ebay: boolean;
  setting: string | null | undefined;
}): string {
  const stored = normalizeSalesRep(input.stored);
  if (stored) return stored;
  return input.ebay ? ebaySalesRepFromSetting(input.setting) : "";
}

export async function readEbayDefaultSalesRep(client: SupabaseClient): Promise<string> {
  const { data, error } = await client
    .from("app_settings")
    .select("value")
    .eq("key", EBAY_SALES_REP_SETTING_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = data && typeof data.value === "string" ? data.value : null;
  return ebaySalesRepFromSetting(value);
}
