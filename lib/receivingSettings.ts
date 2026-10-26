/**
 * The receiving date can be edited until go-live.
 * Set this to false afterwards: the field becomes today's date and cannot be changed.
 * The server stores that date and ignores a different date from the browser.
 */
export const RECEIVING_DATE_EDITABLE = true;

export const RECEIVING_PAGE_SIZE = 50;

/** Last page of a receipt list. An empty list is still page 1. */
export function receivingLastPage(total: number): number {
  if (!Number.isFinite(total) || total < 1) return 1;
  return Math.ceil(total / RECEIVING_PAGE_SIZE);
}

/** Zero-based row offset for a 1-based page. */
export function receivingPageOffset(page: number): number {
  const safe = Number.isInteger(page) && page > 0 ? page : 1;
  return (safe - 1) * RECEIVING_PAGE_SIZE;
}

const MONEY_FIELDS = ["unit_cost", "cost", "price", "extended_cost", "landed_cost"] as const;

export function warehouseToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

export function parseReceiptDate(input: string | null | undefined): string {
  const value = (input ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Enter a receiving date.");
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new Error("Enter a receiving date.");
  }
  if (year < 2000 || year > 2100) throw new Error("Enter a receiving date.");
  return value;
}

export function receivingDateToStore(input: string | null | undefined, now = new Date()): string {
  if (!RECEIVING_DATE_EDITABLE) return warehouseToday(now);
  return parseReceiptDate(input);
}

export type ReceiptSaveGate = {
  inFlight: boolean;
  requestId: string | null;
};

/** One click owns one request id. A second click while that save is in flight does nothing. A failed save keeps the id so a retry cannot write a second line. */
export function beginReceiptSave(
  gate: ReceiptSaveGate,
  nextId: string,
): { ok: true; gate: ReceiptSaveGate; requestId: string } | { ok: false; gate: ReceiptSaveGate } {
  if (gate.inFlight) return { ok: false, gate };
  const requestId = gate.requestId ?? nextId;
  return { ok: true, gate: { inFlight: true, requestId }, requestId };
}

export function finishReceiptSave(gate: ReceiptSaveGate, saved: boolean): ReceiptSaveGate {
  if (saved) return { inFlight: false, requestId: null };
  return { inFlight: false, requestId: gate.requestId };
}

export function originQtyInput(value: string): { ok: true; qty: number | null } | { ok: false } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, qty: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  const qty = Number(trimmed);
  if (qty > 1000000) return { ok: false };
  return { ok: true, qty };
}

/** Quantity on a new receiving line. Blank stays missing; it is never turned into 0 or 1. */
export function receiveLineQty(value: string): { ok: true; qty: number } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, message: "Enter a quantity." };
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: "Enter a whole number of at least 1." };
  const qty = Number(trimmed);
  if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) {
    return { ok: false, message: "Enter a whole number of at least 1." };
  }
  return { ok: true, qty };
}

/**
 * Soft check for the receiving line. A positive originating system qty should divide the item qty.
 * Blank, zero, and invalid system qty skip the check. An invalid item qty is a separate hard error.
 */
export function systemQtyMultipleWarning(itemQty: number, systemQty: number | null): string | null {
  if (systemQty == null || !Number.isInteger(systemQty) || systemQty <= 0) return null;
  if (!Number.isInteger(itemQty) || itemQty < 1) return null;
  if (itemQty % systemQty === 0) return null;
  return `Item qty ${itemQty} is not a multiple of system qty ${systemQty}.`;
}

export type ReceivingEntry = {
  id: string;
  receivedOn: string;
  initials: string;
  project: string | null;
  incomingBin: string | null;
  originatingSystem: string | null;
  originQty: number | null;
  sku: string;
  itemName: string;
  itemId: string;
  qty: number;
  comment: string | null;
  edited: boolean;
  editedBy: string | null;
  cleaned: boolean | null;
  wiped: boolean | null;
  shortCode: string | null;
  longCode: string | null;
  taxonomyName: string | null;
  putaway: string;
  binReference: string;
  searchQuery: string | null;
};

