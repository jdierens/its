import { formatExtension, formatUnitPrice, roundPlaces } from "@/lib/poLineMoney";
import { lineExtension, salesOrderTotal } from "@/lib/salesOrderDraft";

export const PAYPAL_FEE = "paypal";

export const PAYPAL_FEE_DOMESTIC_SKU = "102475";
export const PAYPAL_FEE_INTERNATIONAL_SKU = "102476";

/** app_settings key. Not a credential. */
export const PAYPAL_FEE_DOMESTIC_SETTING = "paypal_fee_domestic_sku";
/** app_settings key. Not a credential. */
export const PAYPAL_FEE_INTERNATIONAL_SETTING = "paypal_fee_international_sku";

const UNITED_STATES = new Set(["us", "usa", "united states", "united states of america"]);

export type PaypalFeeFormula = {
  fixed: number;
  percent: number;
};

export type PaypalFeeItem = {
  id: string;
  sku: string;
  name: string;
  description: string;
};

export type PaypalFeeCatalog = {
  domesticSku: string;
  internationalSku: string;
  domestic: PaypalFeeItem | null;
  international: PaypalFeeItem | null;
};

export type PaypalFeeLine = {
  managedFee?: string;
  lineKind: string;
  customerPartNumber: string;
  customerDescription: string;
  qty: string;
  unitPrice: string;
  extPrice?: string;
  allocations: { itemId: string; qty: string; unitPrice: string }[];
};

export function paypalFeeSkuFromSetting(value: string | null | undefined, fallback: string): string {
  const sku = (value ?? "").trim();
  return sku || fallback;
}

export function isManagedPaypalFee(line: { managedFee?: string | null }): boolean {
  return (line.managedFee ?? "").trim().toLowerCase() === PAYPAL_FEE;
}

/** A filled country that is not the United States makes the fee international. */
export function paypalFeeIsInternational(shipCountry: string, billCountry: string): boolean {
  return [shipCountry, billCountry].some((country) => {
    const normalized = normalizeCountry(country);
    return normalized.length > 0 && !UNITED_STATES.has(normalized);
  });
}

function normalizeCountry(value: string): string {
  return value.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
}

/**
 * Reads the fixed amount and the percent from a fee item description.
 * `$0.75 + 3.5%` and `3.5% + $0.75` both work. A description that does not
 * contain both numbers returns null so the caller can show an error.
 */
export function parsePaypalFeeFormula(description: string): PaypalFeeFormula | null {
  const text = description.replace(/,/g, "");
  const dollarFirst = /\$\s*(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\s*(?:%|percent\b)/i.exec(text);
  if (dollarFirst) return formula(dollarFirst[1], dollarFirst[2]);
  const percentFirst = /(\d+(?:\.\d+)?)\s*(?:%|percent\b)\s*\+\s*\$?\s*(\d+(?:\.\d+)?)/i.exec(text);
  if (percentFirst) return formula(percentFirst[2], percentFirst[1]);
  const plain = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\s*(?:%|percent\b)/i.exec(text);
  if (plain) return formula(plain[1], plain[2]);
  return null;
}

function formula(fixedText: string, percentText: string): PaypalFeeFormula | null {
  const fixed = Number(fixedText);
  const percent = Number(percentText);
  if (!Number.isFinite(fixed) || !Number.isFinite(percent) || fixed < 0 || percent < 0) return null;
  return { fixed, percent };
}

/** `fixed + orderTotal * (percent / 100)`, rounded to cents. */
export function paypalFeeAmount(orderTotal: number, formula: PaypalFeeFormula): number {
  return roundPlaces(formula.fixed + orderTotal * (formula.percent / 100), 2);
}

/**
 * Buyer total for the fee formula.
 * The sum of line extensions, excluding the auto-managed PayPal fee line.
 * A line with no extension is skipped. An order with no priced lines is 0.
 */
export function paypalFeeBase(lines: { managedFee?: string | null; qty: string; unitPrice: string; extPrice?: string }[]): number {
  const rows = lines.filter((line) => !isManagedPaypalFee(line)).map((line) => {
    const ext = (line.extPrice ?? "").trim() || lineExtension(line.qty, line.unitPrice) || "";
    return { extPrice: ext };
  });
  return salesOrderTotal(rows) ?? 0;
}

export function syncPaypalFeeLines<T extends PaypalFeeLine>(
  lines: T[],
  input: {
    paymentMethod: string;
    shipCountry: string;
    billCountry: string;
    catalog: PaypalFeeCatalog | null;
    createLine: (previous: T | undefined, item: PaypalFeeItem, unitPrice: string, extPrice: string) => T;
  },
): { lines: T[]; error: string | null } {
  const kept = lines.filter((line) => !isManagedPaypalFee(line));
  if (input.paymentMethod.trim().toLowerCase() !== PAYPAL_FEE) return { lines: kept, error: null };
  if (!input.catalog) return { lines: kept, error: "PayPal fee settings could not be loaded." };

  const international = paypalFeeIsInternational(input.shipCountry, input.billCountry);
  const sku = international ? input.catalog.internationalSku : input.catalog.domesticSku;
  const item = international ? input.catalog.international : input.catalog.domestic;
  const label = international ? "International" : "Domestic";
  if (!item) {
    return {
      lines: kept,
      error: `PayPal fee item ${sku || "(not set)"} was not found. Set Fee - Paypal ${label} in Admin settings.`,
    };
  }
  const parsed = parsePaypalFeeFormula(item.description);
  if (!parsed) {
    const shown = item.description.trim() || "(empty)";
    return {
      lines: kept,
      error: `PayPal fee item ${item.sku} needs a description like $0.75 + 3.5%. Its description is "${shown}".`,
    };
  }
  const amount = paypalFeeAmount(paypalFeeBase(kept), parsed);
  const unitPrice = formatUnitPrice(amount);
  const extPrice = formatExtension(amount);
  const previous = lines.find((line) => isManagedPaypalFee(line));
  return { lines: [...kept, input.createLine(previous, item, unitPrice, extPrice)], error: null };
}
