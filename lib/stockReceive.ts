import { binTypeLabel, isBinType, type BinType } from "@/lib/bins";

export const SHELVES_PATTERN = String.raw`^HWS\.\d{2}\.\d{2}\.\d{2}$`;
export const RACKING_PATTERN = String.raw`^HWR\.\d{2}\.\d{2}\.\d{2}(\.[NSEWC])?$`;

const RECEIVING_BIN = /^(\d{5})-([BCP])$/;

export type LocationTypeRule = {
  prefix: string;
  pattern: string;
};

export type PutawayDefaults = Record<BinType, string>;

export type CycleStatus = "open" | "closed";

export type ConsolidationRow = {
  qty: number;
  project: string | null;
  status: CycleStatus;
};

export function parseReceivingBinCode(
  value: string,
): { number: number; type: BinType; reference: string } | null {
  const match = value.trim().toUpperCase().match(RECEIVING_BIN);
  if (!match) return null;
  const digits = match[1];
  const number = Number(digits);
  if (!Number.isInteger(number) || String(number) !== digits) return null;
  const type = match[2];
  if (!isBinType(type)) return null;
  return { number, type, reference: `${digits}-${type}` };
}

const BIN_KIND: Record<BinType, string> = { B: "box", C: "crate", P: "pallet" };

export function typedBinCodeError(value: string, suffix: BinType): string | null {
  const parsed = parseReceivingBinCode(value);
  if (!parsed) return "A bin code is five digits, a hyphen, and B, C, or P.";
  if (parsed.type !== suffix) {
    return `Code ${parsed.reference} is a ${BIN_KIND[parsed.type]}, but ${binTypeLabel(suffix)} is selected.`;
  }
  return null;
}

export function nextFreeBinError(nextNumber: number): string | null {
  if (!Number.isInteger(nextNumber) || nextNumber < 10000 || nextNumber > 99999) {
    return "The next bin number must be five digits. Set it in Settings.";
  }
  return null;
}

export function matchingLocationTypes<T extends LocationTypeRule>(
  code: string,
  types: readonly T[],
): T[] {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return [];
  return types.filter((type) => {
    const prefix = type.prefix.trim().toUpperCase();
    if (!prefix || !normalized.startsWith(prefix)) return false;
    try {
      return new RegExp(type.pattern).test(normalized);
    } catch {
      return false;
    }
  });
}

export function locationCodeError(code: string, types: readonly LocationTypeRule[]): string | null {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return "Enter a location code.";
  const matches = matchingLocationTypes(normalized, types);
  if (matches.length === 0) return `No location type matches ${normalized}.`;
  if (matches.length > 1) return `More than one location type matches ${normalized}.`;
  return null;
}

export function cycleOpens(onHand: number): boolean {
  return onHand <= 0;
}

export function closesCycle(qtyAfter: number): boolean {
  return qtyAfter <= 0;
}

export function consolidationTargets<T extends ConsolidationRow>(
  rows: readonly T[],
  project: string,
): T[] {
  const key = project.trim();
  return rows.filter((row) => {
    if (row.status !== "open") return false;
    if (!(row.qty > 0)) return false;
    return (row.project ?? "").trim() === key;
  });
}

export function assignNewBinLocation(defaults: PutawayDefaults, type: BinType): string {
  return defaults[type];
}

export function recordNewCycleDefault(defaults: PutawayDefaults, type: BinType): string {
  return defaults[type];
}

export function keepExistingLocation(locationId: string): string {
  return locationId;
}

export function keepExistingCycleDefault(snapshot: string): string {
  return snapshot;
}

export function cycleEventParts(event: {
  eventType: string;
  qty: number | null;
  sku: string | null;
  itemName: string | null;
  comment: string | null;
  fromLocationCode: string | null;
  toLocationCode: string | null;
}): { verb: string; qty: string; detail: string } {
  const comment = event.comment ? ` — ${event.comment}` : "";
  if (event.eventType === "receive_into_bin") {
    const sku = event.sku ?? "item";
    const name = event.itemName ? ` ${event.itemName}` : "";
    return {
      verb: "Received",
      qty: event.qty == null ? "" : String(event.qty),
      detail: `× ${sku}${name}${comment}`,
    };
  }
  if (event.eventType === "move_bin_location") {
    const from = event.fromLocationCode ?? "nowhere";
    return {
      verb: "Moved",
      qty: "",
      detail: `from ${from} to ${event.toLocationCode ?? ""}${comment}`.trim(),
    };
  }
  return { verb: event.eventType, qty: "", detail: comment.trim() };
}

