import { resolveSkuMap } from "@/lib/ebay/packs";
import { addressFromRecord, type SoAddress } from "@/lib/salesOrderDraft";

export const EBAY_ORDER_CUSTOMER_NAME = "eBay Customer";
export const EBAY_ORDER_CUSTOMER_QBO_ID = "1";
export const EBAY_PULL_OPERATOR_LABEL = "eBay";
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

export type SeedPlan = {
  updates: SeedUpdate[];
  linked: number;
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
  earnings: number | null;
  lines: ParsedEbayLine[];
};

export type ExistingPullOrder = {
  id: string;
  status: string;
  ebayOrderId: string | null;
  ebaySalesRecordRef: string | null;
  personEdited: boolean;
};

export type PullAction =
  | { kind: "create"; order: ParsedEbayOrder; itemIds: (string | null)[] }
  | { kind: "update"; id: string; order: ParsedEbayOrder; itemIds: (string | null)[] }
  | { kind: "link"; id: string; ebayOrderId: string; salesRecordRef: string | null }
  | { kind: "skip"; ebayOrderId: string; reason: "ambiguous" | "unchanged" };

export type DraftLine = {
  line_no: number;
  line_kind: "product";
  customer_part_number: string | null;
  customer_description: string | null;
  qty: number;
  unit_price: number | null;
  ext_price: number | null;
  item_id: string | null;
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

export function planLegacySeed(rows: readonly LegacyLogRow[], existing: readonly ExistingSeedOrder[]): SeedPlan {
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
  const claimed = new Set<string>();
  let linked = 0;
  let skipped = 0;
  let conflicts = 0;
  let missing = 0;

  for (const [ebayOrderId, group] of byOrderId) {
    const soNumbers = [...new Set(group.map((row) => row.soNumber))].sort((a, b) => a - b);
    const found = new Map<string, ExistingSeedOrder>();
    for (const soNumber of soNumbers) {
      for (const order of byNumber.get(soNumber) ?? []) found.set(order.id, order);
    }
    const sorted = [...found.values()].sort((a, b) => a.soNumber - b.soNumber || a.id.localeCompare(b.id));
    if (sorted.length === 0) {
      missing += 1;
      continue;
    }
    const target = sorted.find(
      (order) => !claimed.has(order.id) && (order.ebayOrderId == null || order.ebayOrderId === ebayOrderId),
    );
    if (!target) {
      conflicts += 1;
      continue;
    }
    const extras = sorted.filter((order) => order.id !== target.id).length;
    const records = [...new Set(group.map((row) => row.salesRecordRef).filter((value): value is string => Boolean(value)))];
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

  return { updates, linked, skipped, conflicts, missing };
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
  if (typeof row.value !== "string" || !/^\d+(\.\d+)?$/.test(row.value)) return { currency, amount: null };
  const amount = Math.round(Number(row.value) * 100) / 100;
  if (!Number.isFinite(amount)) return { currency, amount: null };
  return { currency, amount };
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
    const lines: ParsedEbayLine[] = [];
    if (Array.isArray(order.lineItems)) {
      for (const rawLine of order.lineItems) {
        if (!rawLine || typeof rawLine !== "object") continue;
        const line = rawLine as Record<string, unknown>;
        const qty = typeof line.quantity === "number" ? line.quantity : Number(line.quantity);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const cost = money(line.lineItemCost);
        lines.push({
          sku: text(line.sku, 80),
          title: text(line.title, 500),
          qty,
          unitPrice: cost.amount == null ? null : unitFromTotal(cost.amount, qty),
        });
      }
    }
    const currency = total.currency ?? fee.currency ?? earnings.currency ?? "USD";
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
      lines,
    });
  }
  return out;
}

export function planOrderPull(
  orders: readonly ParsedEbayOrder[],
  existing: readonly ExistingPullOrder[],
  items: readonly { id: string; sku: string }[],
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

  const skuMap = resolveSkuMap(
    orders.flatMap((order) => order.lines.map((line) => line.sku).filter((sku): sku is string => Boolean(sku))),
    items,
  );
  const actions: PullAction[] = [];
  const seen = new Set<string>();
  for (const order of orders) {
    if (seen.has(order.ebayOrderId)) {
      actions.push({ kind: "skip", ebayOrderId: order.ebayOrderId, reason: "unchanged" });
      continue;
    }
    seen.add(order.ebayOrderId);
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
    const itemIds = order.lines.map((line) => (line.sku ? skuMap.get(line.sku) ?? null : null));
    if (!match) {
      remember({
        id: `new:${order.ebayOrderId}`,
        status: "draft",
        ebayOrderId: order.ebayOrderId,
        ebaySalesRecordRef: order.salesRecordRef,
        personEdited: false,
      });
      actions.push({ kind: "create", order, itemIds });
      continue;
    }
    if (match.status === "draft" && !match.personEdited && !match.id.startsWith("new:")) {
      actions.push({ kind: "update", id: match.id, order, itemIds });
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
}): Record<string, unknown> {
  return {
    status: "draft",
    so_number: null,
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
    ebay_label_fee: null,
    ebay_ad_fee: null,
    ebay_order_earnings: input.order.earnings,
    operator_id: null,
    approved_at: null,
    approved_by: null,
  };
}

export function draftLines(order: ParsedEbayOrder, itemIds: readonly (string | null)[]): DraftLine[] {
  return order.lines.map((line, index) => {
    const description = line.title ?? (line.sku ? null : "eBay item");
    return {
      line_no: index + 1,
      line_kind: "product" as const,
      customer_part_number: line.sku,
      customer_description: description,
      qty: line.qty,
      unit_price: line.unitPrice,
      ext_price: extension(line.qty, line.unitPrice),
      item_id: itemIds[index] ?? null,
    };
  });
}

export function orderPullWindows(now: Date, watermark: string | null): { filter: string; history: boolean }[] {
  const stamp = (date: Date) => date.toISOString();
  const range = (field: string, start: Date, end: Date) => `${field}:[${stamp(start)}..${stamp(end)}]`;
  if (watermark && !Number.isNaN(Date.parse(watermark))) {
    return [{ filter: range("lastmodifieddate", new Date(Date.parse(watermark) - DAY_MS), now), history: false }];
  }
  const end = now.getTime();
  const start = end - 729 * DAY_MS;
  const windows: { filter: string; history: boolean }[] = [];
  for (let cursor = start; cursor < end; cursor += 90 * DAY_MS) {
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

export function pageNext(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const next = (body as { next?: unknown }).next;
  return typeof next === "string" && next ? next : null;
}
