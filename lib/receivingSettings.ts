/**
 * The receiving date can be edited until go-live.
 * Set this to false afterwards: the field becomes today's date and cannot be changed.
 * The server stores that date and ignores a different date from the browser.
 */
export const RECEIVING_DATE_EDITABLE = true;

export const RECEIVING_PAGE_SIZE = 20;

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

export function receivingDateToStore(input: string | null | undefined, now = new Date()): string {
  const today = warehouseToday(now);
  if (!RECEIVING_DATE_EDITABLE) return today;
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

export type ReceivingEntry = {
  id: string;
  receivedOn: string;
  sku: string;
  bin: string;
  qty: number;
  comment: string | null;
  receivedBy: string;
  incomingBin: string | null;
  originatingSystem: string | null;
  originQty: number | null;
};

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

/** Keep the columns the recent table shows. Prices never leave the server for a role that cannot see them. */
export function receivingEntryForViewer(row: Record<string, unknown>, canViewMoney: boolean): ReceivingEntry {
  const source = canViewMoney ? row : omitMoney(row);
  const receivedOn = textOrNull(source.received_on) ?? textOrNull(source.occurred_at)?.slice(0, 10) ?? "";
  const qty = Number(source.qty);
  const originQty = source.origin_qty == null || source.origin_qty === "" ? null : Number(source.origin_qty);
  return {
    id: String(source.id ?? ""),
    receivedOn,
    sku: joinedText(source.items, "sku"),
    bin: joinedText(source.bins, "reference"),
    qty: Number.isFinite(qty) ? qty : 0,
    comment: textOrNull(source.comment),
    receivedBy: String(source.operator_initials ?? ""),
    incomingBin: textOrNull(source.incoming_tag),
    originatingSystem: textOrNull(source.origin_description),
    originQty: originQty != null && Number.isFinite(originQty) ? originQty : null,
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