const JAN_EMAIL = "jan@deepdiscountservers.com";

function firstLetter(word: string): string {
  return (word.match(/[A-Za-z]/)?.[0] ?? "").toUpperCase();
}

/** Two letters. Jan is JD. A first and last name use those initials. Otherwise the first two letters of the email. */
export function initialsFromPerson(name: string | null, email: string | null): string {
  const normalizedEmail = (email ?? "").trim().toLowerCase();
  if (normalizedEmail === JAN_EMAIL) return "JD";
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const first = firstLetter(words[0]);
    const last = firstLetter(words[words.length - 1]);
    if (first && last) return `${first}${last}`;
  }
  const local = normalizedEmail.split("@")[0] ?? "";
  const letters = local.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (letters.length >= 2) return letters.slice(0, 2);
  return "OP";
}

export function twoLetterInitials(value: string): string | null {
  const text = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : null;
}

export function locationTypeInputError(input: {
  name: string;
  prefix: string;
  pattern: string;
}): string | null {
  const name = input.name.trim();
  const prefix = input.prefix.trim().toUpperCase();
  const pattern = input.pattern.trim();
  if (!name || name.length > 80) return "Enter a name for the location type.";
  if (!/^[A-Z][A-Z0-9]{0,11}$/.test(prefix)) {
    return "A prefix is 1 to 12 letters or digits, stored in capitals.";
  }
  if (!pattern.startsWith("^") || !pattern.endsWith("$") || pattern.length > 200) {
    return "The pattern must start with ^ and end with $.";
  }
  if (!pattern.includes(prefix)) return `The pattern must include the prefix ${prefix}.`;
  try {
    new RegExp(pattern);
  } catch {
    return "That pattern is not a valid regular expression.";
  }
  return null;
}

export type BinSuggestion = {
  reference: string;
  qty: number;
  locationCode: string | null;
  cycleId: string;
};

export type CreatedBin = {
  id: string;
  reference: string;
  type: BinType;
  number: number;
  locationCode: string | null;
  locationId: string | null;
};

export type ReceiptResult = {
  binId: string;
  reference: string;
  type: BinType;
  cycleId: string;
  cycleOpened: boolean;
  locationCode: string | null;
  qty: number;
};

export type MoveResult = {
  reference: string;
  fromLocationCode: string | null;
  toLocationCode: string;
  cycleId: string | null;
};

export type StockEventRow = {
  id: string;
  eventType: string;
  occurredAt: string;
  operatorInitials: string;
  comment: string | null;
  qty: number | null;
  sku: string | null;
  itemName: string | null;
  project: string | null;
  incomingTag: string | null;
  fromLocationCode: string | null;
  toLocationCode: string | null;
};

export type BinCycleView = {
  id: string;
  status: CycleStatus;
  originDescription: string | null;
  project: string | null;
  incomingTag: string | null;
  openedAt: string;
  closedAt: string | null;
  openedByInitials: string | null;
  defaultLocationCode: string | null;
  openedLocationCode: string | null;
  events: StockEventRow[];
};

export type BinContentRow = {
  itemId: string;
  sku: string;
  name: string;
  qty: number;
};

export type BinDetail = {
  id: string;
  reference: string;
  type: BinType;
  number: number;
  notes: string | null;
  printedCount: number;
  createdAt: string;
  lastPrintedAt: string | null;
  createdByInitials: string | null;
  locationCode: string | null;
  locationId: string | null;
  contents: BinContentRow[];
  cycles: BinCycleView[];
  looseEvents: StockEventRow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function requireBinType(value: unknown): BinType {
  const type = String(value ?? "");
  if (!isBinType(type)) throw new Error("Unexpected bin type.");
  return type;
}

export function suggestionsFromJson(value: unknown): BinSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    reference: String(row.reference ?? ""),
    qty: Number(row.qty),
    locationCode: textOrNull(row.location_code),
    cycleId: String(row.cycle_id ?? ""),
  })).filter((row) => row.reference && row.qty > 0 && row.cycleId);
}

