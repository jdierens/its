import { asMoney, formatMoney, parseMoney } from "@/lib/pricing/quotes";

export const QUOTE_REVIEWS_PATH = "/pricing/quotes";

export const QUOTE_REVIEWS_MIGRATION = "supabase/migrations/20261103180000_quote_events.sql";

export const QUOTE_REVIEWS_SETUP =
  "Quote reviews are not set up yet. Apply supabase/migrations/20261103180000_quote_events.sql. Deploying does not run it.";

export const DUE_SOON_DAYS = 7;

export const QUOTE_LINE_LIMIT = 500;

export const QUOTE_BID_LIMIT = 12;

export const QUOTE_DIRECTIONS = [
  { id: "inbound_ask", label: "Inbound ask" },
  { id: "outbound_ask", label: "Outbound ask" },
  { id: "inbound_response", label: "Inbound response" },
  { id: "outbound_offer", label: "Outbound offer" },
] as const;

export const QUOTE_CHANNELS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email" },
  { id: "sheet", label: "Sheet" },
  { id: "other", label: "Other" },
] as const;

export const QUOTE_STATUSES = [
  { id: "open", label: "Open" },
  { id: "reviewing", label: "Reviewing" },
  { id: "bid_sent", label: "Bid sent" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
  { id: "passed", label: "Passed" },
] as const;

export const QUOTE_DECISIONS = [
  { id: "bid", label: "Bid" },
  { id: "pass", label: "Pass" },
  { id: "counter", label: "Counter" },
] as const;

export const QUOTE_RELATIONS = [
  { id: "same_list", label: "Same list" },
  { id: "forwarded_for_pricing", label: "Forwarded for pricing" },
  { id: "response_to", label: "Response to" },
  { id: "other", label: "Other" },
] as const;

export type QuoteDirection = (typeof QUOTE_DIRECTIONS)[number]["id"];
export type QuoteChannel = (typeof QUOTE_CHANNELS)[number]["id"];
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]["id"];
export type QuoteDecision = (typeof QUOTE_DECISIONS)[number]["id"];
export type QuoteRelationType = (typeof QUOTE_RELATIONS)[number]["id"];

const OPEN_STATUSES: readonly QuoteStatus[] = ["open", "reviewing", "bid_sent"];
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QuoteBidInput = {
  key: string;
  id: string;
  bidderName: string;
  unitPrice: string;
  note: string;
};

export type QuoteLineInput = {
  key: string;
  id: string;
  itemId: string;
  partNumber: string;
  sku: string;
  itemName: string;
  condition: string;
  qty: string;
  unitPrice: string;
  decision: string;
  decisionNote: string;
  bids: QuoteBidInput[];
};

export type QuoteSaveInput = {
  reference: string;
  counterpartyName: string;
  vendorId: string;
  channel: string;
  direction: string;
  status: string;
  receivedOn: string;
  dueOn: string;
  currency: string;
  notes: string;
  lines: QuoteLineInput[];
};

export type ParsedQuoteBid = {
  key: string;
  id: string | null;
  bidderName: string;
  unitPrice: number | null;
  note: string | null;
};

export type ParsedQuoteLine = {
  key: string;
  id: string | null;
  itemId: string | null;
  partNumber: string | null;
  sku: string | null;
  itemName: string | null;
  condition: string | null;
  qty: number | null;
  unitPrice: number | null;
  decision: QuoteDecision | null;
  decisionNote: string | null;
  bids: ParsedQuoteBid[];
};

export type ParsedQuote = {
  reference: string | null;
  counterpartyName: string | null;
  vendorId: string | null;
  channel: QuoteChannel;
  direction: QuoteDirection;
  status: QuoteStatus;
  receivedOn: string;
  dueOn: string | null;
  currency: string;
  notes: string | null;
  lines: ParsedQuoteLine[];
};

export type QuoteParse = { ok: true; value: ParsedQuote; warnings: string[] } | { ok: false; message: string };

export type QuoteLineIdentity = {
  itemId: string | null;
  partNumber: string;
  sku: string;
  itemName: string;
  condition: string;
  qty: string;
};

export type QuoteTotals = {
  lineCount: number;
  qty: number | null;
  offerExt: number | null;
  competingExt: number | null;
};

export type QuoteLineSummary = {
  qty: number | null;
  ext: number | null;
  bestUnit: number | null;
};

export type QuoteVendorOption = { id: string; name: string };

export type QuoteBidDraft = {
  key: string;
  id: string;
  bidderName: string;
  unitPrice: string;
  note: string;
};

