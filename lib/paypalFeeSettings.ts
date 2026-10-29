"use server";

import { errorText } from "@/lib/errors";
import {
  PAYPAL_FEE_DOMESTIC_SETTING,
  PAYPAL_FEE_DOMESTIC_SKU,
  PAYPAL_FEE_INTERNATIONAL_SETTING,
  PAYPAL_FEE_INTERNATIONAL_SKU,
  paypalFeeSkuFromSetting,
  type PaypalFeeCatalog,
  type PaypalFeeItem,
} from "@/lib/paypalFee";
import { getSupabase } from "@/lib/supabase";

export type PaypalFeeSetting = {
  sku: string;
  name: string;
  description: string;
};

export async function fetchPaypalFeeCatalog(): Promise<PaypalFeeCatalog> {
  const settings = await readSkuSettings();
  const [domestic, international] = await Promise.all([
    itemForSku(settings.domesticSku),
    itemForSku(settings.internationalSku),
  ]);
  return {
    domesticSku: settings.domesticSku,
    internationalSku: settings.internationalSku,
    domestic,
    international,
  };
}

export async function fetchPaypalFeeSettings(): Promise<{ domestic: PaypalFeeSetting; international: PaypalFeeSetting }> {
  const catalog = await fetchPaypalFeeCatalog();
  return {
    domestic: settingFrom(catalog.domesticSku, catalog.domestic),
    international: settingFrom(catalog.internationalSku, catalog.international),
  };
}

/** Stores the item SKU. An unknown SKU is rejected. */
export async function savePaypalFeeSkus(domestic: string, international: string): Promise<{
  domestic: PaypalFeeSetting;
  international: PaypalFeeSetting;
}> {
  const domesticItem = await itemForSku(domestic);
  const internationalItem = await itemForSku(international);
  if (!domesticItem) throw new Error("Choose the PayPal domestic fee item.");
  if (!internationalItem) throw new Error("Choose the PayPal international fee item.");
  const supabase = await getSupabase();
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from("app_settings").upsert([
    { key: PAYPAL_FEE_DOMESTIC_SETTING, value: domesticItem.sku, updated_at: updatedAt },
    { key: PAYPAL_FEE_INTERNATIONAL_SETTING, value: internationalItem.sku, updated_at: updatedAt },
  ]);
  if (error) throw new Error(errorText(error));
  return {
    domestic: settingFrom(domesticItem.sku, domesticItem),
    international: settingFrom(internationalItem.sku, internationalItem),
  };
}

async function readSkuSettings(): Promise<{ domesticSku: string; internationalSku: string }> {
  const { data, error } = await (await getSupabase())
    .from("app_settings")
    .select("key, value")
    .in("key", [PAYPAL_FEE_DOMESTIC_SETTING, PAYPAL_FEE_INTERNATIONAL_SETTING]);
  if (error) throw new Error(errorText(error));
  const values = new Map((data ?? []).map((row) => [String(row.key), String(row.value ?? "")]));
  return {
    domesticSku: paypalFeeSkuFromSetting(values.get(PAYPAL_FEE_DOMESTIC_SETTING), PAYPAL_FEE_DOMESTIC_SKU),
    internationalSku: paypalFeeSkuFromSetting(values.get(PAYPAL_FEE_INTERNATIONAL_SETTING), PAYPAL_FEE_INTERNATIONAL_SKU),
  };
}

async function itemForSku(sku: string): Promise<PaypalFeeItem | null> {
  const wanted = sku.trim();
  if (!wanted) return null;
  const { data, error } = await (await getSupabase())
    .from("items")
    .select("id, sku, name, description")
    .ilike("sku", wanted)
    .limit(8);
  if (error) throw new Error(errorText(error));
  const hit = (data ?? []).find((row) => String(row.sku ?? "").trim().toLowerCase() === wanted.toLowerCase());
  if (!hit) return null;
  return {
    id: String(hit.id),
    sku: String(hit.sku ?? ""),
    name: String(hit.name ?? ""),
    description: String(hit.description ?? ""),
  };
}

function settingFrom(sku: string, item: PaypalFeeItem | null): PaypalFeeSetting {
  return {
    sku: item?.sku || sku,
    name: item?.name ?? "",
    description: item?.description ?? "",
  };
}
