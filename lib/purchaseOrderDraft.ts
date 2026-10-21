import { parsePaymentTerm, type PaymentTerm } from "@/lib/paymentTerms";
import {
  extensionFromUnit,
  parseExtension,
  parseQty,
  parseUnitCost,
  pricesMatch,
  unitFromExtension,
} from "@/lib/poLineMoney";
import type { PurchaseAccess } from "@/lib/purchaseAccess";

export const PO_STATUSES = ["draft", "open", "partially_received", "received", "closed", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export type PoLineInput = {
  itemId: string;
  description: string;
  qty: string;
  unitCost: string;
  extPrice: string;
  condition: string;
  unit: string;
};

export type PoDraftInput = {
  vendorId: string;
  fulfillment: string;
  terms: string;
  orderedOn: string;
  expectedOn: string;
  vendorNotes: string;
  internalNotes: string;
  lines: PoLineInput[];
};

export type NormalizedPoLine = {
  itemId: string | null;
  description: string | null;
  qty: number;
  unitCost: number;
  extPrice: number;
  condition: "New" | "Used";
  unit: string;
};

export type NormalizedPoDraft = {
  vendorId: string;
  fulfillment: "warehouse" | "drop_ship";
  terms: PaymentTerm;
  orderedOn: string | null;
  expectedOn: string | null;
  vendorNotes: string | null;
  internalNotes: string | null;
  lines: NormalizedPoLine[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function purchaseOrderStatusLabel(status: string): string {
  if (status === "partially_received") return "Partially received";
  if (status === "draft") return "Draft";
  if (status === "open") return "Open";
  if (status === "received") return "Received";
  if (status === "closed") return "Closed";
  if (status === "cancelled") return "Cancelled";
  return status;
}

export function normalizePurchaseOrderDraft(input: PoDraftInput): { ok: true; value: NormalizedPoDraft } | { ok: false; error: string } {
  const vendorId = input.vendorId.trim();
  if (!UUID.test(vendorId)) return { ok: false, error: "Choose a vendor." };

  const fulfillment = input.fulfillment === "drop_ship" ? "drop_ship" : input.fulfillment === "warehouse" ? "warehouse" : null;
  if (!fulfillment) return { ok: false, error: "Choose warehouse or drop ship." };

  const orderedOn = optionalDate(input.orderedOn);
  if (orderedOn === "invalid") return { ok: false, error: "Ordered date must be a calendar date." };
  const expectedOn = optionalDate(input.expectedOn);
  if (expectedOn === "invalid") return { ok: false, error: "Expected date must be a calendar date." };

  const terms = parsePaymentTerm(input.terms);
  if (terms === "invalid") return { ok: false, error: "Choose terms." };
  const vendorNotes = clip(input.vendorNotes, 4000);
  if (vendorNotes === "long") return { ok: false, error: "Vendor notes are too long." };
  const internalNotes = clip(input.internalNotes, 4000);
  if (internalNotes === "long") return { ok: false, error: "Internal notes are too long." };

  const lines: NormalizedPoLine[] = [];
  for (const line of input.lines) {
    const blank =
      !line.itemId.trim() &&
      !line.description.trim() &&
      !line.qty.trim() &&
      !line.unitCost.trim() &&
      !line.extPrice.trim();
    if (blank) continue;

    const description = line.description.trim();
    const itemId = line.itemId.trim();
    if (itemId && !UUID.test(itemId)) return { ok: false, error: "Choose an item from the list." };
    if (!itemId && !description) return { ok: false, error: "Each line needs an item or a description." };
    if (description.length > 500) return { ok: false, error: "A line description is too long." };

    const qty = parseQty(line.qty);
    if (qty == null || qty <= 0) return { ok: false, error: "Each line needs a quantity greater than zero." };
    const priced = linePrices(line.unitCost, line.extPrice, qty);
    if (priced.ok === false) return priced;

    const condition = line.condition === "New" || line.condition === "Used" ? line.condition : null;
    if (!condition) return { ok: false, error: "Condition is New or Used." };

    const unit = line.unit.trim() || "Piece";
    if (unit.length > 40) return { ok: false, error: "Unit is too long." };

    lines.push({
      itemId: itemId || null,
      description: description || null,
      qty,
      unitCost: priced.unitCost,
      extPrice: priced.extPrice,
      condition,
      unit,
    });
  }

  if (lines.length < 1) return { ok: false, error: "Add a line." };
  if (lines.length > 100) return { ok: false, error: "A purchase order can have at most 100 lines." };

  return {
    ok: true,
    value: {
      vendorId,
      fulfillment,
      terms,
      orderedOn,
      expectedOn,
      vendorNotes,
      internalNotes,
      lines,
    },
  };
}

export function purchaseOrderTotal(lines: { extPrice: number }[]): number {
  const cents = lines.reduce((sum, line) => sum + Math.round(line.extPrice * 100), 0);
  return cents / 100;
}

export function hidePurchaseMoney<
  T extends {
    terms?: string | null;
    currency?: string | null;
    unitCost?: number | null;
    extPrice?: number | null;
    total?: number | null;
    subtotal?: number | null;
    freightIn?: number | string | null;
    internalNotes?: string | null;
  },
>(row: T, access: PurchaseAccess): T {
  if (access.canViewMoney) return row;
  return {
    ...row,
    terms: row.terms === undefined ? undefined : null,
    currency: row.currency === undefined ? undefined : null,
    unitCost: row.unitCost === undefined ? undefined : null,
    extPrice: row.extPrice === undefined ? undefined : null,
    total: row.total === undefined ? undefined : null,
    subtotal: row.subtotal === undefined ? undefined : null,
    freightIn: row.freightIn === undefined ? undefined : null,
    internalNotes: row.internalNotes === undefined ? undefined : null,
  };
}

function optionalDate(value: string): string | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!DATE.test(trimmed)) return "invalid";
  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "invalid";
  return trimmed;
}

function clip(value: string, max: number): string | null | "long" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return "long";
  return trimmed;
}

function linePrices(
  unitText: string,
  extText: string,
  qty: number,
): { ok: true; unitCost: number; extPrice: number } | { ok: false; error: string } {
  if (unitText.trim() && parseUnitCost(unitText) == null) {
    return { ok: false, error: "Unit price must be a USD amount with at most 4 decimal places." };
  }
  if (extText.trim() && parseExtension(extText) == null) return { ok: false, error: "Extension must be a USD amount." };
  let unitCost = unitText.trim() ? parseUnitCost(unitText) : null;
  let extPrice = extText.trim() ? parseExtension(extText) : null;
  if (unitCost == null && extPrice == null) return { ok: false, error: "Each line needs a unit price or an extension." };
  if (unitCost != null && extPrice == null) {
    extPrice = extensionFromUnit(qty, unitCost);
    if (extPrice > 9999999999.99) return { ok: false, error: "Extension is too large." };
  } else if (unitCost == null && extPrice != null) {
    unitCost = unitFromExtension(qty, extPrice);
  }
  if (unitCost == null || extPrice == null || !pricesMatch(qty, unitCost, extPrice)) {
    return { ok: false, error: "Quantity, unit price, and extension do not match." };
  }
  return { ok: true, unitCost, extPrice };
}
