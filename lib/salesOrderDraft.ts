import {
  extensionFromUnit,
  formatExtension,
  formatUnitPrice,
  parseExtension,
  parseQty,
  parseUnitCost,
  roundPlaces,
  unitFromExtension,
  UNIT_DECIMALS,
} from "@/lib/poLineMoney";

export const INCOTERMS = ["EXW", "FCA", "FOB", "CIF", "DAP", "DDP"] as const;

export const SO_CURRENCIES = ["USD", "EUR", "GBP", "HKD"] as const;

export const SO_LINE_KINDS = [
  { id: "product", label: "Product" },
  { id: "kit", label: "Kit" },
  { id: "freight", label: "Freight" },
  { id: "fee", label: "Fee" },
  { id: "service", label: "Service" },
  { id: "discount", label: "Discount" },
  { id: "other", label: "Other" },
] as const;

export type SoLineKind = (typeof SO_LINE_KINDS)[number]["id"];

/** A product line is the only kind that must point at an item. */
export function lineRequiresItem(lineKind: string): boolean {
  return (lineKind || "product") === "product";
}

/** eBay buyer-shipping lines with no allocation take this item for the line quantity. */
export function withEbayShippingItem(lines: SoLineInput[], itemId: string, ebay: boolean): SoLineInput[] {
  if (!ebay || !itemId) return lines;
  return lines.map((line) => {
    if ((line.lineKind || "product") !== "freight") return line;
    if (line.allocations.some((row) => row.itemId && Number(row.qty) > 0)) return line;
    return { ...line, allocations: [{ itemId, qty: line.qty || "1", unitPrice: line.unitPrice }] };
  });
}

export const SO_NOTE_KINDS = [
  { id: "warranty", label: "Warranty" },
  { id: "shipping_instruction", label: "Shipping instruction" },
  { id: "accounting_contact", label: "Accounting contact" },
  { id: "payment", label: "Payment" },
  { id: "packing", label: "Packing" },
  { id: "other", label: "Other" },
] as const;

export type SoNoteKind = (typeof SO_NOTE_KINDS)[number]["id"];

export type SoAddress = {
  line1: string;
  line2: string;
  city: string;
  countrySubDivisionCode: string;
  postalCode: string;
  country: string;
  attention: string;
  phone: string;
};

export type SoAllocationInput = {
  itemId: string;
  qty: string;
  /** Unit price of this mapped SKU. Blank until a default or the user fills it. */
  unitPrice: string;
};

export type SoLineInput = {
  lineKind: string;
  customerPartNumber: string;
  customerDescription: string;
  qty: string;
  unitPrice: string;
  condition: string;
  allocations: SoAllocationInput[];
};

export type SoNoteInput = {
  kind: string;
  customerText: string;
  response: string;
  counterText: string;
};

export type SoDraftInput = {
  id: string | null;
  customerId: string;
  customerPo: string;
  reference: string;
  channel: string;
  orderDate: string;
  shipDate: string;
  billTo: SoAddress;
  shipTo: SoAddress;
  terms: string;
  incoterms: string;
  shipMethod: string;
  carrierAccount: string;
  currency: string;
  salesRep: string;
  exportNotes: string;
  internalNotes: string;
  paymentRequirement: string;
  paymentMethod: string;
  paymentDate: string;
  paymentRef: string;
  paymentAmount: string;
  ebayTransactionFee: string;
  ebayLabelFee: string;
  ebayAdFee: string;
  ebayOrderEarnings: string;
  lines: SoLineInput[];
  notes: SoNoteInput[];
  saveAddressToCustomer: boolean;
};

export function emptyAddress(): SoAddress {
  return {
    line1: "",
    line2: "",
    city: "",
    countrySubDivisionCode: "",
    postalCode: "",
    country: "",
    attention: "",
    phone: "",
  };
}

export function partPrefix(value: string): string {
  return value.toUpperCase().replace(/[\s/-]/g, "");
}

/** Customer part is a prefix of the item part after the same normalization. */
export function partMatches(customerPart: string, itemPart: string): boolean {
  const prefix = partPrefix(customerPart);
  if (prefix.length < 3) return false;
  return partPrefix(itemPart).startsWith(prefix);
}

