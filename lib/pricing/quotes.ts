export const PRICE_QUOTE_SOURCES = [
  "ebay_listed",
  "ebay_sold",
  "brokerbin",
  "inbound_quote",
  "reseller_listed",
  "buyback",
  "manual",
] as const;

export type PriceQuoteSource = (typeof PRICE_QUOTE_SOURCES)[number];

/** Stored `source` values. `web_listed` is research-only and is not offered on Add quote. */
export type PriceQuoteRowSource = PriceQuoteSource | "web_listed";

export const QUOTE_SOURCE_LABELS: Record<PriceQuoteRowSource, string> = {
  ebay_listed: "eBay listed",
  ebay_sold: "eBay sold",
  brokerbin: "BrokerBin",
  inbound_quote: "Inbound quote",
  reseller_listed: "Reseller listed",
  buyback: "Buyback",
  manual: "Manual",
  web_listed: "Web listed",
};

export type PriceQuoteConditionClass = "New" | "New Open Box" | "Refurbished" | "Used" | "For Parts";

export type PriceQuoteListingType = "asking" | "sold" | "quote" | "offer";

/** `public.price_quotes` after market-research columns. `item_id` is null until exactly one item matches. */
export type PriceQuoteRow = {
  id: string;
  item_id: string | null;
  source: PriceQuoteRowSource;
  price: number | string;
  currency: string;
  qty: number | string | null;
  condition: string | null;
  condition_class: PriceQuoteConditionClass | null;
  condition_note: string | null;
  part_number: string | null;
  part_number_norm: string | null;
  manufacturer_id: string | null;
  manufacturer_name: string | null;
  model: string | null;
  taxonomy_id: string | null;
  listing_type: PriceQuoteListingType | null;
  shipping: number | string | null;
  listing_date: string | null;
  vendor_id: string | null;
  seller_name: string | null;
  url: string | null;
  notes: string | null;
  captured_at: string;
  captured_by: string | null;
  raw: unknown;
  outlier: boolean;
};

export const TRANSACTION_SOURCES = ["manual", "qbo", "ebay"] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];
export type TransactionType = "buy" | "sell";

export const SALES_WINDOW_KEY = "pricing_sales_window_days";
export const DEFAULT_SALES_WINDOW_DAYS = 90;

export type QuoteDraft = {
  source: PriceQuoteSource;
  price: number;
  currency: string;
  qty: number | null;
  condition: string | null;
  sellerName: string | null;
  url: string | null;
  notes: string | null;
  raw: unknown;
};

export function isQuoteSource(value: string): value is PriceQuoteSource {
  return (PRICE_QUOTE_SOURCES as readonly string[]).includes(value);
}

export function parseMoney(value: string): { ok: true; amount: number | null } | { ok: false; message: string } {
  const trimmed = value.trim().replaceAll("$", "").replaceAll(",", "").trim();
  if (!trimmed) return { ok: true, amount: null };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, message: "Use a dollar amount with up to 2 decimals." };
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount > 9_999_999_999.99) {
    return { ok: false, message: "That amount is too large." };
  }
  return { ok: true, amount };
}

export function asMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function formatMoney(amount: number | null, currency = "USD"): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function moneyInput(amount: number | null): string {
  if (amount == null) return "";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left == null || right == null) return null;
  return (left + right) / 2;
}

export function isPriceOutlier(price: number, medianPrice: number): boolean {
  if (!(medianPrice > 0)) return false;
  return price < medianPrice * 0.3 || price > medianPrice * 3;
}

export function flagOutliers<T extends { price: number; currency: string }>(
  quotes: T[],
): (T & { outlier: boolean })[] {
  const grouped = new Map<string, number[]>();
  for (const quote of quotes) {
    const currency = quote.currency.trim().toUpperCase() || "USD";
    const prices = grouped.get(currency) ?? [];
    prices.push(quote.price);
    grouped.set(currency, prices);
  }
  const medians = new Map<string, number | null>();
  for (const [currency, prices] of grouped) {
    medians.set(currency, prices.length >= 2 ? median(prices) : null);
  }
  return quotes.map((quote) => {
    const currency = quote.currency.trim().toUpperCase() || "USD";
    const mid = medians.get(currency) ?? null;
    return { ...quote, currency, outlier: mid != null && isPriceOutlier(quote.price, mid) };
  });
}

