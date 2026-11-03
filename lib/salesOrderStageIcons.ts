import { salesOrderTotal } from "@/lib/salesOrderDraft";

/**
 * Seven icons on a sales order: Approved, Picked, Packed, Shipped, Invoiced,
 * Paid, Cancelled.
 *
 * Cancelled is its own icon. It is not a step after invoicing, and it does not
 * make an earlier icon yellow. On a cancelled order, pick, pack, ship, and
 * invoice should not have happened. When one of those did, that icon is red.
 * A payment that was recorded on a cancelled order is red too. Approved may
 * still be green. The cancelled icon is green only when status is cancelled.
 *
 * On any other order, green means that stage itself is done. Yellow means a
 * later stage in Approved → Picked → Packed → Shipped → Invoiced has happened
 * and this earlier one was required but is missing. Paid is not in that chain.
 * A QuickBooks invoice row counts as invoiced having happened even when the
 * amount is wrong. Neutral means neither. A missing QuickBooks invoice stays
 * neutral. It is not yellow.
 *
 * Approved is done when approved_at is set, an `approved` event exists, or
 * status has left draft (approved, picking, packed, shipped, and the other
 * post-draft statuses). A so_number on a draft does not count. Legacy drafts
 * often have a number and are still drafts.
 *
 * Picked matches the pick sheet. A line needs a pick only when it is a product
 * or kit whose item type is Product or Kit/Package, and the SKU is not the
 * freight service 4343. Anything else (freight, fee, service) is not a gap.
 * Picked is done when a non-cancelled pick list is `picked` or `short`, or a
 * pickable line has qty_picked > 0. A short finish counts even when a line's
 * quantity is zero. An order with nothing to pick stays neutral.
 *
 * Packed is done when packed_at is set, status is packed, or a so_packages row
 * exists. Shipped status does not imply packed. Historic orders were marked
 * shipped without a pack, and that pack icon stays yellow.
 *
 * Shipped is done when status is partially_shipped or shipped, or a so_shipments
 * row has an AWB or its own ship date. sales_orders.ship_date is the requested
 * ship date and does not, by itself, mean the order shipped.
 *
 * Invoiced reads so_invoices rows with source qbo_import. It is not an ITS
 * status and not a PDF. No such row yet leaves the icon neutral, including
 * when the order has already shipped. The sales order amount is the sum of
 * so_lines.ext_price (the list total). The QuickBooks amount is the sum of
 * qbo_sale_amount, which is the QuickBooks total minus negative fee lines.
 * qbo_total_amt is not that comparison. Green only when those two amounts
 * match to the cent. Red when they differ, or when the summed qbo_total_amt
 * is $0 and the sales order amount is not (a QuickBooks invoice that was
 * voided). A QuickBooks invoice on a cancelled order is red even when the
 * amounts match. The list reads the stored rows. It does not call QuickBooks.
 *
 * Paid sits beside Invoiced. There is no payments table. The amount received
 * is sales_orders.payment_amount. eBay does not write that column. It writes
 * payment_status (unpaid, partial, or paid) and payment_date, and the buyer
 * paid the sales order total. A paid eBay order with no payment_amount uses
 * that total. The invoice amount is the same QuickBooks figure as the
 * invoiced icon: the sum of qbo_sale_amount. Green when those two amounts
 * match to the cent. Yellow when a payment is recorded and they do not,
 * including a partial payment with no amount and a payment with no QuickBooks
 * invoice yet. Red when nothing is recorded and a payment is expected: a
 * QuickBooks invoice is present, status is awaiting_payment, or the order is
 * prepay and has left draft. Otherwise the icon stays neutral. A draft's
 * default payment_status of unpaid is not, by itself, a recorded payment or
 * an expected one.
 */

export type SalesOrderStageIconId = "approved" | "picked" | "packed" | "shipped" | "invoiced" | "paid" | "cancelled";

export type SalesOrderStageTone = "neutral" | "done" | "gap" | "bad";

export type SalesOrderStageIcon = {
  id: SalesOrderStageIconId;
  label: string;
  tone: SalesOrderStageTone;
  title: string;
};

/** Stored so_invoices rows with source qbo_import. present is false when none exist yet. */
export type QboInvoiceFacts = {
  present: boolean;
  /** Sum of qbo_sale_amount. */
  saleAmount: number;
  /** Sum of qbo_total_amt. $0 here, with a non-zero sales order, is voided in QuickBooks. */
  totalAmount: number;
};

/** Amount received on the sales order. There is no separate payments table. */
export type SalesOrderPaymentFacts = {
  /** sales_orders.payment_amount. Null when that amount was not recorded. */
  amount: number | null;
  /** sales_orders.payment_status. The column default is unpaid. */
  status: "unpaid" | "partial" | "paid";
  /** sales_orders.payment_date is set. */
  dated: boolean;
  /** sales_orders.payment_requirement. */
  requirement: "prepay" | "terms";
};