export type QuoteLineDraft = {
  key: string;
  id: string;
  itemId: string;
  partNumber: string;
  sku: string;
  itemName: string;
  condition: string;
  qty: string;
  unitPrice: string;
  decision: string;
  decisionNote: string;
  bids: QuoteBidDraft[];
  onHand: number | null;
  lastBuy: string;
  lastSell: string;
};

export type QuoteReviewDraft = {
  id: string | null;
  reference: string;
  counterpartyName: string;
  vendorId: string;
  channel: string;
  direction: string;
  status: string;
  receivedOn: string;
  dueOn: string;
  currency: string;
  notes: string;
  lines: QuoteLineDraft[];
};

export type QuoteRelationView = {
  id: string;
  otherId: string;
  otherLabel: string;
  phrase: string;
  note: string;
};

export type QuoteListRelation = {
  id: string;
  eventId: string;
  phrase: string;
  otherLabel: string;
};

export type QuoteListRow = {
  id: string;
  reference: string;
  label: string;
  receivedOn: string;
  dueOn: string | null;
  dueSoon: boolean;
  vendorId: string | null;
  counterparty: string;
  channel: string;
  direction: string;
  status: string;
  lineCount: number;
  qty: number | null;
  offerExt: number | null;
  competingExt: number | null;
  currency: string;
  related: QuoteListRelation[];
};

export type QuoteChoice = { id: string; label: string };

export type QuoteItemHit = {
  id: string;
  sku: string;
  name: string;
  partNumber: string;
  condition: string;
  onHand: number | null;
  lastBuy: string;
  lastSell: string;
};

export function blankQuoteLine(): QuoteLineDraft {
  return {
    key: "",
    id: "",
    itemId: "",
    partNumber: "",
    sku: "",
    itemName: "",
    condition: "",
    qty: "",
    unitPrice: "",
    decision: "",
    decisionNote: "",
    bids: [],
    onHand: null,
    lastBuy: "",
    lastSell: "",
  };
}

export function blankQuoteDraft(today: string): QuoteReviewDraft {
  const line = blankQuoteLine();
  line.key = "new-line";
  return {
    id: null,
    reference: "",
    counterpartyName: "",
    vendorId: "",
    channel: "whatsapp",
    direction: "inbound_ask",
    status: "open",
    receivedOn: today,
    dueOn: "",
    currency: "USD",
    notes: "",
    lines: [line],
  };
}

export function quoteOptionLabel(options: readonly { id: string; label: string }[], value: string): string {
  return options.find((item) => item.id === value)?.label ?? value;
}

export function quoteDirectionLabel(value: string): string {
  return quoteOptionLabel(QUOTE_DIRECTIONS, value);
}

export function quoteChannelLabel(value: string): string {
  return quoteOptionLabel(QUOTE_CHANNELS, value);
}

export function quoteStatusLabel(value: string): string {
  return quoteOptionLabel(QUOTE_STATUSES, value);
}

export function quoteRelationLabel(value: string): string {
  return quoteOptionLabel(QUOTE_RELATIONS, value);
}

export function isQuoteDirection(value: string): value is QuoteDirection {
  return QUOTE_DIRECTIONS.some((item) => item.id === value);
}

export function isQuoteChannel(value: string): value is QuoteChannel {
  return QUOTE_CHANNELS.some((item) => item.id === value);
}

export function isQuoteStatus(value: string): value is QuoteStatus {
  return QUOTE_STATUSES.some((item) => item.id === value);
}

export function isQuoteRelationType(value: string): value is QuoteRelationType {
  return QUOTE_RELATIONS.some((item) => item.id === value);
}

/** Badge tone already used by the app. Quote statuses are not new chip colors. */
export function quoteStatusTone(status: string): string {
  switch (status) {
    case "open":
      return "open";
    case "reviewing":
      return "pending";
    case "bid_sent":
      return "draft";
    case "won":
      return "received";
    case "lost":
      return "cancelled";
    case "passed":
      return "closed";
    default:
      return "neutral";
  }
}

export function quoteCalendarDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
}

export function addCalendarDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isQuoteDueSoon(input: { dueOn: string | null; status: string; today: string }): boolean {
  if (!input.dueOn || !isQuoteStatus(input.status) || !OPEN_STATUSES.includes(input.status)) return false;
  return input.dueOn <= addCalendarDays(input.today, DUE_SOON_DAYS);
}