export function lineExtension(qty: string, unitPrice: string): string | null {
  const quantity = Number(qty);
  const price = Number(unitPrice);
  if (!Number.isFinite(quantity) || !Number.isFinite(price) || quantity <= 0 || price < 0) return null;
  return (Math.round(quantity * price * 100) / 100).toFixed(2);
}

export type SalesPriceEdit = "qty" | "unit" | "ext";

const UNIT_STEP = 10 ** -UNIT_DECIMALS;

/** A four-decimal unit whose cent rounding of qty × unit is the extension. */
function unitForExtension(qty: number, ext: number): number {
  const target = roundPlaces(ext, 2);
  const direct = unitFromExtension(qty, target);
  if (extensionFromUnit(qty, direct) === target) return direct;
  for (let step = 1; step <= 50; step += 1) {
    const lower = roundPlaces(direct - step * UNIT_STEP, UNIT_DECIMALS);
    const higher = roundPlaces(direct + step * UNIT_STEP, UNIT_DECIMALS);
    if (lower >= 0 && extensionFromUnit(qty, lower) === target) return lower;
    if (extensionFromUnit(qty, higher) === target) return higher;
  }
  return direct;
}

function canonicalUnit(value: string): string {
  const parsed = parseUnitCost(value);
  return parsed == null ? value : formatUnitPrice(parsed);
}

function canonicalExt(value: string): string {
  const parsed = parseExtension(value);
  return parsed == null ? value : formatExtension(parsed);
}

/**
 * Keep qty × unit price = ext.
 * Editing the extension, or the quantity, recomputes the unit and keeps the extension.
 * Editing the unit price recomputes the extension.
 * Unit price is four decimals. Extension is cents.
 */
export function syncSalesLineMoney(input: {
  qty: string;
  unitPrice: string;
  extPrice: string;
  edited: SalesPriceEdit;
  commit?: boolean;
}): { unitPrice: string; extPrice: string } {
  const unitPrice = input.commit && input.edited === "unit" ? canonicalUnit(input.unitPrice) : input.unitPrice;
  const extPrice = input.commit && input.edited === "ext" ? canonicalExt(input.extPrice) : input.extPrice;
  const qty = parseQty(input.qty);
  const unit = parseUnitCost(unitPrice);
  const ext = parseExtension(extPrice);
  if (qty == null || qty <= 0) return { unitPrice, extPrice };

  if (input.edited === "unit") {
    if (unit == null) return { unitPrice, extPrice };
    return { unitPrice, extPrice: formatExtension(extensionFromUnit(qty, unit)) };
  }

  if (ext != null) {
    const nextUnit = unitForExtension(qty, ext);
    const achieved = extensionFromUnit(qty, nextUnit);
    return {
      unitPrice: formatUnitPrice(nextUnit),
      extPrice: achieved === roundPlaces(ext, 2) ? (input.commit || input.edited === "qty" ? formatExtension(ext) : extPrice) : formatExtension(achieved),
    };
  }

  if (input.edited === "qty" && unit != null) {
    return { unitPrice, extPrice: formatExtension(extensionFromUnit(qty, unit)) };
  }

  return { unitPrice, extPrice };
}

/**
 * Keep one mapped SKU in balance: qty × unit price = extended price.
 * Editing quantity or unit price recalculates the extension and keeps the unit price.
 * Editing the extension recalculates the unit price and keeps the extension.
 * Quantity of 0 or blank does not divide and leaves both amounts as they are.
 * Unit price is four decimals. Extension is cents.
 */
export function syncAllocationMoney(input: {
  qty: string;
  unitPrice: string;
  extPrice: string;
  edited: SalesPriceEdit;
  commit?: boolean;
}): { unitPrice: string; extPrice: string } {
  const unitPrice = input.commit && input.edited === "unit" ? canonicalUnit(input.unitPrice) : input.unitPrice;
  const extPrice = input.commit && input.edited === "ext" ? canonicalExt(input.extPrice) : input.extPrice;
  const qty = parseQty(input.qty);
  if (qty == null || qty <= 0) return { unitPrice, extPrice };

  if (input.edited === "ext") {
    const ext = parseExtension(extPrice);
    if (ext == null) return { unitPrice, extPrice };
    const nextUnit = unitForExtension(qty, ext);
    const achieved = extensionFromUnit(qty, nextUnit);
    return {
      unitPrice: formatUnitPrice(nextUnit),
      extPrice: achieved === roundPlaces(ext, 2) ? (input.commit ? formatExtension(ext) : extPrice) : formatExtension(achieved),
    };
  }

  const unit = parseUnitCost(unitPrice);
  if (unit == null) return { unitPrice, extPrice };
  return { unitPrice, extPrice: formatExtension(extensionFromUnit(qty, unit)) };
}

