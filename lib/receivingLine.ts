import type { BinType } from "@/lib/bins";
import { formatBinReference } from "@/lib/bins";
import { nextFreeBinError, parseReceivingBinCode } from "@/lib/stockReceive";

/** CPU receipts record cleaned. SSD and HDD receipts record wiped. Anything else records neither. */
export type ReceivePrep = "cleaned" | "wiped";

export function receivePrepKind(input: {
  shortCode?: string | null;
  longCode?: string | null;
  taxonomyName?: string | null;
}): ReceivePrep | null {
  const short = (input.shortCode ?? "").trim().toUpperCase();
  const long = (input.longCode ?? "").trim().toUpperCase();
  const name = (input.taxonomyName ?? "").trim().toLowerCase();
  if (
    short === "CPU" ||
    long === "CPU" ||
    long.startsWith("CPU/") ||
    name === "cpu" ||
    name === "processor" ||
    name === "processors"
  ) {
    return "cleaned";
  }
  if (
    short === "HDD" ||
    short === "SSD" ||
    long === "HDD" ||
    long === "SSD" ||
    long === "DSK/HDD" ||
    long === "DSK/SSD" ||
    long.endsWith("/HDD") ||
    long.endsWith("/SSD") ||
    name === "hdd" ||
    name === "ssd"
  ) {
    return "wiped";
  }
  return null;
}

/**
 * Note under the bin field when this SKU is already in an open bin.
 * Location and quantity are glued: `HWS.00.00.00.00.96PCS`.
 */
export function skuAlreadyInBinNote(locationCode: string | null | undefined, qty: number): string | null {
  const location = (locationCode ?? "").trim();
  if (!location || !Number.isFinite(qty) || qty <= 0) return null;
  return `This SKU is already in this bin st ${location}.${qty}PCS`;
}

/** Store only the flag that taxonomy asked for. The other stays null. */
export function receiptFlagsForPrep(
  prep: ReceivePrep | null,
  cleaned: boolean,
  wiped: boolean,
): { cleaned: boolean | null; wiped: boolean | null } {
  if (prep === "cleaned") return { cleaned, wiped: null };
  if (prep === "wiped") return { cleaned: null, wiped };
  return { cleaned: null, wiped: null };
}

/** The word Recent entries shows in front of a CPU or drive note. A flag that was never set adds no word. */
export function prepStatusText(
  prep: ReceivePrep | null,
  cleaned: boolean | null,
  wiped: boolean | null,
): string | null {
  if (prep === "cleaned") {
    if (cleaned === true) return "cleaned";
    if (cleaned === false) return "dirty";
    return null;
  }
  if (prep === "wiped") {
    if (wiped === true) return "Wiped";
    if (wiped === false) return "Pending Wipe";
    return null;
  }
  return null;
}

/**
 * Recent entries comment, for display only.
 * The status word is not written into the stored comment.
 */
export function commentWithPrepStatus(
  comment: string | null | undefined,
  prep: ReceivePrep | null,
  cleaned: boolean | null,
  wiped: boolean | null,
): string {
  const body = (comment ?? "").trim();
  const status = prepStatusText(prep, cleaned, wiped);
  if (!status) return body;
  return body ? `${status} ${body}` : status;
}

export type ReceivingBinLookup = {
  reference: string;
  canReceive: boolean;
};

export type ReceivingBinDecision =
  | { action: "empty" }
  | { action: "invalid"; message: string }
  | { action: "accept"; reference: string }
  | { action: "unusable"; message: string }
  | { action: "create"; reference: string; type: BinType };

const BIN_CODE_MESSAGE = "A bin code is five digits, a hyphen, and B, C, or P.";
const BIN_UNUSABLE_MESSAGE = "This bin has quantity and no open cycle.";

/** A typed code that already exists and can take stock is accepted. An unknown code is offered for create. */
export function receivingBinDecision(raw: string, found: ReceivingBinLookup | null): ReceivingBinDecision {
  const trimmed = raw.trim();
  if (!trimmed) return { action: "empty" };
  const parsed = parseReceivingBinCode(trimmed);
  if (!parsed) return { action: "invalid", message: BIN_CODE_MESSAGE };
  if (!found) return { action: "create", reference: parsed.reference, type: parsed.type };
  if (!found.canReceive) return { action: "unusable", message: BIN_UNUSABLE_MESSAGE };
  return { action: "accept", reference: found.reference || parsed.reference };
}

/** On-hand stock with no open cycle cannot be received into. An empty bin can. */
export function binCanReceive(detail: {
  contents: readonly { qty: number }[];
  cycles: readonly { status: string }[];
}): boolean {
  const onHand = detail.contents.reduce((sum, row) => sum + (Number.isFinite(row.qty) ? row.qty : 0), 0);
  if (onHand <= 0) return true;
  return detail.cycles.some((cycle) => cycle.status === "open");
}

/** The shared counter's next five-digit number, with the chosen suffix. Box is the usual suggestion. */
export function nextReceivingBinCode(nextNumber: number, type: BinType): string | null {
  if (nextFreeBinError(nextNumber)) return null;
  return formatBinReference(nextNumber, type);
}

function nestedBinReference(value: unknown): unknown {
  if (Array.isArray(value)) return nestedBinReference(value[0]);
  if (!value || typeof value !== "object") return null;
  return (value as Record<string, unknown>).reference;
}

/** Bin code from a receipt row: `bin_reference`, or `bins.reference` from the ledger join. */
export function lastPutawayBinReference(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const direct = record.bin_reference;
  const raw = typeof direct === "string" && direct.trim() ? direct : nestedBinReference(record.bins);
  if (typeof raw !== "string") return null;
  return parseReceivingBinCode(raw)?.reference ?? null;
}

/**
 * What the bin field shows before the clerk types.
 * A value they typed stays. Otherwise the last putaway bin for that SKU, or blank.
 * The next counter number is not a field value.
 */
export function receivingBinDefault(input: {
  lastReference: string | null;
  userTyped: boolean;
  current: string;
}): string {
  if (input.userTyped) return input.current;
  if (!input.lastReference) return "";
  return parseReceivingBinCode(input.lastReference)?.reference ?? "";
}