export function counterpartyLabel(vendorName: string, counterpartyName: string): string {
  const vendor = vendorName.trim();
  const name = counterpartyName.trim();
  if (vendor && name && vendor.toLowerCase() !== name.toLowerCase()) return `${vendor} (${name})`;
  return vendor || name || "—";
}

export function quoteEventLabel(input: {
  reference: string;
  counterparty: string;
  receivedOn: string;
}): string {
  const reference = input.reference.trim();
  if (reference) return reference;
  const counterparty = input.counterparty.trim();
  if (counterparty && counterparty !== "—") return counterparty;
  return "Quote";
}

/**
 * Spoken from the event you are looking at.
 * from: this event is the relation toward the other one.
 * to: the other event is the relation toward this one.
 */
export function relationPhrase(type: string, side: "from" | "to"): string {
  switch (type) {
    case "same_list":
      return "Same list";
    case "forwarded_for_pricing":
      return side === "from" ? "Forwarded for pricing" : "Forwarded as";
    case "response_to":
      return side === "from" ? "Response to" : "Response from";
    default:
      return "Related";
  }
}

export function suggestedRelatedDirection(direction: QuoteDirection): QuoteDirection {
  switch (direction) {
    case "inbound_ask":
      return "outbound_ask";
    case "outbound_ask":
      return "inbound_response";
    case "inbound_response":
      return "outbound_offer";
    case "outbound_offer":
      return "inbound_response";
  }
}

export function suggestedRelationType(newDirection: QuoteDirection): QuoteRelationType {
  switch (newDirection) {
    case "outbound_ask":
      return "forwarded_for_pricing";
    case "inbound_response":
    case "outbound_offer":
      return "response_to";
    default:
      return "same_list";
  }
}

/** Identity copied onto a related quote. Prices, decisions, and bids are not on this type. */
export function linesForRelatedEvent(
  lines: (QuoteLineIdentity & { unitPrice?: string; decision?: string; decisionNote?: string })[],
): QuoteLineIdentity[] {
  return lines
    .filter((line) => line.itemId || line.partNumber.trim() || line.sku.trim() || line.itemName.trim() || line.qty.trim())
    .map((line) => ({
      itemId: line.itemId,
      partNumber: line.partNumber.trim(),
      sku: line.sku.trim(),
      itemName: line.itemName.trim(),
      condition: line.condition.trim(),
      qty: line.qty.trim(),
    }));
}

export function quoteQtyText(value: unknown): string {
  const qty = asMoney(value);
  if (qty == null) return "";
  return String(qty);
}

export function parseQuoteQty(value: string): { ok: true; qty: number | null } | { ok: false; message: string } {
  const trimmed = value.trim().replaceAll(",", "");
  if (!trimmed) return { ok: true, qty: null };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { ok: false, message: "Quantity uses up to 2 decimals." };
  const qty = Number(trimmed);
  if (!Number.isFinite(qty) || qty > 9_999_999_999.99) return { ok: false, message: "That quantity is too large." };
  return { ok: true, qty };
}

export function quoteExtension(qty: string, unitPrice: string): string {
  const parsedQty = parseQuoteQty(qty);
  const parsedPrice = parseMoney(unitPrice);
  if (!parsedQty.ok || !parsedPrice.ok || parsedQty.qty == null || parsedPrice.amount == null) return "";
  return formatMoney(roundMoney(parsedQty.qty * parsedPrice.amount));
}

export function bestCompetingUnit(bids: { unitPrice: string }[]): number | null {
  let best: number | null = null;
  for (const bid of bids) {
    const parsed = parseMoney(bid.unitPrice);
    if (!parsed.ok || parsed.amount == null) continue;
    if (best == null || parsed.amount < best) best = parsed.amount;
  }
  return best;
}

export function summarizeQuoteLines(lines: QuoteLineSummary[]): QuoteTotals {
  let qty = 0;
  let hasQty = false;
  let offer = 0;
  let hasOffer = false;
  let competing = 0;
  let hasCompeting = false;
  for (const line of lines) {
    if (line.qty != null) {
      qty = roundMoney(qty + line.qty);
      hasQty = true;
    }
    if (line.ext != null) {
      offer = roundMoney(offer + line.ext);
      hasOffer = true;
    }
    if (line.qty != null && line.bestUnit != null) {
      competing = roundMoney(competing + roundMoney(line.qty * line.bestUnit));
      hasCompeting = true;
    }
  }
  return {
    lineCount: lines.length,
    qty: hasQty ? qty : null,
    offerExt: hasOffer ? offer : null,
    competingExt: hasCompeting ? competing : null,
  };
}

