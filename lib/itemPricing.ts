import { errorText } from "@/lib/errors";
import { asMoney, SALES_WINDOW_KEY, type PriceQuoteSource, type TransactionSource, type TransactionType } from "@/lib/pricing/quotes";
import { getSupabase } from "@/lib/supabase";

export type ItemPrices = {
  ecommercePrice: number | null;
  ecommerceUpdatedAt: string | null;
  marketPrice: number | null;
  marketUpdatedAt: string | null;
  msrp: number | null;
  msrpUpdatedAt: string | null;
  pricingCheckedAt: string | null;
  partNumber: string;
  model: string;
};

export type PriceQuote = {
  id: string;
  source: PriceQuoteSource;
  price: number;
  currency: string;
  qty: number | null;
  condition: string;
  vendorId: string | null;
  vendorName: string;
  sellerName: string;
  url: string;
  notes: string;
  capturedAt: string;
  capturedBy: string;
  outlier: boolean;
};

export type ItemTransaction = {
  id: string;
  type: TransactionType;
  txnDate: string;
  qty: number;
  unitPrice: number;
  total: number;
  customerId: string | null;
  customerName: string;
  vendorId: string | null;
  vendorName: string;
  reference: string;
  source: TransactionSource;
  notes: string;
  createdAt: string;
};

export type PartyChoice = { id: string; name: string };

const PRICE_COLUMNS =
  "ecommerce_price, ecommerce_price_updated_at, market_price, market_price_updated_at, msrp, msrp_updated_at, pricing_checked_at, part_number, model";

export async function fetchItemPrices(itemId: string): Promise<ItemPrices | null> {
  const { data, error } = await (await getSupabase()).from("items").select(PRICE_COLUMNS).eq("id", itemId).maybeSingle();
  if (error) throw new Error(errorText(error));
  if (!data) return null;
  return {
    ecommercePrice: asMoney(data.ecommerce_price),
    ecommerceUpdatedAt: textOrNull(data.ecommerce_price_updated_at),
    marketPrice: asMoney(data.market_price),
    marketUpdatedAt: textOrNull(data.market_price_updated_at),
    msrp: asMoney(data.msrp),
    msrpUpdatedAt: textOrNull(data.msrp_updated_at),
    pricingCheckedAt: textOrNull(data.pricing_checked_at),
    partNumber: String(data.part_number ?? ""),
    model: String(data.model ?? ""),
  };
}

export async function saveItemPrices(
  itemId: string,
  prices: { ecommercePrice: number | null; marketPrice: number | null; msrp: number | null },
): Promise<void> {
  const { error } = await (await getSupabase())
    .from("items")
    .update({
      ecommerce_price: prices.ecommercePrice,
      market_price: prices.marketPrice,
      msrp: prices.msrp,
    })
    .eq("id", itemId);
  if (error) throw new Error(errorText(error));
}

type QuoteRow = {
  id: string;
  source: PriceQuoteSource;
  price: number | string;
  currency: string;
  qty: number | string | null;
  condition: string | null;
  vendor_id: string | null;
  seller_name: string | null;
  url: string | null;
  notes: string | null;
  captured_at: string;
  captured_by: string | null;
  outlier: boolean;
  vendors: { display_name: string } | { display_name: string }[] | null;
};

export async function fetchPriceQuotes(itemId: string): Promise<PriceQuote[]> {
  const { data, error } = await (await getSupabase())
    .from("price_quotes")
    .select("id, source, price, currency, qty, condition, vendor_id, seller_name, url, notes, captured_at, captured_by, outlier, vendors(display_name)")
    .eq("item_id", itemId)
    .order("captured_at", { ascending: false });
  if (error) throw new Error(errorText(error));
  return ((data ?? []) as QuoteRow[]).map((row) => ({
    id: row.id,
    source: row.source,
    price: asMoney(row.price) ?? 0,
    currency: row.currency,
    qty: asMoney(row.qty),
    condition: row.condition ?? "",
    vendorId: row.vendor_id,
    vendorName: embeddedName(row.vendors),
    sellerName: row.seller_name ?? "",
    url: row.url ?? "",
    notes: row.notes ?? "",
    capturedAt: row.captured_at,
    capturedBy: row.captured_by ?? "",
    outlier: row.outlier,
  }));
}

export type QuoteInput = {
  source: PriceQuoteSource;
  price: number;
  currency: string;
  qty: number | null;
  condition: string;
  vendorId: string | null;
  sellerName: string;
  url: string;
  notes: string;
  capturedBy: string;
};

