"use server";

import { errorText } from "@/lib/errors";
import {
  DEFAULT_EBAY_PAYMENT_TERMS,
  EBAY_INCOTERMS_SETTING_KEY,
  EBAY_PAYMENT_TERMS_SETTING_KEY,
  ebayIncotermsFromSetting,
  ebayPaymentTermsFromSetting,
  readEbayDraftDefaults,
  type EbayDraftDefaults,
} from "@/lib/ebayOrderDefaults";
import { getSupabase } from "@/lib/supabase";

export async function fetchEbayDraftDefaults(): Promise<EbayDraftDefaults> {
  return readEbayDraftDefaults(await getSupabase());
}

export async function fetchSalesPaymentTerms(): Promise<{ code: string; label: string }[]> {
  const { data, error } = await (await getSupabase())
    .from("so_payment_terms")
    .select("code, label, sort_order")
    .order("sort_order");
  if (error) throw new Error(errorText(error));
  return (data ?? []).map((row) => ({ code: String(row.code), label: String(row.label) }));
}

/** Empty is stored as Payment In Advance. The code has to exist on so_payment_terms. */
export async function saveEbayDefaultPaymentTerms(value: string): Promise<string> {
  const code = value.trim() === "" ? DEFAULT_EBAY_PAYMENT_TERMS : value.trim();
  const supabase = await getSupabase();
  const found = await supabase.from("so_payment_terms").select("code").eq("code", code).maybeSingle();
  if (found.error) throw new Error(errorText(found.error));
  if (!found.data) throw new Error("Choose a payment term.");
  const { error } = await supabase.from("app_settings").upsert({
    key: EBAY_PAYMENT_TERMS_SETTING_KEY,
    value: code,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(errorText(error));
  return ebayPaymentTermsFromSetting(code);
}

/** Empty is stored as FOB. Anything else must be a sales-order Incoterms code. */
export async function saveEbayDefaultIncoterms(value: string): Promise<string> {
  const code = ebayIncotermsFromSetting(value);
  if (value.trim() !== "" && code !== value.trim().toUpperCase()) throw new Error("Choose Incoterms.");
  const { error } = await (await getSupabase()).from("app_settings").upsert({
    key: EBAY_INCOTERMS_SETTING_KEY,
    value: code,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(errorText(error));
  return code;
}
