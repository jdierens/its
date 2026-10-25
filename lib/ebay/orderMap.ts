import { ebayIncotermsFromSetting, ebayPaymentTermsFromSetting } from "@/lib/ebayOrderDefaults";
import { ebaySalesRepFromSetting } from "@/lib/ebaySalesRep";
import { allocationQtyForLine, assignListingSku } from "@/lib/ebay/packs";
import { addressFromRecord, type SoAddress } from "@/lib/salesOrderDraft";

export const EBAY_ORDER_CUSTOMER_NAME = "eBay Customer";
export const EBAY_ORDER_CUSTOMER_QBO_ID = "1";
export const EBAY_PULL_OPERATOR_LABEL = "eBay";
/** Orders before this date stay out of the pull. Beginning inventory is 2026-01-01. */
export const EBAY_ORDER_CUTOFF = "2026-01-01";
const EBAY_ORDER_CUTOFF_MS = Date.parse("2026-01-01T00:00:00.000Z");
export const SEED_REQUIRED_MESSAGE =
  "Seed the legacy log map before pulling eBay orders. Imported history would otherwise create duplicate drafts.";
export const ORDER_PAGE_SIZE = 200;
export const ORDER_PAGE_LIMIT = 40;

const ORDER_ID = /^\d{2}-\d{4,6}-\d{4,6}$/;
const SALES_RECORD = /^\d{1,12}$/;
const SO_REF = /^SO#?(\d{1,12})(?:\b|-|$)/i;
const DAY_MS = 24 * 60 * 60 * 1000;

export type LegacyLogRow = {
  soNumber: number;
  ebayOrderId: string;
  salesRecordRef: string | null;
};

export type ExistingSeedOrder = {
  id: string;
  soNumber: number;
  ebayOrderId: string | null;
  ebaySalesRecordRef: string | null;
};

export type SeedUpdate = {
  id: string;
  ebayOrderId: string;
  salesRecordRef: string | null;
};

export type SeedDraft = {
  id: string;
  status: string;
  soNumber: number | null;
  ebayOrderId: string | null;
  ebaySalesRecordRef: string | null;
};

export type SoNumberAssignment = {
  id: string;
  soNumber: number;
  salesRecordRef: string | null;
};

export type LegacyMapEntry = {
  ebayOrderId: string;
  soNumber: number;
  salesRecordRef: string | null;
};

export type SeedPlan = {
  updates: SeedUpdate[];
  assignments: SoNumberAssignment[];
  map: LegacyMapEntry[];
  linked: number;
  assigned: number;
  skipped: number;
  conflicts: number;
  missing: number;
};

export type EbayBuyer = {
  username: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
};

export type ParsedEbayLine = {
  sku: string | null;
  title: string | null;
  qty: number;
  /** Unit price after eBay's discount. Not a hardcoded percent. */
  unitPrice: number | null;
};

export type ParsedEbayOrder = {
  ebayOrderId: string;
  salesRecordRef: string | null;
  buyer: EbayBuyer;
  shipTo: SoAddress;
  orderDate: string | null;
  currency: string;
  paymentStatus: "unpaid" | "partial" | "paid";
  paymentDate: string | null;
  transactionFee: number | null;
  /**
   * paymentSummary.totalDueSeller. For a normal paid order this is the buyer
   * total minus totalMarketplaceFee. It is not the merchandise total, and a
   * later shipping-label debit does not change it.
   */
  earnings: number | null;
  /** Buyer shipping charged on the order, after any delivery discount. */
  shippingAmount: number | null;
  /**
   * Seller's eBay shipping-label debit. Undefined until a finances read sets it.
   * Null means the read found no label. A number is the net debit.
   */
  labelFee?: number | null;
  lines: ParsedEbayLine[];
};

export type ExistingPullOrder = {
  id: string;
  status: string;
  ebayOrderId: string | null;
  ebaySalesRecordRef: string | null;
  personEdited: boolean;
  soNumber?: number | null;
};

export type LegacySoNumber = {
  ebayOrderId: string;
  soNumber: number;
};

/** ITS item that receives every eBay buyer-shipping freight line. */
export const EBAY_SHIPPING_ITEM_SKU = "4343";