/** Destination bin and the location it was put away to, in one cell. */
export function putawayLabel(binReference: string | null, locationCode: string | null): string {
  const bin = (binReference ?? "").trim();
  const location = (locationCode ?? "").trim();
  if (bin && location) return `${bin} · ${location}`;
  return bin || location;
}

/** Two-letter initials are shown in capitals. A longer value already stored on a receipt is left as written. */
export function receiptInitials(value: unknown): string {
  const raw = value == null ? "" : String(value).trim();
  const letters = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(letters)) return letters;
  return raw;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function joinedText(value: unknown, key: string): string {
  if (Array.isArray(value)) return joinedText(value[0], key);
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return String(record[key] ?? "").trim();
}

function embed(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return embed(value[0]);
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function booleanOrNull(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  return null;
}

/** Keep the columns the recent table shows. Prices never leave the server for a role that cannot see them. */
export function receivingEntryForViewer(row: Record<string, unknown>, canViewMoney: boolean): ReceivingEntry {
  const source = canViewMoney ? row : omitMoney(row);
  const receivedOn = textOrNull(source.received_on) ?? textOrNull(source.occurred_at)?.slice(0, 10) ?? "";
  const qty = Number(source.qty);
  const originQty = source.origin_qty == null || source.origin_qty === "" ? null : Number(source.origin_qty);
  const item = embed(source.items);
  const taxonomy = embed(item?.taxonomies);
  const binReference = textOrNull(source.bin_reference) ?? textOrNull(joinedText(source.bins, "reference"));
  const locationCode =
    textOrNull(source.location_code) ??
    textOrNull(joinedText(source.to_location, "code")) ??
    textOrNull(joinedText(source.locations, "code"));
  return {
    id: String(source.id ?? ""),
    receivedOn,
    initials: receiptInitials(source.operator_initials),
    project: textOrNull(source.project),
    incomingBin: textOrNull(source.incoming_tag),
    originatingSystem: textOrNull(source.origin_description),
    originQty: originQty != null && Number.isFinite(originQty) ? originQty : null,
    sku: textOrNull(source.sku) || joinedText(source.items, "sku"),
    itemName: textOrNull(source.item_name) || joinedText(source.items, "name"),
    itemId: textOrNull(source.item_id) ?? "",
    qty: Number.isFinite(qty) ? qty : 0,
    comment: textOrNull(source.comment),
    edited: source.edited === true,
    editedBy: textOrNull(source.editor_initials),
    cleaned: booleanOrNull(source.cleaned),
    wiped: booleanOrNull(source.wiped),
    shortCode: textOrNull(source.short_code) ?? textOrNull(taxonomy?.short_code),
    longCode: textOrNull(source.long_code) ?? textOrNull(taxonomy?.long_code),
    taxonomyName: textOrNull(source.taxonomy_name) ?? textOrNull(taxonomy?.name),
    putaway: putawayLabel(binReference, locationCode),
    binReference: binReference ?? "",
    searchQuery: textOrNull(source.search_query),
  };
}

function omitMoney(row: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if ((MONEY_FIELDS as readonly string[]).includes(key)) continue;
    if (value && typeof value === "object") {
      copy[key] = Array.isArray(value)
        ? value.map((item) => (item && typeof item === "object" ? omitMoney(item as Record<string, unknown>) : item))
        : omitMoney(value as Record<string, unknown>);
      continue;
    }
    copy[key] = value;
  }
  return copy;
}

/** Success note after a receipt. EMPTY means this save opened the bin's fill period. A pending line has no SKU yet. */
export function receiptSavedNote(input: {
  qty: number;
  sku: string;
  name?: string;
  reference: string;
  cycleOpened: boolean;
  pending?: boolean;
  search?: string | null;
}): string {
  if (input.pending) {
    const term = (input.search ?? "").trim();
    const quoted = term ? `"${term}"` : "the search";
    return `Saved ${input.qty} pcs of ${quoted} into bin ${input.reference} (pending item)`;
  }
  const sku = input.sku.trim();
  const item = sku ? `SKU${sku}` : (input.name ?? "").trim();
  if (input.cycleOpened) return `Put Away ${input.qty}Pcs ${item} into EMPTY bin ${input.reference}`;
  return `Added ${input.qty}Pcs ${item} into bin ${input.reference}`;
}

export function formatReceivedOn(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  }).format(date);
}
