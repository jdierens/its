import type { SupabaseClient } from "@supabase/supabase-js";
import { INCOTERMS } from "@/lib/salesOrderDraft";
import { EBAY_SALES_REP_SETTING_KEY, ebaySalesRepFromSetting } from "@/lib/ebaySalesRep";

/** app_settings key. Not a credential. */
export const EBAY_PAYMENT_TERMS_SETTING_KEY = "ebay_default_payment_terms";

/** app_settings key. Not a credential. */
export const EBAY_INCOTERMS_SETTING_KEY = "ebay_default_incoterms";

/** so_payment_terms code. The label and QuickBooks name are Payment In Advance. */
export const DEFAULT_EBAY_PAYMENT_TERMS = "PIA";

export const DEFAULT_EBAY_INCOTERMS = "FOB";

const INCOTERM_CODES: readonly string[] = INCOTERMS;

export type EbayDraftDefaults = {
  salesRep: string;
  paymentTerms: string;
  incoterms: string;
};

/** A so_payment_terms code, or PIA when the setting is blank. */
export function ebayPaymentTermsFromSetting(value: string | null | undefined): string {
  const code = (value ?? "").trim();
  if (!code || code.toLowerCase() === "payment in advance" || code.toUpperCase() === "PIA") return DEFAULT_EBAY_PAYMENT_TERMS;
  return code;
}

/** An Incoterms code, or FOB when the setting is blank or not one of the sales-order codes. */
export function ebayIncotermsFromSetting(value: string | null | undefined): string {
  const code = (value ?? "").trim().toUpperCase();
  return INCOTERM_CODES.includes(code) ? code : DEFAULT_EBAY_INCOTERMS;
}

/**
 * A saved value wins. An eBay order with none uses the setting.
 * Any other order with none stays blank.
 */
export function initialEbayText(input: {
  stored: string | null | undefined;
  ebay: boolean;
  setting: string;
}): string {
  const stored = (input.stored ?? "").trim();
  if (stored) return stored;
  return input.ebay ? input.setting : "";
}

export async function readEbayDraftDefaults(client: SupabaseClient): Promise<EbayDraftDefaults> {
  const { data, error } = await client
    .from("app_settings")
    .select("key, value")
    .in("key", [EBAY_SALES_REP_SETTING_KEY, EBAY_PAYMENT_TERMS_SETTING_KEY, EBAY_INCOTERMS_SETTING_KEY]);
  if (error) throw new Error(error.message);
  const values = new Map<string, string | null>();
  for (const row of data ?? []) {
    values.set(String(row.key), typeof row.value === "string" ? row.value : null);
  }
  return {
    salesRep: ebaySalesRepFromSetting(values.get(EBAY_SALES_REP_SETTING_KEY)),
    paymentTerms: ebayPaymentTermsFromSetting(values.get(EBAY_PAYMENT_TERMS_SETTING_KEY)),
    incoterms: ebayIncotermsFromSetting(values.get(EBAY_INCOTERMS_SETTING_KEY)),
  };
}