export function createdBinFromJson(value: unknown): CreatedBin {
  if (!isRecord(value)) throw new Error("The bin was not created.");
  const type = requireBinType(value.type);
  const number = Number(value.number);
  if (!Number.isInteger(number)) throw new Error("The bin was not created.");
  return {
    id: String(value.id),
    reference: String(value.reference),
    type,
    number,
    locationCode: textOrNull(value.location_code),
    locationId: textOrNull(value.location_id),
  };
}

export function receiptFromJson(value: unknown): ReceiptResult {
  if (!isRecord(value)) throw new Error("The receipt was not saved.");
  return {
    binId: String(value.bin_id),
    reference: String(value.reference),
    type: requireBinType(value.type),
    cycleId: String(value.cycle_id),
    cycleOpened: value.cycle_opened === true,
    locationCode: textOrNull(value.location_code),
    qty: Number(value.qty),
  };
}

export function moveFromJson(value: unknown): MoveResult {
  if (!isRecord(value)) throw new Error("The bin was not moved.");
  const toLocationCode = textOrNull(value.to_location_code);
  if (!toLocationCode) throw new Error("The bin was not moved.");
  return {
    reference: String(value.reference),
    fromLocationCode: textOrNull(value.from_location_code),
    toLocationCode,
    cycleId: textOrNull(value.cycle_id),
  };
}

function eventFromJson(value: unknown): StockEventRow | null {
  if (!isRecord(value)) return null;
  const qty = value.qty == null ? null : Number(value.qty);
  return {
    id: String(value.id),
    eventType: String(value.event_type ?? ""),
    occurredAt: String(value.occurred_at ?? ""),
    operatorInitials: String(value.operator_initials ?? ""),
    comment: textOrNull(value.comment),
    qty: qty != null && Number.isFinite(qty) ? qty : null,
    sku: textOrNull(value.sku),
    itemName: textOrNull(value.item_name),
    project: textOrNull(value.project),
    incomingTag: textOrNull(value.incoming_tag),
    fromLocationCode: textOrNull(value.from_location_code),
    toLocationCode: textOrNull(value.to_location_code),
  };
}

export function binDetailFromJson(value: unknown): BinDetail | null {
  if (value == null) return null;
  if (!isRecord(value)) throw new Error("Unexpected bin.");
  const type = requireBinType(value.type);
  const cycles = Array.isArray(value.cycles) ? value.cycles : [];
  const contents = Array.isArray(value.contents) ? value.contents : [];
  const loose = Array.isArray(value.loose_events) ? value.loose_events : [];
  return {
    id: String(value.id),
    reference: String(value.reference),
    type,
    number: Number(value.number),
    notes: textOrNull(value.notes),
    printedCount: Number(value.printed_count ?? 0),
    createdAt: String(value.created_at ?? ""),
    lastPrintedAt: textOrNull(value.last_printed_at),
    createdByInitials: textOrNull(value.created_by_initials),
    locationCode: textOrNull(value.location_code),
    locationId: textOrNull(value.location_id),
    contents: contents.filter(isRecord).map((row) => ({
      itemId: String(row.item_id ?? ""),
      sku: String(row.sku ?? ""),
      name: String(row.name ?? ""),
      qty: Number(row.qty),
    })),
    cycles: cycles.filter(isRecord).map((row) => {
      const status = row.status === "closed" ? "closed" : "open";
      const events = Array.isArray(row.events) ? row.events : [];
      return {
        id: String(row.id),
        status,
        originDescription: textOrNull(row.origin_description),
        project: textOrNull(row.project),
        incomingTag: textOrNull(row.incoming_tag),
        openedAt: String(row.opened_at ?? ""),
        closedAt: textOrNull(row.closed_at),
        openedByInitials: textOrNull(row.opened_by_initials),
        defaultLocationCode: textOrNull(row.default_location_code),
        openedLocationCode: textOrNull(row.opened_location_code),
        events: events.map(eventFromJson).filter((event): event is StockEventRow => event !== null),
      } satisfies BinCycleView;
    }),
    looseEvents: loose.map(eventFromJson).filter((event): event is StockEventRow => event !== null),
  };
}

export function binSuffixLabel(type: BinType): string {
  return binTypeLabel(type);
}