export function ebayShippingItemId(items: readonly { id: string; sku: string }[]): string | null {
  const wanted = EBAY_SHIPPING_ITEM_SKU.toLowerCase();
  const hit = items.find((item) => item.sku.trim().toLowerCase() === wanted);
  return hit?.id ?? null;
}

export type PullAction =
  | { kind: "create"; order: ParsedEbayOrder; itemIds: (string | null)[]; allocationQtys: (number | null)[]; shippingItemId: string | null; soNumber: number | null }
  | { kind: "update"; id: string; order: ParsedEbayOrder; itemIds: (string | null)[]; allocationQtys: (number | null)[]; shippingItemId: string | null; soNumber: number | null }
  | { kind: "link"; id: string; ebayOrderId: string; salesRecordRef: string | null }
  | { kind: "skip"; ebayOrderId: string; reason: "ambiguous" | "unchanged" | "before-cutoff" };

export type DraftLine = {
  line_no: number;
  line_kind: "product" | "freight";
  customer_part_number: string | null;
  customer_description: string | null;
  qty: number;
  unit_price: number | null;
  ext_price: number | null;
  item_id: string | null;
  /** Pieces allocated to item_id. A pack label can be larger than the customer qty. */
  allocation_qty: number | null;
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  return rows;
}

export function parseLegacyLogCsv(text: string): LegacyLogRow[] {
  const table = parseCsv(text);
  let headerIndex = -1;
  let orderCol = -1;
  let recordCol = -1;
  let refCol = -1;
  for (let i = 0; i < Math.min(table.length, 8); i += 1) {
    const headers = table[i].map((value) => value.trim().toLowerCase());
    const order = headers.indexOf("order number");
    const ref = headers.indexOf("ref");
    if (order < 0 || ref < 0) continue;
    headerIndex = i;
    orderCol = order;
    refCol = ref;
    recordCol = headers.findIndex((value) => value === "sales record no" || value === "sales record number");
    break;
  }
  if (headerIndex < 0) return [];
  const out: LegacyLogRow[] = [];
  for (const cells of table.slice(headerIndex + 1)) {
    const ebayOrderId = (cells[orderCol] ?? "").trim();
    if (!ORDER_ID.test(ebayOrderId)) continue;
    const soMatch = SO_REF.exec((cells[refCol] ?? "").trim());
    if (!soMatch) continue;
    const soNumber = Number(soMatch[1]);
    if (!Number.isSafeInteger(soNumber) || soNumber < 1) continue;
    const recordRaw = recordCol >= 0 ? (cells[recordCol] ?? "").trim() : "";
    out.push({
      soNumber,
      ebayOrderId,
      salesRecordRef: SALES_RECORD.test(recordRaw) ? recordRaw : null,
    });
  }
  return out;
}