/** Display quantity for a mapped SKU. Whole numbers stay whole. */
export function formatMappedQty(value: number): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Quantity for a SKU just added to a customer line.
 * The first mapped SKU uses `firstQty`: the customer quantity, or the piece count when the customer part is a pack label.
 * Another SKU uses the customer quantity still unmapped. Nothing left leaves the quantity blank so the user can type it.
 * Mapped quantities are not required to add up to the ordered quantity.
 */
export function qtyForAddedMapping(input: {
  orderedQty: string;
  allocations: { qty: string }[];
  firstQty: string;
}): string {
  const hasMapped = input.allocations.some((row) => Number(row.qty) > 0);
  if (!hasMapped) return input.firstQty;
  const ordered = Number(input.orderedQty);
  if (!Number.isFinite(ordered)) return "";
  const mapped = input.allocations.reduce((total, row) => total + (Number(row.qty) > 0 ? Number(row.qty) : 0), 0);
  const remaining = Math.round((ordered - mapped) * 100) / 100;
  if (!(remaining > 0)) return "";
  return formatMappedQty(remaining);
}

export type MappedLineCompare = {
  orderedQty: number | null;
  mappedQty: number;
  orderedExt: number | null;
  mappedExt: number | null;
  qtyMismatch: boolean;
  moneyMismatch: boolean;
};

function optionalAmount(value: string): number | null {
  if (!value.trim()) return null;
  const numeric = numericMoney(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100) / 100;
}

function sameCents(left: number | null, right: number | null): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.round(left * 100) === Math.round(right * 100);
}

/** Customer PO line against the sum of its mapped SKUs. A false mismatch still allows save and approval. */
export function compareMappedLine(input: {
  qty: string;
  extPrice: string;
  allocations: { qty: string; extPrice: string }[];
}): MappedLineCompare {
  const orderedQty = optionalAmount(input.qty);
  const mappedQtyRaw = input.allocations.reduce((total, row) => total + (optionalAmount(row.qty) ?? 0), 0);
  const mappedQty = Math.round(mappedQtyRaw * 100) / 100;
  const orderedExt = optionalAmount(input.extPrice);
  const mappedExt = salesOrderTotal(input.allocations);
  const hasMapping = input.allocations.length > 0;
  return {
    orderedQty,
    mappedQty,
    orderedExt,
    mappedExt,
    qtyMismatch: hasMapping && !sameCents(orderedQty, mappedQty),
    moneyMismatch: hasMapping && !sameCents(orderedExt, mappedExt),
  };
}

export type MappedOrderCompare = {
  poTotal: number | null;
  mappedTotal: number | null;
  mismatch: boolean;
};

/**
 * Customer PO total against the extended prices that approval will keep.
 * Mapped SKU extensions replace the customer line. A line with no mapping counts only when it is not a product.
 * Mismatch is a warning. It does not block approval.
 */
export function compareMappedOrder(
  lines: { lineKind?: string; extPrice: string; allocations: { extPrice: string }[] }[],
): MappedOrderCompare {
  const poTotal = salesOrderTotal(lines);
  const mappedRows: { extPrice: string }[] = [];
  for (const line of lines) {
    if (line.allocations.length > 0) {
      mappedRows.push(...line.allocations);
      continue;
    }
    if ((line.lineKind || "product") !== "product") mappedRows.push({ extPrice: line.extPrice });
  }
  const mappedTotal = salesOrderTotal(mappedRows);
  return { poTotal, mappedTotal, mismatch: !sameCents(poTotal, mappedTotal) };
}

export function allocationsCover(qty: string, allocations: SoAllocationInput[]): boolean {
  const quantity = Number(qty);
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  const sum = allocations.reduce((total, row) => total + (Number(row.qty) || 0), 0);
  return Math.round(sum * 100) === Math.round(quantity * 100) && allocations.every((row) => row.itemId && Number(row.qty) > 0);
}

