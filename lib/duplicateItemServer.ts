"use server";

import { readAppUser } from "@/lib/appUserRecord";
import { authRequired } from "@/lib/authRequired";
import { canViewFinancials, sameItemName, skuReusesSource } from "@/lib/duplicateItem";
import { errorText } from "@/lib/errors";
import { fetchItem } from "@/lib/items";
import { saveItemPrices } from "@/lib/itemPricing";
import { asMoney, parseMoney } from "@/lib/pricing/quotes";
import { sessionUser } from "@/lib/sessionUser";
import { getSupabase } from "@/lib/supabase";
import type { ItemType } from "@/lib/itemFields";

export type DuplicatePrices = {
  ecommercePrice: string;
  marketPrice: string;
  msrp: string;
};

export type DuplicateSource = {
  sourceId: string;
  sourceName: string;
  sourceSku: string;
  name: string;
  description: string;
  taxonomyId: string | null;
  manufacturerId: string | null;
  manufacturerName: string;
  model: string;
  partNumber: string;
  oemName: string;
  oemPartNumber: string;
  productUrl: string;
  unit: string;
  itemType: ItemType;
  condition: "New" | "Used";
  conditionNote: string;
  eccn: string;
  usHts: string;
  ccats: string;
  coo: string;
  notes: string;
  attributes: Record<string, string>;
  prices: DuplicatePrices | null;
};

const PRICE_COLUMNS = "ecommerce_price, market_price, msrp";

function moneyField(value: unknown): string {
  const amount = asMoney(value);
  if (amount == null) return "";
  return amount.toFixed(2);
}

async function viewerCanSeeMoney(): Promise<boolean> {
  if (!authRequired()) return true;
  const session = await sessionUser();
  if (!session) return false;
  const user = await readAppUser(session.id);
  if (!user || user.status !== "approved") return false;
  return canViewFinancials(user.role, true);
}

async function readPrices(id: string): Promise<DuplicatePrices | null> {
  const listed = await (await getSupabase()).from("items").select(PRICE_COLUMNS).eq("id", id).maybeSingle();
  if (listed.error) return null;
  const row = listed.data;
  if (!row) return null;
  return {
    ecommercePrice: moneyField(row.ecommerce_price),
    marketPrice: moneyField(row.market_price),
    msrp: moneyField(row.msrp),
  };
}

export async function fetchDuplicateSource(id: string): Promise<DuplicateSource | null> {
  const item = await fetchItem(id);
  if (!item) return null;
  const prices = (await viewerCanSeeMoney()) ? await readPrices(id) : null;
  return {
    sourceId: item.id,
    sourceName: item.name,
    sourceSku: item.sku,
    name: item.name,
    description: item.description,
    taxonomyId: item.taxonomyId,
    manufacturerId: item.manufacturerId,
    manufacturerName: item.manufacturerName,
    model: item.model,
    partNumber: item.partNumber,
    oemName: item.oemName,
    oemPartNumber: item.oemPartNumber,
    productUrl: item.productUrl,
    unit: item.unit,
    itemType: item.itemType,
    condition: item.condition,
    conditionNote: item.conditionNote,
    eccn: item.eccn,
    usHts: item.usHts,
    ccats: item.ccats,
    coo: item.coo,
    notes: item.notes,
    attributes: item.attributes,
    prices,
  };
}

export async function assertDuplicateSave(input: { sourceId: string; name: string; sku: string }): Promise<void> {
  const item = await fetchItem(input.sourceId);
  if (!item) throw new Error("The original item is no longer available.");
  if (sameItemName(input.name, item.name)) {
    throw new Error("Change the name so this item is distinct from the original.");
  }
  if (skuReusesSource(input.sku, item.sku)) {
    throw new Error("Choose a new SKU. The original SKU stays on the source item.");
  }
}

export async function saveDuplicatePrices(
  itemId: string,
  prices: { ecommercePrice: string; marketPrice: string; msrp: string },
): Promise<void> {
  if (!(await viewerCanSeeMoney())) return;
  const ecommerce = parseMoney(prices.ecommercePrice);
  const market = parseMoney(prices.marketPrice);
  const msrp = parseMoney(prices.msrp);
  if (!ecommerce.ok) throw new Error(`Ecommerce price: ${ecommerce.message}`);
  if (!market.ok) throw new Error(`Market price: ${market.message}`);
  if (!msrp.ok) throw new Error(`MSRP: ${msrp.message}`);
  try {
    await saveItemPrices(itemId, {
      ecommercePrice: ecommerce.amount,
      marketPrice: market.amount,
      msrp: msrp.amount,
    });
  } catch (error) {
    throw new Error(errorText(error));
  }
}
