import { canonicalize } from "@/lib/formDirty";
import { asMoney, formatMoney, parseMoney } from "@/lib/pricing/quotes";

export const QUOTE_REVIEWS_PATH = "/pricing/quotes";

export const QUOTE_REVIEWS_MIGRATION = "supabase/migrations/20261105040000_quote_line_alts_and_awards.sql";

export const QUOTE_WON_PARTIAL_MIGRATION = "supabase/migrations/20261105060000_quote_won_partial.sql";

export const QUOTE_REVIEWS_SETUP =
  "Quote requests need supabase/migrations/20261103180000_quote_events.sql, supabase/migrations/20261104140000_quote_event_flow.sql, supabase/migrations/20261105040000_quote_line_alts_and_awards.sql, and supabase/migrations/20261105060000_quote_won_partial.sql. Deploying does not run them.";

export const DUE_SOON_DAYS = 7;

export const QUOTE_LINE_LIMIT = 500;

export const QUOTE_BID_LIMIT = 12;

export const QUOTE_ALT_LIMIT = 8;

/** How many names a quote party picker shows while someone is typing. */
export const QUOTE_PARTY_LIMIT = 12;

/** Quote-list originator search. Wider than the picker, still not the whole customer table. */
export const QUOTE_LIST_PARTY_LIMIT = 100;