export function addressFromRecord(value: unknown): SoAddress {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = (key: string) => (typeof row[key] === "string" ? row[key] : "");
  return {
    line1: text("line1"),
    line2: text("line2"),
    city: text("city"),
    countrySubDivisionCode: text("countrySubDivisionCode"),
    postalCode: text("postalCode"),
    country: text("country"),
    attention: text("attention"),
    phone: text("phone"),
  };
}

/**
 * List column. An eBay order shows the eBay order id. Any other order shows the customer PO.
 * The stored internal reference is not shown.
 */
export function salesOrderListReference(input: {
  ebayOrderId?: string | null;
  customerPo?: string | null;
}): string {
  const ebay = (input.ebayOrderId ?? "").trim();
  if (ebay) return ebay;
  return (input.customerPo ?? "").trim();
}

export type SalesOrderListSortKey = {
  orderDate: string | null;
  createdAt: string;
};

/**
 * Newest order date first. An order with no order date sorts after every dated order.
 * The same date, and undated orders among themselves, sort by created time, newest first.
 */
export function compareSalesOrderList(left: SalesOrderListSortKey, right: SalesOrderListSortKey): number {
  const leftDate = left.orderDate?.trim() || "";
  const rightDate = right.orderDate?.trim() || "";
  if (leftDate && rightDate && leftDate !== rightDate) return leftDate < rightDate ? 1 : -1;
  if (leftDate && !rightDate) return -1;
  if (!leftDate && rightDate) return 1;
  if (left.createdAt === right.createdAt) return 0;
  return left.createdAt < right.createdAt ? 1 : -1;
}

/** Drafts that still need processing, unless the list is explicitly every order. */
export function salesOrderListScope(view: string | undefined): "drafts" | "all" {
  return view === "all" ? "all" : "drafts";
}

export const SALES_ORDER_LIST_VIEW_KEY = "its.salesOrders.listView";

export type SalesOrderListView = "drafts" | "all";

export function salesOrderListHref(view: SalesOrderListView): string {
  return view === "all" ? "/sales/orders?view=all" : "/sales/orders?view=drafts";
}

export function readSalesOrderListView(storage: Pick<Storage, "getItem">): SalesOrderListView | null {
  try {
    const value = storage.getItem(SALES_ORDER_LIST_VIEW_KEY);
    if (value === "all" || value === "drafts") return value;
    return null;
  } catch {
    return null;
  }
}

export function writeSalesOrderListView(storage: Pick<Storage, "setItem">, view: SalesOrderListView): void {
  try {
    storage.setItem(SALES_ORDER_LIST_VIEW_KEY, view);
  } catch {
    // Private mode and blocked storage still leave the switch usable for this visit.
  }
}

/**
 * A bare /sales/orders visit uses the view this browser last chose.
 * Returns the view to open when that differs from the page already rendered.
 */
export function salesOrderListViewToRestore(input: {
  hasViewParam: boolean;
  stored: SalesOrderListView | null;
}): SalesOrderListView | null {
  if (input.hasViewParam) return null;
  if (input.stored === "all") return "all";
  return null;
}

/** Display form of the integer so_number. Drafts have none until a legacy number is applied. */
export function formatSalesOrderNumber(value: number | string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) return null;
  return `SO${numeric}`;
}

/** Accepts 27766 or SO27766. */
export function parseSalesOrderNumber(value: string): number | null {
  const trimmed = value.trim().toUpperCase().replace(/^SO/, "");
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  if (!Number.isSafeInteger(numeric) || numeric < 1) return null;
  return numeric;
}

/** Matches so_invoices.number: seq 1 is INV plus the SO number, then INV27766-2. */
export function invoiceNumber(soNumber: number, seq: number): string | null {
  if (!Number.isSafeInteger(soNumber) || soNumber < 1 || !Number.isSafeInteger(seq) || seq < 1) return null;
  return seq === 1 ? `INV${soNumber}` : `INV${soNumber}-${seq}`;
}

export function salesOrderStatusLabel(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function pacificToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
}