export function capturedPhrase(iso: string, nowMs = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "captured";
  const minutes = Math.max(0, Math.floor((nowMs - then) / 60_000));
  let relative = "just now";
  if (minutes >= 60 * 24) relative = `${Math.floor(minutes / (60 * 24))}d ago`;
  else if (minutes >= 60) relative = `${Math.floor(minutes / 60)}h ago`;
  else if (minutes >= 1) relative = `${minutes}m ago`;
  return `captured ${relative}`;
}

export function exactPacificTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

type Amount = { value?: string | number; currency?: string };

function amountOf(value: unknown): { price: number; currency: string } | null {
  if (!value || typeof value !== "object") return null;
  const amount = value as Amount;
  const price = asMoney(amount.value);
  if (price == null || price <= 0) return null;
  const currency = typeof amount.currency === "string" && amount.currency.trim() ? amount.currency.trim().toUpperCase() : "USD";
  return { price, currency };
}

function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function sellerOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const seller = value as { username?: unknown; name?: unknown };
  return textOf(seller.username) ?? textOf(seller.name);
}

export function quotesFromBrowse(body: unknown): QuoteDraft[] {
  if (!body || typeof body !== "object") return [];
  const summaries = (body as { itemSummaries?: unknown }).itemSummaries;
  if (!Array.isArray(summaries)) return [];
  const quotes: QuoteDraft[] = [];
  for (const row of summaries) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const amount = amountOf(item.price);
    if (!amount) continue;
    quotes.push({
      source: "ebay_listed",
      price: amount.price,
      currency: amount.currency,
      qty: null,
      condition: textOf(item.condition),
      sellerName: sellerOf(item.seller),
      url: textOf(item.itemWebUrl),
      notes: textOf(item.title),
      raw: slimItem(item),
    });
  }
  return quotes;
}

export function quotesFromInsights(body: unknown): QuoteDraft[] {
  if (!body || typeof body !== "object") return [];
  const sales = (body as { itemSales?: unknown }).itemSales;
  if (!Array.isArray(sales)) return [];
  const quotes: QuoteDraft[] = [];
  for (const row of sales) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const amount = amountOf(item.lastSoldPrice);
    if (!amount) continue;
    const qty = asMoney(item.totalSoldQuantity);
    quotes.push({
      source: "ebay_sold",
      price: amount.price,
      currency: amount.currency,
      qty: qty != null && qty > 0 ? qty : null,
      condition: textOf(item.condition),
      sellerName: sellerOf(item.seller),
      url: textOf(item.itemWebUrl),
      notes: textOf(item.title),
      raw: slimItem(item),
    });
  }
  return quotes;
}

function slimItem(item: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...item };
  delete copy.additionalImages;
  delete copy.thumbnailImages;
  delete copy.image;
  return copy;
}

export type SaleTxn = {
  type: TransactionType;
  txnDate: string;
  qty: number;
  unitPrice: number;
  total: number;
  createdAt: string;
};

export type SalesStats = {
  windowDays: number;
  lastSoldPrice: number | null;
  lastBoughtPrice: number | null;
  qtySold: number;
  revenue: number;
  avgSellPrice: number | null;
  qtyBought: number;
  spend: number;
};

export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function salesStats(txns: SaleTxn[], windowDays: number, today: string): SalesStats {
  const ordered = [...txns].sort((a, b) => {
    if (a.txnDate !== b.txnDate) return a.txnDate < b.txnDate ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  const lastSold = ordered.find((txn) => txn.type === "sell") ?? null;
  const lastBought = ordered.find((txn) => txn.type === "buy") ?? null;
  const cutoff = shiftIsoDate(today, windowDays);
  let qtySold = 0;
  let revenue = 0;
  let qtyBought = 0;
  let spend = 0;
  for (const txn of txns) {
    if (txn.txnDate < cutoff || txn.txnDate > today) continue;
    if (txn.type === "sell") {
      qtySold += txn.qty;
      revenue += txn.total;
    } else {
      qtyBought += txn.qty;
      spend += txn.total;
    }
  }
  return {
    windowDays,
    lastSoldPrice: lastSold?.unitPrice ?? null,
    lastBoughtPrice: lastBought?.unitPrice ?? null,
    qtySold,
    revenue: roundCents(revenue),
    avgSellPrice: qtySold > 0 ? roundCents(revenue / qtySold) : null,
    qtyBought,
    spend: roundCents(spend),
  };
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseWindowDays(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return null;
  return days;
}