/** ilike pattern for a party name. Null when the query is empty after stripping wildcards. */
export function quotePartyNamePattern(query: string): string | null {
  const needle = query.trim().replace(/[%_,()"\\]/g, "").slice(0, 80);
  if (!needle) return null;
  return `%${needle}%`;
}

/** Award winner stored for the DDS response. A bidder stores that bidder's name. */
export const DDS_AWARD = "dds";

export const QUOTE_LEAD_TIME_DEFAULT = "In stock";

export const QUOTE_SIDES = [
  { id: "buy", label: "Buy", outcome: "PO" },
  { id: "sell", label: "Sell", outcome: "SO" },
] as const;

export const QUOTE_DIRECTIONS = [
  { id: "inbound", label: "Inbound" },
  { id: "outbound", label: "Outbound" },
] as const;

export const QUOTE_ORIGINATORS = [
  { id: "customer", label: "Customer" },
  { id: "vendor", label: "Vendor" },
  { id: "prospect", label: "Prospect" },
  { id: "dds", label: "DDS" },
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
  { id: "won_partial", label: "Won partial" },
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

export type QuoteSide = (typeof QUOTE_SIDES)[number]["id"];
export type QuoteDirection = (typeof QUOTE_DIRECTIONS)[number]["id"];
export type QuoteOriginatorKind = (typeof QUOTE_ORIGINATORS)[number]["id"];
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
  sku: string;
  itemName: string;
  qty: string;
  leadTime: string;
};

export type QuoteAltInput = {
  key: string;
  id: string;
  itemId: string;
  partNumber: string;
  sku: string;
  itemName: string;
  unitPrice: string;
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
  targetPrice: string;
  specialRequirements: string;
  replyQty: string;
  unitPrice: string;
  leadTime: string;
  decision: string;
  decisionNote: string;
  awardWinner: string;
  awardQty: string;
  bids: QuoteBidInput[];
  alts: QuoteAltInput[];
};

export type QuoteSaveInput = {
  reference: string;
  counterpartyName: string;
  vendorId: string;
  customerId: string;
  prospectId: string;
  originatorKind: string;
  channel: string;
  direction: string;
  side: string;
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
  sku: string | null;
  itemName: string | null;
  qty: number | null;
  leadTime: string | null;
};

export type ParsedQuoteAlt = {
  key: string;
  id: string | null;
  itemId: string | null;
  partNumber: string | null;
  sku: string | null;
  itemName: string | null;
  unitPrice: number | null;
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
  targetPrice: number | null;
  specialRequirements: string | null;
  replyQty: number | null;
  unitPrice: number | null;
  leadTime: string | null;
  decision: QuoteDecision | null;
  decisionNote: string | null;
  awardWinner: string | null;
  awardQty: number | null;
  bids: ParsedQuoteBid[];
  alts: ParsedQuoteAlt[];
};

export type ParsedQuote = {
  reference: string | null;
  counterpartyName: string | null;
  vendorId: string | null;
  customerId: string | null;
  prospectId: string | null;
  originatorKind: QuoteOriginatorKind;
  channel: QuoteChannel;
  direction: QuoteDirection;
  side: QuoteSide;
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
  targetPrice: string;
  specialRequirements: string;
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

export type QuotePartyOption = { id: string; name: string };

export type QuoteVendorOption = QuotePartyOption;

export type QuoteBidDraft = {
  key: string;
  id: string;
  bidderName: string;
  unitPrice: string;
  note: string;
  sku: string;
  itemName: string;
  qty: string;
  leadTime: string;
};

export type QuoteAltDraft = {
  key: string;
  id: string;
  itemId: string;
  partNumber: string;
  sku: string;
  itemName: string;
  unitPrice: string;
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
  targetPrice: string;
  specialRequirements: string;
  replyQty: string;
  unitPrice: string;
  leadTime: string;
  decision: string;
  decisionNote: string;
  awardWinner: string;
  awardQty: string;
  bids: QuoteBidDraft[];
  alts: QuoteAltDraft[];
  onHand: number | null;
  lastBuy: string;
  lastSell: string;
};

export type QuoteOrderLink = {
  kind: "purchase" | "sales";
  id: string;
  status: string;
  number: string;
  href: string;
  label: string;
};

export type QuoteReviewDraft = {
  id: string | null;
  reference: string;
  counterpartyName: string;
  vendorId: string;
  customerId: string;
  prospectId: string;
  originatorKind: string;
  channel: string;
  direction: string;
  side: string;
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
  customerId: string | null;
  prospectId: string | null;
  originatorKind: string;
  company: string;
  contact: string;
  originator: string;
  channel: string;
  direction: string;
  side: string;
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

export type OriginatorIds = {
  originatorKind: string;
  vendorId: string;
  customerId: string;
  prospectId: string;
};

export function blankQuoteBid(name = ""): QuoteBidDraft {
  return {
    key: "",
    id: "",
    bidderName: name,
    unitPrice: "",
    note: "",
    sku: "",
    itemName: "",
    qty: "",
    leadTime: "",
  };
}

export function blankQuoteAlt(): QuoteAltDraft {
  return {
    key: "",
    id: "",
    itemId: "",
    partNumber: "",
    sku: "",
    itemName: "",
    unitPrice: "",
  };
}

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
    targetPrice: "",
    specialRequirements: "",
    replyQty: "",
    unitPrice: "",
    leadTime: "",
    decision: "",
    decisionNote: "",
    awardWinner: "",
    awardQty: "",
    bids: [],
    alts: [],
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
    customerId: "",
    prospectId: "",
    originatorKind: "customer",
    channel: "whatsapp",
    direction: "inbound",
    side: "sell",
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
  const axes = displayAxes("sell", value);
  return axes.direction === "outbound" ? "Outbound" : "Inbound";
}

export function quoteSideLabel(value: string): string {
  return quoteOptionLabel(QUOTE_SIDES, value);
}

export function quoteOriginatorLabel(value: string): string {
  return quoteOptionLabel(QUOTE_ORIGINATORS, value);
}

export function quoteChannelLabel(value: string): string {
  return quoteOptionLabel(QUOTE_CHANNELS, value);
}

export function quoteStatusLabel(value: string): string {
  return quoteOptionLabel(QUOTE_STATUSES, value);
}

/** Missing customer, prospect, or vendor for this quote type. Null when the party already fits. */
export function quoteCounterpartyMessage(input: {
  side: string;
  direction: string;
  originatorKind: string;
  vendorId: string;
  customerId: string;
  prospectId: string;
}): string | null {
  if (!isQuoteSide(input.side) || !isQuoteDirection(input.direction) || !isQuoteOriginatorKind(input.originatorKind)) return null;
  return originatorPartyError({
    side: input.side,
    direction: input.direction,
    originatorKind: input.originatorKind,
    vendorId: optionalId(input.vendorId),
    customerId: optionalId(input.customerId),
    prospectId: optionalId(input.prospectId),
  });
}

function optionalId(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export function quoteRelationLabel(value: string): string {
  return quoteOptionLabel(QUOTE_RELATIONS, value);
}

export function isQuoteDirection(value: string): value is QuoteDirection {
  return QUOTE_DIRECTIONS.some((item) => item.id === value);
}

export function isQuoteSide(value: string): value is QuoteSide {
  return QUOTE_SIDES.some((item) => item.id === value);
}

export function isQuoteOriginatorKind(value: string): value is QuoteOriginatorKind {
  return QUOTE_ORIGINATORS.some((item) => item.id === value);
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

const LEGACY_FLOW: Record<string, { side: QuoteSide; direction: QuoteDirection }> = {
  inbound_ask: { side: "sell", direction: "inbound" },
  outbound_ask: { side: "buy", direction: "outbound" },
  inbound_response: { side: "buy", direction: "inbound" },
  outbound_offer: { side: "sell", direction: "outbound" },
};

/** Stored side and direction, with the old four-way token mapped so the page never prints it. */
export function displayAxes(side: string, direction: string): { side: QuoteSide; direction: QuoteDirection } {
  const legacy = LEGACY_FLOW[direction];
  const nextSide: QuoteSide = side === "buy" || side === "sell" ? side : legacy?.side ?? "sell";
  const nextDirection: QuoteDirection =
    direction === "inbound" || direction === "outbound" ? direction : legacy?.direction ?? "inbound";
  return { side: nextSide, direction: nextDirection };
}

/** Full pattern name. This is the type label on the list and the quote. */
export function quoteFlowLabel(side: string, direction: string): string {
  const axes = displayAxes(side, direction);
  if (axes.direction === "inbound" && axes.side === "sell") return "Inbound Sell Request";
  if (axes.direction === "inbound" && axes.side === "buy") return "Inbound Buy Request";
  if (axes.direction === "outbound" && axes.side === "sell") return "Outbound Sell Request";
  return "Outbound Buy Offer";
}

export function quoteFlowHint(side: string, direction: string): string {
  const axes = displayAxes(side, direction);
  const label = quoteFlowLabel(axes.side, axes.direction);
  if (axes.direction === "inbound" && axes.side === "sell") {
    return `${label}. Someone else started a sell. Won becomes a sales order. Pick the customer, or a prospect when they are not a customer yet.`;
  }
  if (axes.direction === "inbound" && axes.side === "buy") {
    return `${label}. Someone else started a buy. Won becomes a purchase order. Pick the vendor. The overview lists every other price beside DDS.`;
  }
  if (axes.direction === "outbound" && axes.side === "sell") {
    return `${label}. DDS started a sell. Won becomes a sales order. The counterparty is a customer or a prospect.`;
  }
  return `${label}. DDS started a buy and expects a quote back. Won becomes a purchase order. The counterparty is a vendor.`;
}

export type QuoteOfferColumn = {
  id: string;
  label: string;
  prices: { matchKey: string; unitPrice: string }[];
};

/** Part number, then SKU, so a related quote can share a price column with this list. */
export function quoteLineMatchKey(partNumber: string, sku: string): string {
  const part = partNumber.toUpperCase().replace(/[\s/\\-]/g, "");
  if (part) return `p:${part}`;
  const skuKey = sku.trim().toLowerCase();
  return skuKey ? `s:${skuKey}` : "";
}

export function quoteMoneyText(value: string, currency = "USD"): string {
  const parsed = parseMoney(value);
  if (!parsed.ok || parsed.amount == null) return "";
  return formatMoney(parsed.amount, currency);
}

/** Extended totals display as whole currency units. Unit prices keep cents. */
function formatQuoteExt(amount: number, currency = "USD"): string {
  const whole = Math.round(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(whole);
  } catch {
    return `${whole} ${currency}`;
  }
}

/** Whole-dollar extension shown under a unit. Null when quantity or unit is missing. */
export function quoteExtWhole(qty: string, unit: string): number | null {
  const parsedQty = parseQuoteQty(qty);
  const parsed = parseMoney(unit);
  if (!parsedQty.ok || !parsed.ok || parsedQty.qty == null || parsed.amount == null) return null;
  return Math.round(roundMoney(parsedQty.qty * parsed.amount));
}

export function quoteExtText(amount: number | null, currency = "USD"): string {
  if (amount == null) return "";
  return formatQuoteExt(amount, currency);
}

export function quoteMoneyExt(qty: string, unit: string, currency = "USD"): string {
  return quoteExtText(quoteExtWhole(qty, unit), currency);
}

/**
 * Extension used on the overview. DDS uses the reply quantity when it is filled in.
 * Every other column uses the request quantity, then the reply quantity.
 */
export function quoteOverviewExt(line: { qty: string; replyQty?: string }, unit: string, kind: "dds" | "bid"): number | null {
  const reply = (line.replyQty ?? "").trim();
  const request = line.qty.trim();
  return quoteExtWhole(kind === "dds" ? reply || request : request || reply, unit);
}

/** Sum of the whole-dollar extensions already shown in one column. */
export function quoteExtTotal(amounts: (number | null)[], currency = "USD"): string {
  let total = 0;
  let any = false;
  for (const amount of amounts) {
    if (amount == null) continue;
    total += amount;
    any = true;
  }
  return any ? formatQuoteExt(total, currency) : "";
}

export function offerUnit(column: QuoteOfferColumn, partNumber: string, sku: string): string {
  const key = quoteLineMatchKey(partNumber, sku);
  if (!key) return "";
  return column.prices.find((price) => price.matchKey === key)?.unitPrice ?? "";
}

/**
 * Inbound sell lists customers and prospects. Inbound buy lists vendors.
 * Outbound is DDS, and the counterparty list follows the side.
 */
export function originatorPicker(side: string, direction: string): { kind: "dds" | "party"; party: "customer" | "vendor" } {
  if (direction === "outbound") return { kind: "dds", party: side === "buy" ? "vendor" : "customer" };
  return { kind: "party", party: side === "buy" ? "vendor" : "customer" };
}

/** Keep the party that still belongs on this side and direction. Clear the rest. */
export function originatorForFlow(side: string, direction: string, current: OriginatorIds): OriginatorIds {
  const picker = originatorPicker(side, direction);
  if (picker.kind === "dds") {
    if (picker.party === "vendor") {
      return { originatorKind: "dds", vendorId: current.vendorId, customerId: "", prospectId: "" };
    }
    if (current.prospectId && !current.customerId) {
      return { originatorKind: "dds", vendorId: "", customerId: "", prospectId: current.prospectId };
    }
    return { originatorKind: "dds", vendorId: "", customerId: current.customerId, prospectId: "" };
  }
  if (picker.party === "vendor") {
    return { originatorKind: "vendor", vendorId: current.vendorId, customerId: "", prospectId: "" };
  }
  if (current.prospectId && !current.customerId) {
    return { originatorKind: "prospect", vendorId: "", customerId: "", prospectId: current.prospectId };
  }
  return { originatorKind: "customer", vendorId: "", customerId: current.customerId, prospectId: "" };
}

export function originatorDisplay(input: { kind: string; company: string; contact: string }): string {
  const company = input.company.trim();
  const contact = input.contact.trim();
  const party = counterpartyLabel(company, contact);
  if (input.kind === "dds") return party === "—" ? "DDS" : `DDS → ${party}`;
  return party;
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
    case "won_partial":
      return "received";
    case "lost":
      return "cancelled";
    case "passed":
      return "closed";
    default:
      return "neutral";
  }
}

export function quoteSideTone(side: string): string {
  if (side === "buy") return "open";
  if (side === "sell") return "received";
  return "neutral";
}

export function quoteDirectionTone(direction: string): string {
  if (direction === "inbound") return "pending";
  if (direction === "outbound") return "draft";
  return "neutral";
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

/** Names matching the typed text, capped so the menu stays a short list. */
export function filterQuoteParties<T extends { name: string }>(parties: T[], query: string, limit = QUOTE_PARTY_LIMIT): T[] {
  const needle = query.trim().toLowerCase();
  const matched = needle ? parties.filter((party) => party.name.toLowerCase().includes(needle)) : parties;
  return matched.slice(0, Math.max(1, limit));
}

export function quoteOrderKind(side: string): "purchase" | "sales" {
  return side === "buy" ? "purchase" : "sales";
}

/** Link text for the order created from a quote request. An unnumbered draft says Draft PO or Draft SO. */
export function quoteOrderLinkLabel(kind: "purchase" | "sales", number: string): string {
  const trimmed = number.trim();
  if (!trimmed || trimmed.toLowerCase() === "draft") return kind === "purchase" ? "Draft PO" : "Draft SO";
  return trimmed;
}

/** Every awarded line is won. A partial award is won partial. */
export function quoteAwardStatus(coversAll: boolean): "won" | "won_partial" {
  return coversAll ? "won" : "won_partial";
}

/**
 * Saved fields only. An empty line or an empty bid does not count.
 * A value the save would reject stays dirty until it matches the last save.
 */
export function quoteEditSnapshot(input: QuoteSaveInput): unknown {
  const parsed = parseQuoteSave(input);
  if (!parsed.ok) return { invalid: true, input: canonicalize(input) };
  return canonicalize(parsed.value);
}

export function quoteOrderNote(input: { reference: string; id: string }): string {
  const name = input.reference.trim() || "Quote request";
  return `Drafted from quote request ${name} (${QUOTE_REVIEWS_PATH}/${input.id}).`;
}

/** Second click, or a later award, while a non-cancelled order is already linked. */
export function quoteOrderReuseMessage(input: { kind: "purchase" | "sales"; status: string; number: string }): string {
  const noun = input.kind === "purchase" ? "purchase order" : "sales order";
  const label = input.number.trim();
  if (input.status === "draft" || !label || label === "Draft") {
    return `This quote already has a draft ${noun}. Open that draft instead of creating another.`;
  }
  return `This quote already has ${label}. A second ${noun} was not created.`;
}

export type QuoteAwardBuildLine = {
  id: string;
  partNumber: string | null;
  sku: string | null;
  itemName: string | null;
  itemId: string | null;
  condition: string | null;
  unitPrice: number | null;
  awardWinner: string | null;
  awardQty: number | null;
  bids: { bidderName: string; unitPrice: number | null; sku: string | null; itemName: string | null }[];
};

export type BuiltQuoteAwardLine = {
  itemId: string | null;
  partNumber: string;
  sku: string;
  itemName: string;
  condition: "New" | "Used" | "";
  qty: number;
  unitPrice: number;
};

/**
 * Lines marked won, using the DDS response or the named bidder.
 * A bidder SKU that differs from the primary leaves the primary item unmatched
 * on the order line. coversAll is true when every saved line is awarded.
 */
export function buildQuoteAward(
  lines: QuoteAwardBuildLine[],
): { ok: true; lines: BuiltQuoteAwardLine[]; coversAll: boolean } | { ok: false; message: string } {
  const awarded: BuiltQuoteAwardLine[] = [];
  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    const winner = (line.awardWinner ?? "").trim();
    if (!winner) continue;
    const qty = line.awardQty;
    if (qty == null || !(qty > 0)) return { ok: false, message: `Enter the awarded quantity on line ${number}.` };

    let unit = line.unitPrice;
    let sku = (line.sku ?? "").trim();
    let name = (line.itemName ?? "").trim();
    let itemId = line.itemId;
    let part = (line.partNumber ?? "").trim();
    if (winner.toLowerCase() === DDS_AWARD) {
      if (unit == null) return { ok: false, message: `Line ${number} needs a DDS unit price before it can be awarded.` };
    } else {
      const bid = line.bids.find((item) => item.bidderName.trim().toLowerCase() === winner.toLowerCase());
      if (!bid) return { ok: false, message: `Line ${number} awards ${winner}, and that bidder is not on the line.` };
      if (bid.unitPrice == null) {
        return { ok: false, message: `Line ${number} needs a unit price from ${winner} before it can be awarded.` };
      }
      unit = bid.unitPrice;
      const bidSku = (bid.sku ?? "").trim();
      const bidName = (bid.itemName ?? "").trim();
      if (bidSku && bidSku.toLowerCase() !== sku.toLowerCase()) {
        sku = bidSku;
        itemId = null;
        if (!part) part = bidSku;
      } else if (bidSku) {
        sku = bidSku;
      }
      if (bidName) name = bidName;
    }
    if (!itemId && !part && !sku && !name) {
      return { ok: false, message: `Line ${number} needs an item, part, or name before it can be awarded.` };
    }
    awarded.push({
      itemId,
      partNumber: part,
      sku,
      itemName: name,
      condition: canonicalCondition(line.condition ?? ""),
      qty,
      unitPrice: unit,
    });
  }
  if (awarded.length === 0) return { ok: false, message: "Choose the lines that won." };
  if (awarded.length > 100) return { ok: false, message: "An award can have at most 100 lines." };
  return { ok: true, lines: awarded, coversAll: lines.length > 0 && lines.every((line) => Boolean((line.awardWinner ?? "").trim())) };
}

function canonicalCondition(value: string): "New" | "Used" | "" {
  const text = value.trim().toLowerCase();
  if (text === "new") return "New";
  if (text === "used") return "Used";
  return "";
}

export function quoteEventLabel(input: { reference: string; counterparty: string; receivedOn: string }): string {
  const reference = input.reference.trim();
  if (reference) return reference;
  const counterparty = input.counterparty.trim();
  if (counterparty && counterparty !== "—") return counterparty;
  return "Quote";
}

export function quoteLeadTime(value: string): string {
  const trimmed = value.trim();
  return trimmed || QUOTE_LEAD_TIME_DEFAULT;
}

/** Bidder names in first-seen order. The strip under the overview uses this order. */
export function quoteBidders(lines: { bids: { bidderName: string }[] }[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const bid of line.bids) {
      const name = bid.bidderName.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

/** Column heading shared by the overview and the bidder strip. */
export function quoteOfferHeading(label: string): string {
  const trimmed = label.trim() || "Related";
  if (trimmed.length <= 28) return trimmed;
  return `${trimmed.slice(0, 27)}…`;
}

export type QuoteBidderListEntry =
  | { kind: "bid"; name: string }
  | { kind: "related"; id: string; otherId: string; label: string; phrase: string };

/**
 * Numbered strip under the overview: other responses, then each related quote.
 * A related party keeps the same name as its overview column.
 */
export function quoteBidderList(
  lines: { bids: { bidderName: string }[] }[],
  relations: { id: string; otherId: string; otherLabel: string; phrase: string }[] = [],
): QuoteBidderListEntry[] {
  const names = quoteBidders(lines);
  const entries: QuoteBidderListEntry[] = names.map((name) => ({ kind: "bid", name }));
  const used = new Set(names.map((name) => name.toLowerCase()));
  for (const relation of relations) {
    const base = quoteOfferHeading(relation.otherLabel);
    let label = base;
    if (used.has(label.toLowerCase())) label = `${base} · related`;
    let extra = 2;
    while (used.has(label.toLowerCase())) {
      label = `${base} · related ${extra}`;
      extra += 1;
    }
    used.add(label.toLowerCase());
    entries.push({
      kind: "related",
      id: relation.id,
      otherId: relation.otherId,
      label,
      phrase: relation.phrase.trim(),
    });
  }
  return entries;
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

/**
 * Inbound buy suggests an outbound sell (DDS asks someone else about the same parts).
 * Inbound sell suggests an outbound buy forwarded for pricing.
 */
/** Relation label stored on the new quote, spoken from that new quote toward the one open now. */
export function relationForNewFlow(side: QuoteSide, direction: QuoteDirection): QuoteRelationType {
  if (direction === "outbound" && side === "buy") return "forwarded_for_pricing";
  if (direction === "outbound" && side === "sell") return "response_to";
  if (direction === "inbound" && side === "sell") return "response_to";
  return "same_list";
}

export function suggestedRelatedFlow(
  side: QuoteSide,
  direction: QuoteDirection,
): { side: QuoteSide; direction: QuoteDirection; relationType: QuoteRelationType } {
  if (direction === "inbound" && side === "buy") {
    return { side: "sell", direction: "outbound", relationType: "response_to" };
  }
  if (direction === "inbound" && side === "sell") {
    return { side: "buy", direction: "outbound", relationType: "forwarded_for_pricing" };
  }
  if (direction === "outbound" && side === "sell") {
    return { side: "buy", direction: "inbound", relationType: "response_to" };
  }
  return { side: "sell", direction: "inbound", relationType: "response_to" };
}

/** Request identity copied onto a related quote. Prices, lead time, decisions, and bids are not copied. */
export function linesForRelatedEvent(
  lines: (Omit<QuoteLineIdentity, "targetPrice" | "specialRequirements"> & {
    targetPrice?: string;
    specialRequirements?: string;
    unitPrice?: string;
    decision?: string;
    decisionNote?: string;
    leadTime?: string;
    replyQty?: string;
  })[],
): QuoteLineIdentity[] {
  return lines
    .filter(
      (line) =>
        line.itemId ||
        line.partNumber.trim() ||
        line.sku.trim() ||
        line.itemName.trim() ||
        line.qty.trim() ||
        (line.targetPrice ?? "").trim() ||
        (line.specialRequirements ?? "").trim(),
    )
    .map((line) => ({
      itemId: line.itemId,
      partNumber: line.partNumber.trim(),
      sku: line.sku.trim(),
      itemName: line.itemName.trim(),
      condition: line.condition.trim(),
      qty: line.qty.trim(),
      targetPrice: (line.targetPrice ?? "").trim(),
      specialRequirements: (line.specialRequirements ?? "").trim(),
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
  return formatQuoteExt(roundMoney(parsedQty.qty * parsedPrice.amount));
}

/** DDS ext uses the reply quantity when it is filled in, otherwise the request quantity. */
export function quoteReplyExtension(qty: string, replyQty: string, unitPrice: string): string {
  return quoteExtension(replyQty.trim() ? replyQty : qty, unitPrice);
}

function extremeUnit(prices: { unitPrice: string }[], high: boolean): number | null {
  let best: number | null = null;
  for (const price of prices) {
    const parsed = parseMoney(price.unitPrice);
    if (!parsed.ok || parsed.amount == null) continue;
    if (best == null || (high ? parsed.amount > best : parsed.amount < best)) best = parsed.amount;
  }
  return best;
}

/**
 * Lowest local bid unit. The quote list's competing total uses this.
 * It does not include related quotes and it does not follow the line-detail flip.
 */
export function bestCompetingUnit(bids: { unitPrice: string }[]): number | null {
  return extremeUnit(bids, false);
}

/**
 * Line-detail Best flips with direction and side.
 * Lowest: outbound buy, inbound sell.
 * Highest: inbound buy, outbound sell.
 */
export function quoteLineBestIsHigh(side: string, direction: string): boolean {
  const axes = displayAxes(side, direction);
  return (axes.direction === "inbound" && axes.side === "buy") || (axes.direction === "outbound" && axes.side === "sell");
}

/**
 * Best under the DDS unit. The pool is this line's bids and the related quotes
 * loaded with the page. Only the min or max flips. Editing a bid on the page
 * is included. This is not the item ecommerce or market price.
 */
export function bestQuotedUnit(
  line: { partNumber: string; sku: string; bids: { unitPrice: string }[] },
  offers: QuoteOfferColumn[],
  side: string,
  direction: string,
): number | null {
  const prices = line.bids.map((bid) => ({ unitPrice: bid.unitPrice }));
  for (const offer of offers) prices.push({ unitPrice: offerUnit(offer, line.partNumber, line.sku) });
  return extremeUnit(prices, quoteLineBestIsHigh(side, direction));
}

/** Character count for a quote field. The floor keeps an empty box usable. The cap stops a long value from stretching the row. */
export function quoteFieldChars(value: string, floor: number, cap: number, placeholder = ""): number {
  const low = Math.max(1, Math.floor(floor));
  const high = Math.max(low, Math.floor(cap));
  return Math.min(high, Math.max(low, value.length, placeholder.length));
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
    return { ok: false, message: `A quote request can hold ${QUOTE_LINE_LIMIT} lines.` };
  }
  const reference = clip(input.reference, 200);
  if (reference.error) return { ok: false, message: "The list name is too long." };
  const counterpartyName = clip(input.counterpartyName, 200);
  if (counterpartyName.error) return { ok: false, message: "The contact name is too long." };
  const notes = clip(input.notes, 4000);
  if (notes.error) return { ok: false, message: "Notes are too long." };
  if (!isQuoteChannel(input.channel)) return { ok: false, message: "Choose a channel." };
  if (!isQuoteDirection(input.direction)) return { ok: false, message: "Choose inbound or outbound." };
  if (!isQuoteSide(input.side)) return { ok: false, message: "Choose buy or sell." };
  if (!isQuoteStatus(input.status)) return { ok: false, message: "Choose a status." };
  const received = parseDate(input.receivedOn, true);
  if (!received.ok || !received.value) return { ok: false, message: "Enter the received date." };
  const due = parseDate(input.dueOn, false);
  if (!due.ok) return due;
  const vendorId = optionalUuid(input.vendorId, "That vendor was not found.");
  if (!vendorId.ok) return vendorId;
  const customerId = optionalUuid(input.customerId, "That customer was not found.");
  if (!customerId.ok) return customerId;
  const prospectId = optionalUuid(input.prospectId, "That prospect was not found.");
  if (!prospectId.ok) return prospectId;
  if (!isQuoteOriginatorKind(input.originatorKind)) return { ok: false, message: "Choose who started this quote." };
  const partyError = originatorPartyError({
    side: input.side,
    direction: input.direction,
    originatorKind: input.originatorKind,
    vendorId: vendorId.value,
    customerId: customerId.value,
    prospectId: prospectId.value,
  });
  if (partyError) return { ok: false, message: partyError };
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
      customerId: customerId.value,
      prospectId: prospectId.value,
      originatorKind: input.originatorKind,
      channel: input.channel,
      direction: input.direction,
      side: input.side,
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
  customerId: string;
  prospectId: string;
  originatorKind: string;
  channel: string;
  direction: string;
  side: string;
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
  customerId: string | null;
  prospectId: string | null;
  originatorKind: QuoteOriginatorKind;
  channel: QuoteChannel;
  direction: QuoteDirection;
  side: QuoteSide;
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
    customerId: input.customerId,
    prospectId: input.prospectId,
    originatorKind: input.originatorKind,
    channel: input.channel,
    direction: input.direction,
    side: input.side,
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
      customerId: header.value.customerId,
      prospectId: header.value.prospectId,
      originatorKind: header.value.originatorKind,
      channel: header.value.channel,
      direction: header.value.direction,
      side: header.value.side,
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
  if (!/quote_event|quote_prospect/i.test(message)) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "PGRST204" ||
    error.code === "42P01" ||
    error.code === "42703" ||
    /schema cache|does not exist|could not find/i.test(message)
  );
}

function originatorPartyError(input: {
  side: QuoteSide;
  direction: QuoteDirection;
  originatorKind: QuoteOriginatorKind;
  vendorId: string | null;
  customerId: string | null;
  prospectId: string | null;
}): string | null {
  if (input.direction === "inbound" && input.side === "sell") {
    if (input.originatorKind === "customer" && input.customerId && !input.vendorId && !input.prospectId) return null;
    if (input.originatorKind === "prospect" && input.prospectId && !input.vendorId && !input.customerId) return null;
    return "Inbound Sell Request starts with a customer or a prospect.";
  }
  if (input.direction === "inbound" && input.side === "buy") {
    if (input.originatorKind === "vendor" && input.vendorId && !input.customerId && !input.prospectId) return null;
    return "Inbound Buy Request starts with a vendor.";
  }
  if (input.direction === "outbound" && input.originatorKind === "dds") {
    if (input.side === "sell" && input.vendorId) return "Outbound Sell Request uses a customer or a prospect.";
    if (input.side === "sell" && input.customerId && input.prospectId) return "Pick a customer or a prospect.";
    if (input.side === "buy" && (input.customerId || input.prospectId)) return "Outbound Buy Offer uses a vendor.";
    return null;
  }
  return "That originator does not match this quote.";
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
  const requirements = clip(line.specialRequirements, 500);
  if (requirements.error) return { ok: false, message: `The special requirements on line ${number} are too long.` };
  const decisionNote = clip(line.decisionNote, 500);
  if (decisionNote.error) return { ok: false, message: `The note on line ${number} is too long.` };
  const leadTime = clip(line.leadTime, 120);
  if (leadTime.error) return { ok: false, message: `The lead time on line ${number} is too long.` };
  const qty = parseQuoteQty(line.qty);
  if (!qty.ok) return { ok: false, message: `Line ${number}: ${qty.message}` };
  const replyQty = parseQuoteQty(line.replyQty);
  if (!replyQty.ok) return { ok: false, message: `Line ${number} reply: ${replyQty.message}` };
  const unitPrice = parseMoney(line.unitPrice);
  if (!unitPrice.ok) return { ok: false, message: `Line ${number}: ${unitPrice.message}` };
  const targetPrice = parseMoney(line.targetPrice);
  if (!targetPrice.ok) return { ok: false, message: `Line ${number} target: ${targetPrice.message}` };
  const decision = line.decision.trim();
  if (decision && !QUOTE_DECISIONS.some((item) => item.id === decision)) {
    return { ok: false, message: `Choose a decision on line ${number}.` };
  }

  if ((line.alts ?? []).length > QUOTE_ALT_LIMIT) {
    return { ok: false, message: `Line ${number} can hold ${QUOTE_ALT_LIMIT} alternative SKUs.` };
  }
  const bids: ParsedQuoteBid[] = [];
  for (const bid of line.bids) {
    const parsedBid = parseBid(bid, number);
    if (!parsedBid.ok) return parsedBid;
    if (parsedBid.bid) bids.push(parsedBid.bid);
  }
  const alts: ParsedQuoteAlt[] = [];
  for (const alt of line.alts ?? []) {
    const parsedAlt = parseAlt(alt, number);
    if (!parsedAlt.ok) return parsedAlt;
    if (parsedAlt.alt) alts.push(parsedAlt.alt);
  }
  const award = parseAward(line, number, bids);
  if (!award.ok) return award;

  const hasContent = Boolean(
    itemId.value ||
      partNumber.value ||
      sku.value ||
      itemName.value ||
      condition.value ||
      requirements.value ||
      qty.qty != null ||
      replyQty.qty != null ||
      unitPrice.amount != null ||
      targetPrice.amount != null ||
      leadTime.value ||
      decision ||
      decisionNote.value ||
      bids.length > 0 ||
      alts.length > 0 ||
      award.winner,
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
      targetPrice: targetPrice.amount,
      specialRequirements: requirements.value,
      replyQty: replyQty.qty,
      unitPrice: unitPrice.amount,
      leadTime: leadTime.value,
      decision: decision ? (decision as QuoteDecision) : null,
      decisionNote: decisionNote.value,
      awardWinner: award.winner,
      awardQty: award.qty,
      bids,
      alts,
    },
  };
}

function parseAward(
  line: QuoteLineInput,
  lineNumber: number,
  bids: ParsedQuoteBid[],
): { ok: true; winner: string | null; qty: number | null } | { ok: false; message: string } {
  const winnerText = (line.awardWinner ?? "").trim();
  const qty = parseQuoteQty(line.awardQty ?? "");
  if (!qty.ok) return { ok: false, message: `Line ${lineNumber} award: ${qty.message}` };
  if (!winnerText && qty.qty == null) return { ok: true, winner: null, qty: null };
  if (!winnerText) return { ok: false, message: `Choose who won line ${lineNumber}.` };
  if (qty.qty == null || !(qty.qty > 0)) return { ok: false, message: `Enter the awarded quantity on line ${lineNumber}.` };
  if (winnerText.toLowerCase() === DDS_AWARD) return { ok: true, winner: DDS_AWARD, qty: qty.qty };
  const bid = bids.find((item) => item.bidderName.toLowerCase() === winnerText.toLowerCase());
  if (!bid) return { ok: false, message: `Line ${lineNumber} awards ${winnerText}, and that bidder is not on the line.` };
  return { ok: true, winner: bid.bidderName, qty: qty.qty };
}

function parseAlt(
  alt: QuoteAltInput,
  lineNumber: number,
): { ok: true; alt: ParsedQuoteAlt | null } | { ok: false; message: string } {
  const itemId = optionalUuid(alt.itemId, `An alternative on line ${lineNumber} is linked to an item that was not found.`);
  if (!itemId.ok) return itemId;
  const id = optionalUuid(alt.id, `An alternative on line ${lineNumber} was not found.`);
  if (!id.ok) return id;
  const partNumber = clip(alt.partNumber, 120);
  if (partNumber.error) return { ok: false, message: `An alternative part on line ${lineNumber} is too long.` };
  const sku = clip(alt.sku, 80);
  if (sku.error) return { ok: false, message: `An alternative SKU on line ${lineNumber} is too long.` };
  const itemName = clip(alt.itemName, 300);
  if (itemName.error) return { ok: false, message: `An alternative name on line ${lineNumber} is too long.` };
  const unitPrice = parseMoney(alt.unitPrice);
  if (!unitPrice.ok) return { ok: false, message: `Line ${lineNumber} alternative: ${unitPrice.message}` };
  if (!itemId.value && !partNumber.value && !sku.value && !itemName.value) return { ok: true, alt: null };
  return {
    ok: true,
    alt: {
      key: alt.key || sku.value || partNumber.value || itemName.value || "alt",
      id: id.value,
      itemId: itemId.value,
      partNumber: partNumber.value,
      sku: sku.value,
      itemName: itemName.value,
      unitPrice: unitPrice.amount,
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
  const sku = clip(bid.sku, 80);
  if (sku.error) return { ok: false, message: `A bidder SKU on line ${lineNumber} is too long.` };
  const itemName = clip(bid.itemName, 300);
  if (itemName.error) return { ok: false, message: `A bidder item name on line ${lineNumber} is too long.` };
  const leadTime = clip(bid.leadTime, 120);
  if (leadTime.error) return { ok: false, message: `A bidder lead time on line ${lineNumber} is too long.` };
  const unitPrice = parseMoney(bid.unitPrice);
  if (!unitPrice.ok) return { ok: false, message: `Line ${lineNumber}: ${unitPrice.message}` };
  const qty = parseQuoteQty(bid.qty);
  if (!qty.ok) return { ok: false, message: `Line ${lineNumber}: ${qty.message}` };
  const empty =
    !name.value &&
    unitPrice.amount == null &&
    !note.value &&
    !sku.value &&
    !itemName.value &&
    qty.qty == null &&
    !leadTime.value;
  if (empty) return { ok: true, bid: null };
  if (!name.value) return { ok: false, message: `Name the competing bidder on line ${lineNumber}.` };
  const id = optionalUuid(bid.id, `A competing bid on line ${lineNumber} was not found.`);
  if (!id.ok) return id;
  return {
    ok: true,
    bid: {
      key: bid.key || name.value,
      id: id.value,
      bidderName: name.value,
      unitPrice: unitPrice.amount,
      note: note.value,
      sku: sku.value,
      itemName: itemName.value,
      qty: qty.qty,
      leadTime: leadTime.value,
    },
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