export function formatSalesMoney(amount: number | null, currency: string): string {
  if (amount == null || !Number.isFinite(amount)) return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

/** Seller earnings minus a shipping label bought on eBay. Earnings already exclude marketplace fees. */
function numericMoney(value: string): number {
  return Number(value.replace(/[$,\s]/g, ""));
}

export function sellerNet(earnings: string, labelFee: string): number | null {
  if (!earnings.trim()) return null;
  const earned = numericMoney(earnings);
  const label = labelFee.trim() ? numericMoney(labelFee) : 0;
  if (!Number.isFinite(earned) || !Number.isFinite(label)) return null;
  return Math.round((earned - label) * 100) / 100;
}

export function salesOrderTotal(lines: { extPrice: string }[]): number | null {
  let sum = 0;
  let any = false;
  for (const line of lines) {
    if (!line.extPrice.trim()) continue;
    const value = numericMoney(line.extPrice);
    if (!Number.isFinite(value)) continue;
    any = true;
    sum += value;
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

export function hideSalesMoney<
  T extends {
    unitPrice?: string;
    extPrice?: string;
    total?: number | null;
    internalNotes?: string;
    ebayTransactionFee?: string;
    ebayLabelFee?: string;
    ebayAdFee?: string;
    ebayOrderEarnings?: string;
    paymentAmount?: string;
  },
>(row: T, canViewMoney: boolean): T {
  if (canViewMoney) return row;
  return {
    ...row,
    ...(row.unitPrice !== undefined ? { unitPrice: "" } : {}),
    ...(row.extPrice !== undefined ? { extPrice: "" } : {}),
    ...(row.total !== undefined ? { total: null } : {}),
    ...(row.internalNotes !== undefined ? { internalNotes: "" } : {}),
    ...(row.ebayTransactionFee !== undefined ? { ebayTransactionFee: "" } : {}),
    ...(row.ebayLabelFee !== undefined ? { ebayLabelFee: "" } : {}),
    ...(row.ebayAdFee !== undefined ? { ebayAdFee: "" } : {}),
    ...(row.ebayOrderEarnings !== undefined ? { ebayOrderEarnings: "" } : {}),
    ...(row.paymentAmount !== undefined ? { paymentAmount: "" } : {}),
  };
}

/** JSON body for write_sales_order. The number is not sent; approval assigns it. */
export function toSalesOrderPayload(input: SoDraftInput): Record<string, unknown> {
  return {
    id: input.id,
    customer_id: input.customerId,
    customer_po: input.customerPo,
    reference: input.reference,
    channel: input.channel,
    order_date: input.orderDate,
    ship_date: input.shipDate,
    bill_to: input.channel.trim().toLowerCase() === "ebay" ? emptyAddress() : input.billTo,
    ship_to: input.shipTo,
    terms: input.terms,
    incoterms: input.incoterms,
    ship_method: input.shipMethod,
    carrier_account: input.carrierAccount,
    currency: input.currency,
    sales_rep: input.salesRep,
    export_notes: input.exportNotes,
    internal_notes: input.internalNotes,
    payment_requirement: input.paymentRequirement || "terms",
    payment_method: input.paymentMethod,
    payment_date: input.paymentDate,
    payment_ref: input.paymentRef,
    payment_amount: input.paymentAmount,
    ebay_transaction_fee: input.ebayTransactionFee,
    ebay_label_fee: input.ebayLabelFee,
    ebay_ad_fee: input.ebayAdFee,
    ebay_order_earnings: input.ebayOrderEarnings,
    lines: input.lines.map((line) => ({
      line_kind: line.lineKind || "product",
      customer_part_number: line.customerPartNumber,
      customer_description: line.customerDescription,
      qty: line.qty,
      unit_price: line.unitPrice,
      condition: line.condition,
      allocations: line.allocations
        .filter((row) => row.itemId && Number(row.qty) > 0)
        .map((row, index) => ({
          item_id: row.itemId,
          qty: row.qty,
          unit_price: row.unitPrice,
          alloc_no: index + 1,
        })),
    })),
    notes: input.notes
      .filter((note) => note.customerText.trim())
      .map((note) => ({
        kind: note.kind || "other",
        customer_text: note.customerText,
        response: note.response,
        counter_text: note.counterText,
      })),
  };
}