export async function addPriceQuote(itemId: string, input: QuoteInput): Promise<void> {
  const { error } = await (await getSupabase()).from("price_quotes").insert({
    item_id: itemId,
    source: input.source,
    price: input.price,
    currency: input.currency.trim() || "USD",
    qty: input.qty,
    condition: input.condition.trim() || null,
    vendor_id: input.vendorId,
    seller_name: input.sellerName.trim() || null,
    url: input.url.trim() || null,
    notes: input.notes.trim() || null,
    captured_by: input.capturedBy.trim() || "manual",
  });
  if (error) throw new Error(errorText(error));
}

type TxnRow = {
  id: string;
  type: TransactionType;
  txn_date: string;
  qty: number | string;
  unit_price: number | string;
  total: number | string;
  customer_id: string | null;
  vendor_id: string | null;
  reference: string | null;
  source: TransactionSource;
  notes: string | null;
  created_at: string;
  customers: { display_name: string } | { display_name: string }[] | null;
  vendors: { display_name: string } | { display_name: string }[] | null;
};

export async function fetchItemTransactions(itemId: string): Promise<ItemTransaction[]> {
  const { data, error } = await (await getSupabase())
    .from("item_transactions")
    .select(
      "id, type, txn_date, qty, unit_price, total, customer_id, vendor_id, reference, source, notes, created_at, customers(display_name), vendors(display_name)",
    )
    .eq("item_id", itemId)
    .order("txn_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(errorText(error));
  return ((data ?? []) as TxnRow[]).map((row) => ({
    id: row.id,
    type: row.type,
    txnDate: row.txn_date,
    qty: asMoney(row.qty) ?? 0,
    unitPrice: asMoney(row.unit_price) ?? 0,
    total: asMoney(row.total) ?? 0,
    customerId: row.customer_id,
    customerName: embeddedName(row.customers),
    vendorId: row.vendor_id,
    vendorName: embeddedName(row.vendors),
    reference: row.reference ?? "",
    source: row.source,
    notes: row.notes ?? "",
    createdAt: row.created_at,
  }));
}

export type TransactionInput = {
  type: TransactionType;
  txnDate: string;
  qty: number;
  unitPrice: number;
  customerId: string | null;
  vendorId: string | null;
  reference: string;
  source: TransactionSource;
  notes: string;
};

export async function addItemTransaction(itemId: string, input: TransactionInput): Promise<void> {
  const { error } = await (await getSupabase()).from("item_transactions").insert({
    item_id: itemId,
    type: input.type,
    txn_date: input.txnDate,
    qty: input.qty,
    unit_price: input.unitPrice,
    customer_id: input.type === "sell" ? input.customerId : null,
    vendor_id: input.type === "buy" ? input.vendorId : null,
    reference: input.reference.trim() || null,
    source: input.source,
    notes: input.notes.trim() || null,
  });
  if (error) throw new Error(friendlyTransactionError(error));
}

export async function fetchPartyChoices(table: "customers" | "vendors"): Promise<PartyChoice[]> {
  const { data, error } = await (await getSupabase()).from(table).select("id, display_name").order("display_name");
  if (error) throw new Error(errorText(error));
  return (data ?? []).map((row) => ({ id: String(row.id), name: String(row.display_name ?? "") }));
}

export async function fetchSalesWindowDays(): Promise<number> {
  const { data, error } = await (await getSupabase())
    .from("app_settings")
    .select("value")
    .eq("key", SALES_WINDOW_KEY)
    .maybeSingle();
  if (error) throw new Error(errorText(error));
  const days = Number(data?.value);
  return Number.isInteger(days) && days > 0 ? days : 90;
}

export async function saveSalesWindowDays(days: number): Promise<void> {
  const { error } = await (await getSupabase()).from("app_settings").upsert({
    key: SALES_WINDOW_KEY,
    value: String(days),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(errorText(error));
}

function embeddedName(value: { display_name: string } | { display_name: string }[] | null): string {
  if (!value) return "";
  const row = Array.isArray(value) ? value[0] : value;
  return row?.display_name ?? "";
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function friendlyTransactionError(error: unknown): string {
  const text = errorText(error);
  if (text.includes("item_transactions_source_ref_item")) {
    return "A transaction with that source and reference already exists for this item.";
  }
  return text;
}