export function parseQuoteSave(input: QuoteSaveInput): QuoteParse {
  if (input.lines.length > QUOTE_LINE_LIMIT) {
    return { ok: false, message: `A quote review can hold ${QUOTE_LINE_LIMIT} lines.` };
  }
  const reference = clip(input.reference, 200);
  if (reference.error) return { ok: false, message: "The list name is too long." };
  const counterpartyName = clip(input.counterpartyName, 200);
  if (counterpartyName.error) return { ok: false, message: "The contact name is too long." };
  const notes = clip(input.notes, 4000);
  if (notes.error) return { ok: false, message: "Notes are too long." };
  if (!isQuoteChannel(input.channel)) return { ok: false, message: "Choose a channel." };
  if (!isQuoteDirection(input.direction)) return { ok: false, message: "Choose a direction." };
  if (!isQuoteStatus(input.status)) return { ok: false, message: "Choose a status." };
  const received = parseDate(input.receivedOn, true);
  if (!received.ok || !received.value) return { ok: false, message: "Enter the received date." };
  const due = parseDate(input.dueOn, false);
  if (!due.ok) return due;
  const vendorId = optionalUuid(input.vendorId, "That vendor was not found.");
  if (!vendorId.ok) return vendorId;
  const currency = (input.currency.trim() || "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Currency is a 3-letter code." };

  const lines: ParsedQuoteLine[] = [];
  for (const [index, line] of input.lines.entries()) {
    const parsed = parseLine(line, index + 1);
    if (!parsed.ok) return parsed;
    if (parsed.line) lines.push(parsed.line);
  }

  const warnings: string[] = [];
  if (due.value && received.value && due.value < received.value) {
    warnings.push("Due date is before the received date. You can still save.");
  }

  return {
    ok: true,
    warnings,
    value: {
      reference: reference.value,
      counterpartyName: counterpartyName.value,
      vendorId: vendorId.value,
      channel: input.channel,
      direction: input.direction,
      status: input.status,
      receivedOn: received.value,
      dueOn: due.value,
      currency,
      notes: notes.value,
      lines,
    },
  };
}

export type QuoteRelatedInput = {
  sourceId: string;
  reference: string;
  counterpartyName: string;
  vendorId: string;
  channel: string;
  direction: string;
  receivedOn: string;
  dueOn: string;
  relationType: string;
  relationNote: string;
};

export type ParsedRelatedQuote = {
  sourceId: string;
  reference: string | null;
  counterpartyName: string | null;
  vendorId: string | null;
  channel: QuoteChannel;
  direction: QuoteDirection;
  receivedOn: string;
  dueOn: string | null;
  relationType: QuoteRelationType;
  relationNote: string | null;
};

export function parseRelatedQuote(input: QuoteRelatedInput): { ok: true; value: ParsedRelatedQuote } | { ok: false; message: string } {
  if (!UUID_VALUE.test(input.sourceId)) return { ok: false, message: "That quote was not found." };
  const header = parseQuoteSave({
    reference: input.reference,
    counterpartyName: input.counterpartyName,
    vendorId: input.vendorId,
    channel: input.channel,
    direction: input.direction,
    status: "open",
    receivedOn: input.receivedOn,
    dueOn: input.dueOn,
    currency: "USD",
    notes: "",
    lines: [],
  });
  if (!header.ok) return header;
  if (!isQuoteRelationType(input.relationType)) return { ok: false, message: "Choose how the quotes are related." };
  const note = clip(input.relationNote, 500);
  if (note.error) return { ok: false, message: "The relation note is too long." };
  return {
    ok: true,
    value: {
      sourceId: input.sourceId,
      reference: header.value.reference,
      counterpartyName: header.value.counterpartyName,
      vendorId: header.value.vendorId,
      channel: header.value.channel,
      direction: header.value.direction,
      receivedOn: header.value.receivedOn,
      dueOn: header.value.dueOn,
      relationType: input.relationType,
      relationNote: note.value,
    },
  };
}

export function quoteReviewsUnavailable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!/quote_event/i.test(message)) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "PGRST204" ||
    error.code === "42P01" ||
    /schema cache|does not exist|could not find/i.test(message)
  );
}

