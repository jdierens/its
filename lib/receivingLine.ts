import type { BinType } from "@/lib/bins";
import { formatBinReference } from "@/lib/bins";
import { nextFreeBinError, parseReceivingBinCode } from "@/lib/stockReceive";

/** CPU receipts record cleaned. SSD and HDD receipts record wiped. Anything else records neither. */
export type ReceivePrep = "cleaned" | "wiped";

const PREP_STATUSES = [
  { text: "Pending Wipe", prep: "wiped", value: false },
  { text: "Wiped", prep: "wiped", value: true },
  { text: "cleaned", prep: "cleaned", value: true },
  { text: "dirty", prep: "cleaned", value: false },
] as const;

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

/** The word a CPU or drive comment starts with. A flag that was never set adds no word. */
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

function leadingPrepStatus(
  text: string,
  prep: ReceivePrep,
): { value: boolean; rest: string } | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  for (const status of PREP_STATUSES) {
    if (status.prep !== prep) continue;
    const phrase = status.text.toLowerCase();
    if (lower === phrase) return { value: status.value, rest: "" };
    if (lower.startsWith(phrase) && /\s/.test(lower.charAt(phrase.length))) {
      return { value: status.value, rest: trimmed.slice(phrase.length).trim() };
    }
  }
  return null;
}

/** Comment as the clerk sees it. The status word is not part of the stored comment. */
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

/**
 * Visible comment after a new item is chosen.
 * A status word from the previous CPU or drive is removed so it does not stick.
 * A note typed before any item was chosen is left as written, including one that
 * happens to start with those words. The new CPU starts at dirty, and a drive at Pending Wipe.
 * A blank note still takes a multi-token scan.
 */
export function commentAfterItemPick(input: {
  current: string;
  previous: { shortCode?: string | null; longCode?: string | null; taxonomyName?: string | null } | null;
  next: { shortCode?: string | null; longCode?: string | null; taxonomyName?: string | null };
  scan: string | null;
}): string {
  const previousPrep = input.previous ? receivePrepKind(input.previous) : null;
  const nextPrep = receivePrepKind(input.next);
  const stripped = previousPrep
    ? (leadingPrepStatus(input.current, previousPrep)?.rest ?? input.current.trim())
    : input.current.trim();
  const base = stripped.trim() ? stripped : (input.scan?.trim() ?? "");
  return commentWithPrepStatus(base, nextPrep, false, false);
}

/**
 * Read a leading status word for this taxonomy and return the flag to store.
 * The stored comment does not include that word. A missing word stores false.
 * A note on memory or any other taxonomy is stored as written.
 */
export function splitPrepComment(
  prep: ReceivePrep | null,
  text: string,
): { comment: string; cleaned: boolean | null; wiped: boolean | null } {
  if (prep !== "cleaned" && prep !== "wiped") return { comment: text.trim(), cleaned: null, wiped: null };
  const found = leadingPrepStatus(text, prep);
  if (prep === "cleaned") {
    return { comment: found ? found.rest : text.trim(), cleaned: found ? found.value : false, wiped: null };
  }
  return { comment: found ? found.rest : text.trim(), cleaned: null, wiped: found ? found.value : false };
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