export function planLegacySeed(
  rows: readonly LegacyLogRow[],
  existing: readonly ExistingSeedOrder[],
  drafts: readonly SeedDraft[] = [],
): SeedPlan {
  const byNumber = new Map<number, ExistingSeedOrder[]>();
  for (const order of existing) {
    const list = byNumber.get(order.soNumber) ?? [];
    list.push(order);
    byNumber.set(order.soNumber, list);
  }
  const byOrderId = new Map<string, LegacyLogRow[]>();
  for (const row of rows) {
    const list = byOrderId.get(row.ebayOrderId) ?? [];
    list.push(row);
    byOrderId.set(row.ebayOrderId, list);
  }

  const updates: SeedUpdate[] = [];
  const assignments: SoNumberAssignment[] = [];
  const map: LegacyMapEntry[] = [];
  const claimed = new Set<string>();
  const claimedNumbers = new Set<number>(existing.map((order) => order.soNumber));
  let linked = 0;
  let assigned = 0;
  let skipped = 0;
  let conflicts = 0;
  let missing = 0;

  for (const [ebayOrderId, group] of byOrderId) {
    const soNumbers = [...new Set(group.map((row) => row.soNumber))].sort((a, b) => a - b);
    const records = [...new Set(group.map((row) => row.salesRecordRef).filter((value): value is string => Boolean(value)))];
    const canonicalNumber = soNumbers[0];
    const canonicalRecord = records.length === 1 ? records[0] : null;
    if (canonicalNumber != null) {
      map.push({ ebayOrderId, soNumber: canonicalNumber, salesRecordRef: canonicalRecord });
    }
    const found = new Map<string, ExistingSeedOrder>();
    for (const soNumber of soNumbers) {
      for (const order of byNumber.get(soNumber) ?? []) found.set(order.id, order);
    }
    const sorted = [...found.values()].sort((a, b) => a.soNumber - b.soNumber || a.id.localeCompare(b.id));
    if (sorted.length === 0) {
      const matching = drafts.filter((draft) => draft.ebayOrderId === ebayOrderId);
      const already = matching.find((draft) => draft.soNumber === canonicalNumber);
      if (already) {
        skipped += 1;
        continue;
      }
      const open = matching.filter(
        (draft) => draft.status === "draft" && draft.soNumber == null && !claimed.has(draft.id),
      );
      const numberTaken = canonicalNumber != null && claimedNumbers.has(canonicalNumber);
      if (!numberTaken && open.length === 1 && canonicalNumber != null) {
        const draft = open[0];
        assignments.push({
          id: draft.id,
          soNumber: canonicalNumber,
          salesRecordRef: draft.ebaySalesRecordRef == null ? canonicalRecord : null,
        });
        claimed.add(draft.id);
        claimedNumbers.add(canonicalNumber);
        assigned += 1;
        if (soNumbers.length > 1) conflicts += soNumbers.length - 1;
        if (records.length > 1) conflicts += 1;
        continue;
      }
      if (matching.length === 0 && !numberTaken) {
        missing += 1;
        continue;
      }
      conflicts += 1;
      continue;
    }
    const target = sorted.find(
      (order) => !claimed.has(order.id) && (order.ebayOrderId == null || order.ebayOrderId === ebayOrderId),
    );
    const draftOwnsId = drafts.some((draft) => draft.id !== target?.id && draft.ebayOrderId === ebayOrderId);
    if (!target || draftOwnsId) {
      conflicts += 1;
      continue;
    }
    const extras = sorted.filter((order) => order.id !== target.id).length;
    const recordConflict =
      records.length > 1 || (records.length === 1 && target.ebaySalesRecordRef != null && target.ebaySalesRecordRef !== records[0]);
    const salesRecordRef = records.length === 1 && target.ebaySalesRecordRef == null ? records[0] : null;
    const fillOrder = target.ebayOrderId == null;
    claimed.add(target.id);
    if (!fillOrder && salesRecordRef == null) {
      if (extras > 0 || recordConflict) conflicts += extras + (recordConflict ? 1 : 0);
      else skipped += 1;
      continue;
    }
    updates.push({ id: target.id, ebayOrderId, salesRecordRef });
    linked += 1;
    conflicts += extras + (recordConflict ? 1 : 0);
  }

  return { updates, assignments, map, linked, assigned, skipped, conflicts, missing };
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function money(value: unknown): { currency: string | null; amount: number | null } {
  if (!value || typeof value !== "object") return { currency: null, amount: null };
  const row = value as { value?: unknown; currency?: unknown };
  const currency = typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) ? row.currency : null;
  if (typeof row.value !== "string" || !/^-?\d+(\.\d+)?$/.test(row.value)) return { currency, amount: null };
  const amount = Math.round(Number(row.value) * 100) / 100;
  if (!Number.isFinite(amount)) return { currency, amount: null };
  return { currency, amount };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** eBay sends delivery and price discounts as negative numbers. A positive value is the same reduction. */
function netCharge(gross: number | null, discount: number | null): number | null {
  if (gross == null && discount == null) return null;
  const off = discount == null ? 0 : Math.abs(discount);
  const net = roundMoney((gross ?? 0) - off);
  return net > 0 ? net : null;
}

function promotionDiscount(line: Record<string, unknown>): number {
  if (!Array.isArray(line.appliedPromotions)) return 0;
  let sum = 0;
  for (const promo of line.appliedPromotions) {
    if (!promo || typeof promo !== "object") continue;
    const amount = money((promo as { discountAmount?: unknown }).discountAmount).amount;
    if (amount != null && amount > 0) sum += amount;
  }
  return roundMoney(sum);
}

/**
 * Merchandise for one line after the discount eBay actually applied.
 * discountedLineItemCost wins. Otherwise lineItemCost minus appliedPromotions.
 * The promotion title can say 5% while the amount is a cap, so the percent is never assumed.
 */
function merchandiseAfterDiscount(line: Record<string, unknown>): { amount: number | null; discounted: boolean } {
  const discounted = money(line.discountedLineItemCost).amount;
  if (discounted != null) return { amount: Math.max(0, discounted), discounted: true };
  const cost = money(line.lineItemCost).amount;
  if (cost == null) return { amount: null, discounted: false };
  const off = promotionDiscount(line);
  if (off <= 0) return { amount: Math.max(0, cost), discounted: false };
  return { amount: Math.max(0, roundMoney(cost - off)), discounted: true };
}

/** Spread an order-level discount across line merchandise. The last line absorbs the remainder. */
export function allocateDiscount(amounts: readonly number[], discount: number): number[] {
  const off = Math.min(Math.abs(discount), amounts.reduce((sum, amount) => sum + Math.max(0, amount), 0));
  if (!(off > 0)) return amounts.map((amount) => roundMoney(amount));
  const base = amounts.reduce((sum, amount) => sum + Math.max(0, amount), 0);
  let remaining = off;
  return amounts.map((amount, index) => {
    const safe = Math.max(0, amount);
    if (index === amounts.length - 1) return roundMoney(Math.max(0, safe - remaining));
    const share = roundMoney(off * (safe / base));
    const take = Math.min(share, remaining, safe);
    remaining = roundMoney(remaining - take);
    return roundMoney(safe - take);
  });
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

function paymentStatus(value: unknown): "unpaid" | "partial" | "paid" {
  if (value === "PAID") return "paid";
  if (value === "PARTIALLY_REFUNDED") return "partial";
  return "unpaid";
}

function unitFromTotal(total: number, qty: number): number | null {
  if (!(qty > 0) || !Number.isFinite(total) || total < 0) return null;
  const unit = Math.round((total / qty) * 10000) / 10000;
  return Number.isFinite(unit) && unit >= 0 ? unit : null;
}

function extension(qty: number, unit: number | null): number | null {
  if (unit == null) return null;
  return Math.round(qty * unit * 100) / 100;
}

function emptyAddress(): SoAddress {
  return addressFromRecord(null);
}

function lineShipping(order: Record<string, unknown>): number | null {
  if (!Array.isArray(order.lineItems)) return null;
  let sum = 0;
  let any = false;
  for (const raw of order.lineItems) {
    if (!raw || typeof raw !== "object") continue;
    const delivery = (raw as { deliveryCost?: unknown }).deliveryCost;
    if (!delivery || typeof delivery !== "object") continue;
    const row = delivery as Record<string, unknown>;
    const gross = roundMoney(
      (money(row.shippingCost).amount ?? 0) + (money(row.handlingCost).amount ?? 0) + (money(row.importCharges).amount ?? 0),
    );
    const net = netCharge(gross, money(row.discountAmount).amount);
    if (net == null) continue;
    any = true;
    sum += net;
  }
  if (!any) return null;
  const total = roundMoney(sum);
  return total > 0 ? total : null;
}

function readShip(order: Record<string, unknown>): { shipTo: SoAddress; name: string | null; email: string | null; phone: string | null } {
  const shipTo = emptyAddress();
  let name: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  const instructions = Array.isArray(order.fulfillmentStartInstructions) ? order.fulfillmentStartInstructions : [];
  for (const instruction of instructions) {
    if (!instruction || typeof instruction !== "object") continue;
    const step = (instruction as { shippingStep?: unknown }).shippingStep;
    if (!step || typeof step !== "object") continue;
    const raw = (step as { shipTo?: unknown }).shipTo;
    if (!raw || typeof raw !== "object") continue;
    const contact = raw as Record<string, unknown>;
    const address =
      contact.contactAddress && typeof contact.contactAddress === "object"
        ? (contact.contactAddress as Record<string, unknown>)
        : contact;
    shipTo.line1 = text(address.addressLine1, 200) ?? "";
    shipTo.line2 = text(address.addressLine2, 200) ?? "";
    shipTo.city = text(address.city, 120) ?? "";
    shipTo.countrySubDivisionCode = text(address.stateOrProvince, 80) ?? "";
    shipTo.postalCode = text(address.postalCode, 20) ?? "";
    shipTo.country = text(address.countryCode, 2) ?? "";
    name = text(contact.fullName, 200);
    email = text(contact.email, 200);
    const primary = contact.primaryPhone;
    phone =
      primary && typeof primary === "object"
        ? text((primary as { phoneNumber?: unknown }).phoneNumber, 40)
        : text(primary, 40);
    shipTo.attention = name ?? "";
    shipTo.phone = phone ?? "";
    if (shipTo.line1 || name) break;
  }
  return { shipTo, name, email, phone };
}

export function parseFulfillmentOrders(body: unknown): ParsedEbayOrder[] {
  if (!body || typeof body !== "object" || !Array.isArray((body as { orders?: unknown }).orders)) return [];
  const out: ParsedEbayOrder[] = [];
  for (const raw of (body as { orders: unknown[] }).orders) {
    if (!raw || typeof raw !== "object") continue;
    const order = raw as Record<string, unknown>;
    const ebayOrderId = text(order.orderId, 40) ?? "";
    if (!ORDER_ID.test(ebayOrderId)) continue;
    const salesRaw = text(order.salesRecordReference, 40) ?? "";
    const ship = readShip(order);
    const buyerRaw = order.buyer && typeof order.buyer === "object" ? (order.buyer as Record<string, unknown>) : {};
    const pricing = order.pricingSummary && typeof order.pricingSummary === "object" ? (order.pricingSummary as Record<string, unknown>) : {};
    const total = money(pricing.total);
    const fee = money(order.totalMarketplaceFee);
    const payment = order.paymentSummary && typeof order.paymentSummary === "object" ? (order.paymentSummary as Record<string, unknown>) : {};
    const earnings = money(payment.totalDueSeller);
    const status = paymentStatus(order.orderPaymentStatus);
    const payments = Array.isArray(payment.payments) ? payment.payments : [];
    const paid = payments.find(
      (entry) => entry && typeof entry === "object" && (entry as { paymentStatus?: unknown }).paymentStatus === "PAID",
    ) as { paymentDate?: unknown } | undefined;
    const pending: { sku: string | null; title: string | null; qty: number; amount: number | null; discounted: boolean }[] = [];
    if (Array.isArray(order.lineItems)) {
      for (const rawLine of order.lineItems) {
        if (!rawLine || typeof rawLine !== "object") continue;
        const line = rawLine as Record<string, unknown>;
        const qty = typeof line.quantity === "number" ? line.quantity : Number(line.quantity);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const merch = merchandiseAfterDiscount(line);
        pending.push({
          sku: text(line.sku, 80),
          title: text(line.title, 500),
          qty,
          amount: merch.amount,
          discounted: merch.discounted,
        });
      }
    }
    const lineDiscounted = pending.some((line) => line.discounted);
    const orderDiscount = money(pricing.priceDiscount).amount;
    const amounts = pending.map((line) => line.amount);
    if (!lineDiscounted && orderDiscount != null && orderDiscount !== 0) {
      const indexes = pending.flatMap((line, index) => (line.amount == null ? [] : [index]));
      const allocated = allocateDiscount(
        indexes.map((index) => pending[index].amount ?? 0),
        orderDiscount,
      );
      indexes.forEach((index, slot) => {
        amounts[index] = allocated[slot];
      });
    }
    const lines: ParsedEbayLine[] = pending.map((line, index) => ({
      sku: line.sku,
      title: line.title,
      qty: line.qty,
      unitPrice: amounts[index] == null ? null : unitFromTotal(amounts[index], line.qty),
    }));
    const currency = total.currency ?? fee.currency ?? earnings.currency ?? "USD";
    const shippingKnown = pricing.deliveryCost != null || pricing.deliveryDiscount != null;
    const shippingAmount = shippingKnown
      ? netCharge(money(pricing.deliveryCost).amount, money(pricing.deliveryDiscount).amount)
      : lineShipping(order);
    out.push({
      ebayOrderId,
      salesRecordRef: SALES_RECORD.test(salesRaw) ? salesRaw : null,
      buyer: {
        username: text(buyerRaw.username, 80),
        name: ship.name,
        email: ship.email,
        phone: ship.phone,
      },
      shipTo: ship.shipTo,
      orderDate: dateOnly(order.creationDate),
      currency,
      paymentStatus: status,
      paymentDate: status === "paid" ? dateOnly(paid?.paymentDate) : null,
      transactionFee: fee.amount,
      earnings: earnings.amount,
      shippingAmount,
      lines,
    });
  }
  return out;
}

function orderForItems(
  order: ParsedEbayOrder,
  items: readonly { id: string; sku: string }[],
): { order: ParsedEbayOrder; itemIds: (string | null)[]; allocationQtys: (number | null)[] } {
  const itemIds: (string | null)[] = [];
  const allocationQtys: (number | null)[] = [];
  for (const line of order.lines) {
    const sku = line.sku?.trim() ?? "";
    const assigned = sku ? assignListingSku(sku, items) : { itemId: null, packQty: 1, baseSku: null };
    itemIds.push(assigned.itemId);
    if (!assigned.itemId) {
      allocationQtys.push(null);
      continue;
    }
    // An exact item, including a label that is itself a SKU, allocates the customer quantity.
    allocationQtys.push(assigned.packQty > 1 ? allocationQtyForLine(sku, line.qty) : line.qty);
  }
  return { order, itemIds, allocationQtys };
}

export function planOrderPull(
  orders: readonly ParsedEbayOrder[],
  existing: readonly ExistingPullOrder[],
  items: readonly { id: string; sku: string }[],
  legacy: readonly LegacySoNumber[] = [],
): PullAction[] {
  const byOrderId = new Map<string, ExistingPullOrder[]>();
  const byRecord = new Map<string, ExistingPullOrder[]>();
  const remember = (row: ExistingPullOrder) => {
    if (row.ebayOrderId) {
      const list = byOrderId.get(row.ebayOrderId) ?? [];
      if (!list.some((item) => item.id === row.id)) list.push(row);
      byOrderId.set(row.ebayOrderId, list);
    }
    if (row.ebaySalesRecordRef) {
      const list = byRecord.get(row.ebaySalesRecordRef) ?? [];
      if (!list.some((item) => item.id === row.id)) list.push(row);
      byRecord.set(row.ebaySalesRecordRef, list);
    }
  };
  for (const row of existing) remember(row);

  const legacyById = new Map<string, number>();
  for (const row of legacy) {
    if (!legacyById.has(row.ebayOrderId) && Number.isSafeInteger(row.soNumber) && row.soNumber >= 1) {
      legacyById.set(row.ebayOrderId, row.soNumber);
    }
  }
  const takenNumbers = new Set<number>();
  for (const row of existing) {
    if (row.soNumber != null && Number.isSafeInteger(row.soNumber) && row.soNumber >= 1) takenNumbers.add(row.soNumber);
  }
  const claimLegacy = (ebayOrderId: string, current: number | null | undefined): number | null => {
    if (current != null) return null;
    const wanted = legacyById.get(ebayOrderId);
    if (wanted == null || takenNumbers.has(wanted)) return null;
    takenNumbers.add(wanted);
    return wanted;
  };
  const actions: PullAction[] = [];
  const seen = new Set<string>();
  for (const source of orders) {
    const order = source;
    if (seen.has(order.ebayOrderId)) {
      actions.push({ kind: "skip", ebayOrderId: order.ebayOrderId, reason: "unchanged" });
      continue;
    }
    seen.add(order.ebayOrderId);
    if (!orderInPullWindow(order.orderDate)) {
      actions.push({ kind: "skip", ebayOrderId: order.ebayOrderId, reason: "before-cutoff" });
      continue;
    }
    const idHits = byOrderId.get(order.ebayOrderId) ?? [];
    if (idHits.length > 1) {
      actions.push({ kind: "skip", ebayOrderId: order.ebayOrderId, reason: "ambiguous" });
      continue;
    }
    let match = idHits[0] ?? null;
    if (!match && order.salesRecordRef) {
      const recordHits = byRecord.get(order.salesRecordRef) ?? [];
      if (recordHits.length > 1) {
        actions.push({ kind: "skip", ebayOrderId: order.ebayOrderId, reason: "ambiguous" });
        continue;
      }
      match = recordHits[0] ?? null;
    }
    const prepared = orderForItems(order, items);
    const shippingItemId = ebayShippingItemId(items);
    if (!match) {
      const soNumber = claimLegacy(order.ebayOrderId, null);
      remember({
        id: `new:${order.ebayOrderId}`,
        status: "draft",
        ebayOrderId: order.ebayOrderId,
        ebaySalesRecordRef: order.salesRecordRef,
        personEdited: false,
        soNumber,
      });
      actions.push({
        kind: "create",
        order: prepared.order,
        itemIds: prepared.itemIds,
        allocationQtys: prepared.allocationQtys,
        shippingItemId,
        soNumber,
      });
      continue;
    }
    if (match.status === "draft" && !match.personEdited && !match.id.startsWith("new:")) {
      actions.push({
        kind: "update",
        id: match.id,
        order: prepared.order,
        itemIds: prepared.itemIds,
        allocationQtys: prepared.allocationQtys,
        shippingItemId,
        soNumber: claimLegacy(order.ebayOrderId, match.soNumber),
      });
      continue;
    }
    if (match.id.startsWith("new:")) {
      actions.push({ kind: "skip", ebayOrderId: order.ebayOrderId, reason: "unchanged" });
      continue;
    }
    const needsOrderId = match.ebayOrderId == null;
    const needsRecord = order.salesRecordRef != null && match.ebaySalesRecordRef == null;
    if (needsOrderId || needsRecord) {
      actions.push({
        kind: "link",
        id: match.id,
        ebayOrderId: order.ebayOrderId,
        salesRecordRef: needsRecord ? order.salesRecordRef : null,
      });
      if (needsOrderId) match.ebayOrderId = order.ebayOrderId;
      if (needsRecord && order.salesRecordRef) match.ebaySalesRecordRef = order.salesRecordRef;
      remember(match);
    } else {
      actions.push({ kind: "skip", ebayOrderId: order.ebayOrderId, reason: "unchanged" });
    }
  }
  return actions;
}

export function draftOrderRow(input: {
  order: ParsedEbayOrder;
  customerId: string;
  billTo: SoAddress | null;
  soNumber?: number | null;
  /** app_settings ebay_default_sales_rep. Empty becomes MT. */
  salesRep?: string | null;
  /** app_settings ebay_default_payment_terms. Empty becomes Payment In Advance. */
  paymentTerms?: string | null;
  /** app_settings ebay_default_incoterms. Empty becomes FOB. */
  incoterms?: string | null;
}): Record<string, unknown> {
  return {
    status: "draft",
    so_number: input.soNumber ?? null,
    sales_rep: ebaySalesRepFromSetting(input.salesRep),
    terms: ebayPaymentTermsFromSetting(input.paymentTerms),
    incoterms: ebayIncotermsFromSetting(input.incoterms),
    ...(input.soNumber != null ? { sheet_ref: `SO#${input.soNumber}` } : {}),
    customer_id: input.customerId,
    order_date: input.order.orderDate,
    ship_to: input.order.shipTo,
    bill_to: input.billTo,
    currency: input.order.currency,
    source: "ebay",
    channel: "ebay",
    source_ref: input.order.ebayOrderId,
    ebay_order_id: input.order.ebayOrderId,
    ebay_sales_record_ref: input.order.salesRecordRef,
    buyer: input.order.buyer,
    payment_requirement: "prepay",
    payment_status: input.order.paymentStatus,
    payment_method: input.order.paymentStatus === "paid" ? "ebay" : null,
    payment_date: input.order.paymentDate,
    ebay_transaction_fee: input.order.transactionFee,
    ebay_label_fee: input.order.labelFee === undefined ? null : input.order.labelFee,
    ebay_ad_fee: null,
    ebay_order_earnings: input.order.earnings,
    operator_id: null,
    approved_at: null,
    approved_by: null,
  };
}

export function draftLines(
  order: ParsedEbayOrder,
  itemIds: readonly (string | null)[],
  shippingItemId: string | null = null,
  allocationQtys?: readonly (number | null)[],
): DraftLine[] {
  const lines: DraftLine[] = order.lines.map((line, index) => {
    const description = line.title ?? (line.sku ? null : "eBay item");
    const itemId = itemIds[index] ?? null;
    const allocated = allocationQtys?.[index];
    return {
      line_no: index + 1,
      line_kind: "product" as const,
      customer_part_number: line.sku,
      customer_description: description,
      qty: line.qty,
      unit_price: line.unitPrice,
      ext_price: extension(line.qty, line.unitPrice),
      item_id: itemId,
      allocation_qty: itemId ? (allocated ?? line.qty) : null,
    };
  });
  if (order.shippingAmount != null && order.shippingAmount > 0) {
    const unit = unitFromTotal(order.shippingAmount, 1);
    lines.push({
      line_no: lines.length + 1,
      line_kind: "freight",
      customer_part_number: null,
      customer_description: "Shipping",
      qty: 1,
      unit_price: unit,
      ext_price: extension(1, unit),
      item_id: shippingItemId,
      allocation_qty: shippingItemId ? 1 : null,
    });
  }
  return lines;
}

export function labelFeeFilter(now: Date): string {
  return `transactionType:{SHIPPING_LABEL},transactionDate:[${EBAY_ORDER_CUTOFF}T00:00:00.000Z..${now.toISOString()}]`;
}

/** Net shipping-label debit per eBay order. Credits reduce the fee. Other transaction types are ignored. */
export function addLabelFees(target: Map<string, number>, body: unknown): void {
  if (!body || typeof body !== "object" || !Array.isArray((body as { transactions?: unknown }).transactions)) return;
  for (const raw of (body as { transactions: unknown[] }).transactions) {
    if (!raw || typeof raw !== "object") continue;
    const txn = raw as Record<string, unknown>;
    if (txn.transactionType !== "SHIPPING_LABEL") continue;
    const orderId = text(txn.orderId, 40) ?? "";
    if (!ORDER_ID.test(orderId)) continue;
    const amount = money(txn.amount).amount;
    if (amount == null) continue;
    const signed = txn.bookingEntry === "CREDIT" ? -amount : amount;
    target.set(orderId, roundMoney((target.get(orderId) ?? 0) + signed));
  }
}

/** Stamp a completed label scan onto parsed orders. Missing ids mean no label, so the fee is null. */
export function applyLabelFees(orders: readonly ParsedEbayOrder[], fees: ReadonlyMap<string, number>): void {
  for (const order of orders) {
    const fee = fees.get(order.ebayOrderId) ?? 0;
    order.labelFee = fee > 0 ? roundMoney(fee) : null;
  }
}

export function positiveLabelFees(fees: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [orderId, fee] of fees) {
    if (fee > 0) out.set(orderId, roundMoney(fee));
  }
  return out;
}

export function orderInPullWindow(orderDate: string | null): boolean {
  return orderDate != null && orderDate >= EBAY_ORDER_CUTOFF;
}

export function orderPullWindows(now: Date, watermark: string | null): { filter: string; history: boolean }[] {
  const stamp = (date: Date) => date.toISOString();
  const range = (field: string, start: Date, end: Date) => `${field}:[${stamp(start)}..${stamp(end)}]`;
  const end = now.getTime();
  if (!(end > EBAY_ORDER_CUTOFF_MS)) return [];
  const cutoff = new Date(EBAY_ORDER_CUTOFF_MS);
  if (watermark && !Number.isNaN(Date.parse(watermark))) {
    const modifiedStart = new Date(Math.max(Date.parse(watermark) - DAY_MS, EBAY_ORDER_CUTOFF_MS));
    return [
      {
        filter: `${range("creationdate", cutoff, now)},${range("lastmodifieddate", modifiedStart, now)}`,
        history: false,
      },
    ];
  }
  const windows: { filter: string; history: boolean }[] = [];
  for (let cursor = EBAY_ORDER_CUTOFF_MS; cursor < end; cursor += 90 * DAY_MS) {
    windows.push({
      filter: range("creationdate", new Date(cursor), new Date(Math.min(cursor + 90 * DAY_MS, end))),
      history: true,
    });
  }
  return windows;
}

export function rawOrderCount(body: unknown): number {
  if (!body || typeof body !== "object" || !Array.isArray((body as { orders?: unknown }).orders)) return 0;
  return (body as { orders: unknown[] }).orders.length;
}

export function rawTransactionCount(body: unknown): number {
  if (!body || typeof body !== "object" || !Array.isArray((body as { transactions?: unknown }).transactions)) return 0;
  return (body as { transactions: unknown[] }).transactions.length;
}

export function pageNext(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const next = (body as { next?: unknown }).next;
  return typeof next === "string" && next ? next : null;
}