export type SalesOrderStageInput = {
  status: string;
  /** sales_orders.approved_at is set. */
  approvedAt: boolean;
  /** so_events has event approved. */
  approvedEvent: boolean;
  /** At least one product or kit stock line the pick sheet would pick. */
  hasPickableLines: boolean;
  /** Finished pick list (picked or short), or pick qty on a pickable line. */
  picked: boolean;
  /** packed_at is set, or a so_packages row exists. */
  packed: boolean;
  /** A shipment row has an AWB or a shipment ship date. */
  hasShipment: boolean;
  /** Buyer total: sum of so_lines.ext_price. Null when the order has no priced lines, treated as 0. */
  total: number | null;
  qbo: QboInvoiceFacts;
  payment: SalesOrderPaymentFacts;
};

const POST_DRAFT = new Set([
  "approved",
  "proforma_sent",
  "awaiting_payment",
  "released",
  "picking",
  "packing",
  "packed",
  "partially_shipped",
  "shipped",
  "invoiced",
  "closed",
]);

const SHIPPED_STATUS = new Set(["partially_shipped", "shipped"]);

const LABEL: Record<SalesOrderStageIconId, string> = {
  approved: "Approved",
  picked: "Picked",
  packed: "Packed",
  shipped: "Shipped",
  invoiced: "Invoiced",
  paid: "Paid",
  cancelled: "Cancelled",
};

const WITHOUT: Record<"approved" | "picked" | "packed" | "shipped", string> = {
  approved: "approval",
  picked: "picking",
  packed: "packing",
  shipped: "shipping",
};

const CHAIN = ["approved", "picked", "packed", "shipped", "invoiced"] as const;

type ChainId = (typeof CHAIN)[number];
type Predecessor = Exclude<ChainId, "invoiced">;

export function emptySalesOrderStageInput(status = "draft"): SalesOrderStageInput {
  return {
    status,
    approvedAt: false,
    approvedEvent: false,
    hasPickableLines: false,
    picked: false,
    packed: false,
    hasShipment: false,
    total: null,
    qbo: { present: false, saleAmount: 0, totalAmount: 0 },
    payment: { amount: null, status: "unpaid", dated: false, requirement: "terms" },
  };
}

/** Buyer total from line extensions. Same number the sales order list shows. */
export function salesOrderBuyerTotal(lines: { extPrice: string }[]): number | null {
  return salesOrderTotal(lines);
}

/**
 * Sum of qbo_sale_amount equals the sales order line total, to the cent.
 * A sales order with no priced lines compares as 0. qbo_total_amt is not used here.
 */
export function qboInvoiceAmountsMatch(soAmount: number | null, qboSaleAmount: number): boolean {
  const so = soAmount ?? 0;
  if (!Number.isFinite(so) || !Number.isFinite(qboSaleAmount)) return false;
  return Math.round(so * 100) === Math.round(qboSaleAmount * 100);
}

/** QuickBooks invoice total is $0 while the sales order amount is not. */
export function qboInvoiceVoided(soAmount: number | null, qboTotalAmount: number): boolean {
  if (!Number.isFinite(qboTotalAmount)) return false;
  const so = soAmount ?? 0;
  if (!Number.isFinite(so)) return false;
  return Math.round(qboTotalAmount * 100) === 0 && Math.round(so * 100) !== 0;
}

export function salesOrderStageIcons(input: SalesOrderStageInput): SalesOrderStageIcon[] {
  const cancelled = input.status === "cancelled";
  const approved = input.approvedAt || input.approvedEvent || POST_DRAFT.has(input.status);
  const packed = input.packed || input.status === "packed";
  const shipped = input.hasShipment || SHIPPED_STATUS.has(input.status);
  const invoicePresent = input.qbo.present;
  const occurred: Record<ChainId, boolean> = {
    approved,
    picked: input.picked,
    packed,
    shipped,
    invoiced: invoicePresent,
  };

  const approvedTone = predecessorTone("approved", approved, true, occurred, cancelled);
  const pickedTone = predecessorTone("picked", input.picked, input.hasPickableLines, occurred, cancelled);
  const packedTone = predecessorTone("packed", packed, true, occurred, cancelled);
  const shippedTone = predecessorTone("shipped", shipped, true, occurred, cancelled);
  const invoicedTone = invoiceTone(input, cancelled);
  const paidTone = paymentTone(input, cancelled);

  return [
    stage("approved", approvedTone, predecessorTitle("approved", approvedTone, laterStage("approved", occurred))),
    stage("picked", pickedTone, predecessorTitle("picked", pickedTone, laterStage("picked", occurred))),
    stage("packed", packedTone, predecessorTitle("packed", packedTone, laterStage("packed", occurred))),
    stage("shipped", shippedTone, predecessorTitle("shipped", shippedTone, laterStage("shipped", occurred))),
    stage("invoiced", invoicedTone, invoiceTitle(input, invoicedTone)),
    stage("paid", paidTone, paymentTitle(input, paidTone)),
    stage("cancelled", cancelled ? "done" : "neutral", "Cancelled"),
  ];
}