function parseLine(
  line: QuoteLineInput,
  number: number,
): { ok: true; line: ParsedQuoteLine | null } | { ok: false; message: string } {
  if (line.bids.length > QUOTE_BID_LIMIT) {
    return { ok: false, message: `Line ${number} can hold ${QUOTE_BID_LIMIT} competing bids.` };
  }
  const itemId = optionalUuid(line.itemId, `Line ${number} is linked to an item that was not found.`);
  if (!itemId.ok) return itemId;
  const id = optionalUuid(line.id, `Line ${number} was not found on this quote.`);
  if (!id.ok) return id;
  const partNumber = clip(line.partNumber, 120);
  if (partNumber.error) return { ok: false, message: `The part number on line ${number} is too long.` };
  const sku = clip(line.sku, 80);
  if (sku.error) return { ok: false, message: `The SKU on line ${number} is too long.` };
  const itemName = clip(line.itemName, 300);
  if (itemName.error) return { ok: false, message: `The name on line ${number} is too long.` };
  const condition = clip(line.condition, 80);
  if (condition.error) return { ok: false, message: `The condition on line ${number} is too long.` };
  const decisionNote = clip(line.decisionNote, 500);
  if (decisionNote.error) return { ok: false, message: `The note on line ${number} is too long.` };
  const qty = parseQuoteQty(line.qty);
  if (!qty.ok) return { ok: false, message: `Line ${number}: ${qty.message}` };
  const unitPrice = parseMoney(line.unitPrice);
  if (!unitPrice.ok) return { ok: false, message: `Line ${number}: ${unitPrice.message}` };
  const decision = line.decision.trim();
  if (decision && !QUOTE_DECISIONS.some((item) => item.id === decision)) {
    return { ok: false, message: `Choose a decision on line ${number}.` };
  }

  const bids: ParsedQuoteBid[] = [];
  for (const bid of line.bids) {
    const parsedBid = parseBid(bid, number);
    if (!parsedBid.ok) return parsedBid;
    if (parsedBid.bid) bids.push(parsedBid.bid);
  }

  const hasContent = Boolean(
    itemId.value ||
      partNumber.value ||
      sku.value ||
      itemName.value ||
      condition.value ||
      qty.qty != null ||
      unitPrice.amount != null ||
      decision ||
      decisionNote.value ||
      bids.length > 0,
  );
  if (!hasContent) return { ok: true, line: null };
  if (!line.key.trim()) return { ok: false, message: `Line ${number} could not be saved.` };

  return {
    ok: true,
    line: {
      key: line.key,
      id: id.value,
      itemId: itemId.value,
      partNumber: partNumber.value,
      sku: sku.value,
      itemName: itemName.value,
      condition: condition.value,
      qty: qty.qty,
      unitPrice: unitPrice.amount,
      decision: decision ? (decision as QuoteDecision) : null,
      decisionNote: decisionNote.value,
      bids,
    },
  };
}

function parseBid(
  bid: QuoteBidInput,
  lineNumber: number,
): { ok: true; bid: ParsedQuoteBid | null } | { ok: false; message: string } {
  const name = clip(bid.bidderName, 120);
  if (name.error) return { ok: false, message: `A bidder name on line ${lineNumber} is too long.` };
  const note = clip(bid.note, 300);
  if (note.error) return { ok: false, message: `A bid note on line ${lineNumber} is too long.` };
  const unitPrice = parseMoney(bid.unitPrice);
  if (!unitPrice.ok) return { ok: false, message: `Line ${lineNumber}: ${unitPrice.message}` };
  if (!name.value && unitPrice.amount == null && !note.value) return { ok: true, bid: null };
  if (!name.value) return { ok: false, message: `Name the competing bidder on line ${lineNumber}.` };
  const id = optionalUuid(bid.id, `A competing bid on line ${lineNumber} was not found.`);
  if (!id.ok) return id;
  return {
    ok: true,
    bid: { key: bid.key || name.value, id: id.value, bidderName: name.value, unitPrice: unitPrice.amount, note: note.value },
  };
}

function clip(value: string, max: number): { value: string | null; error: boolean } {
  const trimmed = value.trim();
  if (!trimmed) return { value: null, error: false };
  if (trimmed.length > max) return { value: null, error: true };
  return { value: trimmed, error: false };
}

function parseDate(
  value: string,
  required: boolean,
): { ok: true; value: string } | { ok: true; value: null } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) return { ok: false, message: "Enter the received date." };
    return { ok: true, value: null };
  }
  if (!DATE_VALUE.test(trimmed)) return { ok: false, message: "Use a real date." };
  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { ok: false, message: "Use a real date." };
  }
  return { ok: true, value: trimmed };
}

function optionalUuid(value: string, message: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!UUID_VALUE.test(trimmed)) return { ok: false, message };
  return { ok: true, value: trimmed };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
