import { binTypeLabel, formatBinReference, isBinType, type BinType } from "@/lib/bins";
import { errorText } from "@/lib/errors";
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

/** The row that already uses this bin number, looked up when the typed reference is missing. */
export type ReceivingBinNumberOwner = {
  reference: string;
  type: BinType;
};

export type ReceivingBinDecision =
  | { action: "empty" }
  | { action: "invalid"; message: string }
  | { action: "accept"; reference: string }
  | { action: "unusable"; message: string }
  | { action: "create"; reference: string; type: BinType }
  | {
      action: "mismatch";
      number: number;
      selected: BinType;
      selectedReference: string;
      existing: BinType;
      existingReference: string;
      message: string;
    };

const BIN_CODE_MESSAGE = "A bin code is five digits, a hyphen, and B, C, or P.";
const BIN_UNUSABLE_MESSAGE = "This bin has quantity and no open cycle.";

/** BIN 10042 is a Crate and you selected a Box, please adjust your bin selection. */
export function binTypeMismatchMessage(number: number, existing: BinType, selected: BinType): string {
  return `BIN ${number} is a ${binTypeLabel(existing)} and you selected a ${binTypeLabel(selected)}, please adjust your bin selection`;
}

/**
 * A typed code that already exists and can take stock is accepted.
 * An unknown number is offered for create.
 * The same number under another suffix is a mismatch, not a new bin.
 */
export function receivingBinDecision(
  raw: string,
  found: ReceivingBinLookup | null,
  owner: ReceivingBinNumberOwner | null = null,
): ReceivingBinDecision {
  const trimmed = raw.trim();
  if (!trimmed) return { action: "empty" };
  const parsed = parseReceivingBinCode(trimmed);
  if (!parsed) return { action: "invalid", message: BIN_CODE_MESSAGE };
  if (!found) {
    if (owner && owner.type !== parsed.type) {
      const existingReference = parseReceivingBinCode(owner.reference)?.reference ?? owner.reference;
      return {
        action: "mismatch",
        number: parsed.number,
        selected: parsed.type,
        selectedReference: parsed.reference,
        existing: owner.type,
        existingReference,
        message: binTypeMismatchMessage(parsed.number, owner.type, parsed.type),
      };
    }
    if (owner) {
      const existingReference = parseReceivingBinCode(owner.reference)?.reference ?? owner.reference;
      return {
        action: "invalid",
        message: `${existingReference} already exists. Scan it instead of creating a new one.`,
      };
    }
    return { action: "create", reference: parsed.reference, type: parsed.type };
  }
  if (!found.canReceive) return { action: "unusable", message: BIN_UNUSABLE_MESSAGE };
  return { action: "accept", reference: found.reference || parsed.reference };
}

const BIN_CREATE_SENTENCE =
  /Code \d{5}-[BCP] is a (?:box|crate|pallet), but (?:Box|Crate|Pallet) is selected\.|A bin code is five digits, a hyphen, and B, C, or P\.|The next bin number must be five digits\. Set it in Settings\.|Choose box, crate, or pallet\.|Operator initials are required\.|Bin counter is missing\.|The bin was not created\.|Unexpected bin type\./;

/**
 * The sentence to show when creating a bin fails.
 * Call this inside the server action. A thrown error is replaced in production
 * by the generic Server Components digest, so the caller must return this text.
 */
export function receivingBinCreateMessage(error: unknown, requestedCode: string | null): string {
  const text = errorText(error);
  const already = text.match(/(\d{5})-([BCP]) already exists/);
  const requested = requestedCode ? parseReceivingBinCode(requestedCode) : null;
  if (already && isBinType(already[2])) {
    const existing = already[2];
    const number = Number(already[1]);
    if (requested && requested.number === number && requested.type !== existing) {
      return binTypeMismatchMessage(number, existing, requested.type);
    }
    return `${already[1]}-${existing} already exists. Scan it instead of creating a new one.`;
  }
  const known = text.match(BIN_CREATE_SENTENCE);
  if (known) return known[0];
  if (/bins_number_unique|duplicate key value violates unique constraint/i.test(text)) {
    return requested
      ? `BIN ${requested.number} is already on file. Adjust your bin selection.`
      : "That bin number is already used. Adjust your bin selection.";
  }
  if (/Server Components render/i.test(text)) return "The bin was not created.";
  return text || "The bin was not created.";
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

/** A search that fills the line on its own moves the cursor to quantity. Opening a list does not. Choosing one of those rows does, on the receiving line. */
export function receivingAutoFillFocus(outcome: "select" | "list" | "empty" | "missing"): "qty" | null {
  return outcome === "select" ? "qty" : null;
}

/**
 * A SKU typed over the receiving line. An exact SKU replaces the item.
 * The same SKU, a blank field, or a value that is not that exact SKU does not.
 * The original search text is not part of this decision and stays as typed.
 */
export function receivingSkuOverride(input: {
  typedSku: string;
  currentSku: string;
  exactSku: string | null;
}): "same" | "apply" | "pending" {
  const typed = input.typedSku.trim();
  const current = input.currentSku.trim();
  if (!typed || typed.toLowerCase() === current.toLowerCase()) return "same";
  const exact = (input.exactSku ?? "").trim();
  if (exact && exact.toLowerCase() === typed.toLowerCase()) return "apply";
  return "pending";
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