function stage(id: SalesOrderStageIconId, tone: SalesOrderStageTone, title: string): SalesOrderStageIcon {
  return { id, label: LABEL[id], tone, title };
}

function predecessorTone(
  stageId: Predecessor,
  done: boolean,
  required: boolean,
  occurred: Record<ChainId, boolean>,
  cancelled: boolean,
): SalesOrderStageTone {
  if (cancelled) {
    if (stageId === "approved") return done ? "done" : "neutral";
    return done ? "bad" : "neutral";
  }
  if (done) return "done";
  if (required && laterStage(stageId, occurred)) return "gap";
  return "neutral";
}

function laterStage(stageId: Predecessor, occurred: Record<ChainId, boolean>): ChainId | null {
  const index = CHAIN.indexOf(stageId);
  let found: ChainId | null = null;
  for (const id of CHAIN.slice(index + 1)) {
    if (occurred[id]) found = id;
  }
  return found;
}

function predecessorTitle(id: Predecessor, tone: SalesOrderStageTone, later: ChainId | null): string {
  if (tone === "bad") return `${LABEL[id]} on a cancelled order`;
  if (tone === "gap" && later) return `${LABEL[later]} without ${WITHOUT[id]}`;
  return LABEL[id];
}

function invoiceTone(input: SalesOrderStageInput, cancelled: boolean): SalesOrderStageTone {
  if (!input.qbo.present) return "neutral";
  if (cancelled) return "bad";
  if (qboInvoiceVoided(input.total, input.qbo.totalAmount)) return "bad";
  return qboInvoiceAmountsMatch(input.total, input.qbo.saleAmount) ? "done" : "bad";
}

function invoiceTitle(input: SalesOrderStageInput, tone: SalesOrderStageTone): string {
  if (!input.qbo.present) return "Invoiced";
  if (input.status === "cancelled") return "Invoiced on a cancelled order";
  if (qboInvoiceVoided(input.total, input.qbo.totalAmount)) return "QuickBooks invoice total is $0";
  if (tone === "bad") return "QuickBooks invoice does not match this sales order";
  return "Invoiced";
}

function orderHasLeftDraft(input: SalesOrderStageInput): boolean {
  return input.approvedAt || input.approvedEvent || POST_DRAFT.has(input.status);
}

/** A dollar amount was stored, or eBay marked the order paid or partial, or a payment date was stored. */
function paymentRecorded(input: SalesOrderStageInput): boolean {
  const amount = input.payment.amount;
  if (amount != null && Number.isFinite(amount)) return true;
  if (input.payment.status === "paid" || input.payment.status === "partial") return true;
  return input.payment.dated;
}

/**
 * payment_amount when it is stored. A paid order with no amount is the buyer
 * total: that is what eBay collected. Partial, or a date alone, has no figure.
 */
function paymentFigure(input: SalesOrderStageInput): number | null {
  const amount = input.payment.amount;
  if (amount != null && Number.isFinite(amount)) return amount;
  if (input.payment.status !== "paid") return null;
  const total = input.total ?? 0;
  return Number.isFinite(total) ? total : null;
}

function paymentExpected(input: SalesOrderStageInput): boolean {
  if (input.qbo.present) return true;
  if (input.status === "awaiting_payment") return true;
  return input.payment.requirement === "prepay" && orderHasLeftDraft(input);
}

function paymentTone(input: SalesOrderStageInput, cancelled: boolean): SalesOrderStageTone {
  const recorded = paymentRecorded(input);
  if (cancelled) return recorded ? "bad" : "neutral";
  if (!recorded) return paymentExpected(input) ? "bad" : "neutral";
  if (!input.qbo.present) return "gap";
  const figure = paymentFigure(input);
  if (figure == null) return "gap";
  return qboInvoiceAmountsMatch(figure, input.qbo.saleAmount) ? "done" : "gap";
}

function paymentTitle(input: SalesOrderStageInput, tone: SalesOrderStageTone): string {
  if (input.status === "cancelled" && tone === "bad") return "Payment on a cancelled order";
  if (tone === "bad") return "Unpaid";
  if (tone !== "gap") return "Paid";
  if (!input.qbo.present) return "Payment recorded without a QuickBooks invoice";
  if (input.payment.status === "partial" && (input.payment.amount == null || !Number.isFinite(input.payment.amount))) {
    return "Partial payment";
  }
  return "Payment does not match this invoice";
}
