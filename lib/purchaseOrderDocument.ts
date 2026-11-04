import { documentPartyLines, documentQty, CUSTOMER_DOCUMENT_COMPANY } from "@/lib/customerDocument";
import { formatDataDate } from "@/lib/formatDate";
import { formatUnitPrice } from "@/lib/poLineMoney";
import { formatMoney } from "@/lib/pricing/quotes";
import type { SoAddress } from "@/lib/salesOrderDraft";

export const PURCHASE_ORDER_DOCUMENT_TITLE = "PURCHASE ORDER";

export type PurchaseOrderDocumentLine = {
  sku: string;
  description: string;
  extra: string[];
  qty: string;
  unitPrice: string;
  extPrice: string;
};

export type PurchaseOrderDocument = {
  title: string;
  barcode: string;
  number: string;
  documentDate: string;
  orderDate: string;
  expectedOn: string;
  terms: string;
  fulfillment: string;
  vendorLines: string[];
  shipToLines: string[];
  tracking: string;
  notes: string[];
  lines: PurchaseOrderDocumentLine[];
  subtotal: string;
  freight: string;
  total: string;
};

export type PurchaseOrderDocumentInput = {
  number: string;
  documentDate: string;
  orderDate: string;
  expectedOn: string;
  terms: string;
  fulfillment: string;
  vendorName: string;
  vendorAddress: SoAddress;
  vendorPhone: string;
  vendorEmail: string;
  shipTo: SoAddress;
  tracking: string;
  vendorNotes: string;
  currency: string;
  freight: number;
  lines: {
    sku: string;
    description: string;
    condition: string;
    qty: string;
    unitPrice: number;
    extPrice: number;
  }[];
};

export function purchaseOrderFulfillmentLabel(fulfillment: string): string {
  if (fulfillment === "drop_ship") return "Drop ship";
  if (fulfillment === "warehouse") return "Warehouse";
  return fulfillment.trim();
}

/** Warehouse orders with no stored ship-to print the company address. Drop ship with none says so. */
export function purchaseOrderShipToLines(input: { fulfillment: string; shipTo: SoAddress }): string[] {
  const typed = documentPartyLines("", input.shipTo);
  if (typed.length > 0) return typed;
  if (input.fulfillment === "drop_ship") return ["Drop ship"];
  return [CUSTOMER_DOCUMENT_COMPANY.name, CUSTOMER_DOCUMENT_COMPANY.address];
}

export function purchaseOrderVendorLines(input: {
  name: string;
  address: SoAddress;
  phone: string;
  email: string;
}): string[] {
  const tail = [input.phone.trim(), input.email.trim()].filter(Boolean);
  return documentPartyLines(input.name, input.address, tail);
}

export function purchaseOrderDocumentNotes(vendorNotes: string): string[] {
  return vendorNotes
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function unitPriceText(amount: number, currency: string): string {
  const body = formatUnitPrice(amount);
  const fraction = body.split(".")[1] ?? "";
  if (fraction.length > 2) return `$${body}`;
  return formatMoney(amount, currency);
}

export function buildPurchaseOrderDocument(input: PurchaseOrderDocumentInput): PurchaseOrderDocument | null {
  const number = input.number.trim();
  if (!/^PO[0-9]+$/i.test(number)) return null;
  const lines = input.lines.map((line) => ({
    sku: line.sku.trim(),
    description: line.description.trim() || line.sku.trim() || "Item",
    extra: line.condition.trim() ? [`Condition: ${line.condition.trim()}`] : [],
    qty: documentQty(line.qty),
    unitPrice: unitPriceText(line.unitPrice, input.currency),
    extPrice: formatMoney(line.extPrice, input.currency),
  }));
  const subtotalCents = input.lines.reduce((sum, line) => sum + Math.round(line.extPrice * 100), 0);
  const freight = Number.isFinite(input.freight) ? input.freight : 0;
  const freightCents = Math.round(freight * 100);
  const subtotal = subtotalCents / 100;
  const total = (subtotalCents + freightCents) / 100;
  return {
    title: PURCHASE_ORDER_DOCUMENT_TITLE,
    barcode: number.toUpperCase().startsWith("PO") ? `PO${number.replace(/^PO/i, "")}` : number,
    number: `PO${number.replace(/^PO/i, "")}`,
    documentDate: formatDataDate(input.documentDate),
    orderDate: formatDataDate(input.orderDate),
    expectedOn: formatDataDate(input.expectedOn),
    terms: input.terms.trim(),
    fulfillment: purchaseOrderFulfillmentLabel(input.fulfillment),
    vendorLines: purchaseOrderVendorLines({
      name: input.vendorName,
      address: input.vendorAddress,
      phone: input.vendorPhone,
      email: input.vendorEmail,
    }),
    shipToLines: purchaseOrderShipToLines({ fulfillment: input.fulfillment, shipTo: input.shipTo }),
    tracking: input.tracking.trim(),
    notes: purchaseOrderDocumentNotes(input.vendorNotes),
    lines,
    subtotal: formatMoney(subtotal, input.currency),
    freight: formatMoney(freight, input.currency),
    total: formatMoney(total, input.currency),
  };
}
