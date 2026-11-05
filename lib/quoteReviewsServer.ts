"use server";

import { CAPABILITY_DENIED } from "@/lib/capabilities";
import { EBAY_ORDER_CUSTOMER_NAME } from "@/lib/ebay/orderMap";
import { isEbaySourcedCustomer, quoteCustomerEbayOrFilter } from "@/lib/ebayCustomers";
import { errorText } from "@/lib/errors";
import { formatDataDate } from "@/lib/formatDate";
import { itemIdsMatchingAlnum } from "@/lib/itemAlnumSearch";
import { normalizePartNumber } from "@/lib/itemAttributeSearch";
import { extensionFromUnit, formatExtension, formatUnitPrice } from "@/lib/poLineMoney";
import { asMoney, formatMoney, moneyInput } from "@/lib/pricing/quotes";
import { purchaseOrderNumberLabel } from "@/lib/purchaseOrderDraft";
import { savePurchaseOrder } from "@/lib/purchaseOrders";
import { quoteReviewPageAccess } from "@/lib/quoteReviewSession";
import { emptyAddress, formatSalesOrderNumber, type SoDraftInput } from "@/lib/salesOrderDraft";
import { saveSalesOrder } from "@/lib/salesOrders";
import {
  DUE_SOON_DAYS,
  addCalendarDays,
  bestCompetingUnit,
  buildQuoteAward,
  isQuoteDirection,
  isQuoteDueSoon,
  isQuoteSide,
  isQuoteStatus,
  linesForRelatedEvent,
  originatorDisplay,
  quoteAwardStatus,
  quoteOrderKind,
  quoteOrderLinkLabel,
  quoteOrderNote,
  quoteOrderReuseMessage,
  QUOTE_LIST_PARTY_LIMIT,
  QUOTE_PARTY_LIMIT,
  QUOTE_WON_PARTIAL_MIGRATION,
  quotePartyNamePattern,
  isQuoteRelationType,
  parseQuoteQty,
  parseQuoteSave,
  parseRelatedQuote,
  quoteCalendarDay,
  quoteEventLabel,
  quoteFlowLabel,
  quoteLineMatchKey,
  quoteOfferHeading,
  quoteQtyText,
  QUOTE_REVIEWS_SETUP,
  quoteReviewsUnavailable,
  relationPhrase,
  summarizeQuoteLines,
  type BuiltQuoteAwardLine,
  type ParsedQuoteLine,
  type QuoteChoice,
  type QuoteItemHit,
  type QuoteLineDraft,
  type QuoteListRow,
  type QuoteOfferColumn,
  type QuoteOrderLink,
  type QuotePartyOption,
  type QuoteRelatedInput,
  type QuoteRelationView,
  type QuoteReviewDraft,
  type QuoteSaveInput,
} from "@/lib/quoteReviews";
import { getSupabase } from "@/lib/supabase";

const EDIT_DENIED = CAPABILITY_DENIED.can_edit_financials;
const VIEW_DENIED = CAPABILITY_DENIED.can_view_financials;
const LIST_LIMIT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QuoteListResult = {
  unavailable: boolean;
  truncated: boolean;
  rows: QuoteListRow[];
};

export type QuoteDetailResult =
  | { status: "ok"; draft: QuoteReviewDraft; relations: QuoteRelationView[]; offers: QuoteOfferColumn[]; order: QuoteOrderLink | null }
  | { status: "missing" }
  | { status: "unavailable" };

export type QuoteSavedLine = {
  key: string;
  id: string;
  bids: { key: string; id: string }[];
  alts: { key: string; id: string }[];
};

/** Validation failures come back as ok: false. Throwing them opens Next's error page and drops the form. */
export type QuoteSaveResult = { ok: true; id: string; warnings: string[]; lines: QuoteSavedLine[] } | { ok: false; message: string };

export type RelatedQuoteResult = { ok: true; id: string; copiedLines: number } | { ok: false; message: string };

export type QuoteOrderDraftResult = QuoteOrderLink & {
  created: boolean;
  message: string;
  quoteStatus: string;
};

type Row = Record<string, unknown>;

export async function listQuoteVendors(options?: { keepIds?: string[] }): Promise<QuotePartyOption[]> {
  const access = await quoteReviewPageAccess();
  if (!access.canView) return [];
  const keep = (options?.keepIds ?? []).filter((id) => UUID.test(id));
  if (keep.length === 0) return [];
  const { data, error } = await (await getSupabase()).from("vendors").select("id, display_name").in("id", keep);
  if (error) throw new Error(errorText(error));
  return (data ?? []).map((row) => ({ id: String(row.id), name: String(row.display_name ?? "") }));
}

/** Names containing the typed text. Does not load the vendor table. */
export async function searchQuoteVendors(query: string): Promise<QuotePartyOption[]> {
  const access = await quoteReviewPageAccess();
  if (!access.canView) return [];
  const pattern = quotePartyNamePattern(query);
  if (!pattern) return [];
  const { data, error } = await (await getSupabase())
    .from("vendors")
    .select("id, display_name")
    .eq("active", true)
    .ilike("display_name", pattern)
    .order("display_name")
    .limit(QUOTE_PARTY_LIMIT);
  if (error) throw new Error(errorText(error));
  return (data ?? []).map((row) => ({ id: String(row.id), name: String(row.display_name ?? "") }));
}

/** The customers already on this quote. Not the customer directory. */
export async function listQuoteCustomers(options?: { keepIds?: string[] }): Promise<QuotePartyOption[]> {
  const access = await quoteReviewPageAccess();
  if (!access.canView) return [];
  const keep = (options?.keepIds ?? []).filter((id) => UUID.test(id));
  if (keep.length === 0) return [];
  const { data, error } = await (await getSupabase()).from("customers").select("id, display_name, primary_email").in("id", keep);
  if (error) throw new Error(errorText(error));
  return (data ?? []).map((row) => ({ id: String(row.id), name: String(row.display_name ?? "") }));
}

/**
 * Customers whose name contains the typed text.
 * eBay buyer cards stay out of the menu, in SQL, so the short list is not filled with them.
 */
export async function searchQuoteCustomers(query: string): Promise<QuotePartyOption[]> {
  const access = await quoteReviewPageAccess();
  if (!access.canView) return [];
  const pattern = quotePartyNamePattern(query);
  if (!pattern) return [];
  const { data, error } = await (await getSupabase())
    .from("customers")
    .select("id, display_name, primary_email")
    .eq("active", true)
    .ilike("display_name", pattern)
    .not("display_name", "ilike", EBAY_ORDER_CUSTOMER_NAME)
    .or(quoteCustomerEbayOrFilter())
    .order("display_name")
    .limit(QUOTE_PARTY_LIMIT);
  if (error) throw new Error(errorText(error));
  return (data ?? []).flatMap((row) => {
    const name = String(row.display_name ?? "");
    const email = row.primary_email == null ? null : String(row.primary_email);
    if (isEbaySourcedCustomer({ displayName: name, primaryEmail: email })) return [];
    return [{ id: String(row.id), name }];
  });
}

export async function listQuoteProspects(): Promise<QuotePartyOption[]> {
  const access = await quoteReviewPageAccess();
  if (!access.canView) return [];
  const { data, error } = await (await getSupabase()).from("quote_prospects").select("id, display_name").order("display_name");
  if (error) {
    if (quoteReviewsUnavailable(error)) return [];
    throw new Error(errorText(error));
  }
  return (data ?? []).map((row) => ({ id: String(row.id), name: String(row.display_name ?? "") }));
}

export async function createQuoteProspect(input: { displayName: string; contactName: string }): Promise<QuotePartyOption> {
  const access = await quoteReviewPageAccess();
  if (!access.canEdit) throw new Error(EDIT_DENIED);
  const displayName = input.displayName.trim();
  const contactName = input.contactName.trim();
  if (!displayName) throw new Error("Enter the prospect company.");
  if (displayName.length > 200) throw new Error("The prospect company name is too long.");
  if (contactName.length > 200) throw new Error("The prospect contact is too long.");
  const created = await (await getSupabase())
    .from("quote_prospects")
    .insert({ display_name: displayName, contact_name: contactName || null })
    .select("id, display_name")
    .single();
  if (created.error || !created.data) throw dbError(created.error);
  return { id: String(created.data.id), name: String(created.data.display_name ?? displayName) };
}

export async function listQuoteReviews(filter: {
  q?: string;
  status?: string;
  due?: string;
  side?: string;
  direction?: string;
}): Promise<QuoteListResult> {
  const access = await quoteReviewPageAccess();
  if (!access.canView) throw new Error(VIEW_DENIED);
  const supabase = await getSupabase();
  const today = quoteCalendarDay();
  const status = filter.status && isQuoteStatus(filter.status) ? filter.status : "";
  const side = filter.side && isQuoteSide(filter.side) ? filter.side : "";
  const direction = filter.direction && isQuoteDirection(filter.direction) ? filter.direction : "";
  const dueSoon = filter.due === "soon";
  let request = supabase
    .from("quote_events")
    .select(
      "id, received_on, due_on, vendor_id, customer_id, prospect_id, counterparty_name, channel, direction, side, originator_kind, status, reference, currency, vendors(display_name), customers(display_name), quote_prospects(display_name)",
    );
  if (status) request = request.eq("status", status);
  if (side) request = request.eq("side", side);
  if (direction) request = request.eq("direction", direction);
  if (dueSoon) {
    request = request
      .not("due_on", "is", null)
      .lte("due_on", addCalendarDays(today, DUE_SOON_DAYS))
      .in("status", ["open", "reviewing", "bid_sent"]);
  }
  const needle = searchNeedle(filter.q ?? "");
  if (needle) {
    const [vendorIds, customerIds, prospectIds] = await Promise.all([
      partyIdsByName("vendors", needle),
      partyIdsByName("customers", needle),
      partyIdsByName("quote_prospects", needle),
    ]);
    const pattern = `%${needle.replaceAll('"', "")}%`;
    const parts = [`reference.ilike."${pattern}"`, `counterparty_name.ilike."${pattern}"`];
    if (vendorIds.length > 0) parts.push(`vendor_id.in.(${vendorIds.join(",")})`);
    if (customerIds.length > 0) parts.push(`customer_id.in.(${customerIds.join(",")})`);
    if (prospectIds.length > 0) parts.push(`prospect_id.in.(${prospectIds.join(",")})`);
    request = request.or(parts.join(","));
  }
  const listed = await request.order("received_on", { ascending: false }).order("created_at", { ascending: false }).limit(LIST_LIMIT);
  if (listed.error) {
    if (quoteReviewsUnavailable(listed.error)) return { unavailable: true, truncated: false, rows: [] };
    throw new Error(errorText(listed.error));
  }
  const events = (listed.data ?? []) as Row[];
  const ids = events.map((row) => String(row.id));
  const [lineMap, relatedMap] = await Promise.all([lineSummaries(ids), relatedByEvent(events, ids)]);
  return {
    unavailable: false,
    truncated: events.length >= LIST_LIMIT,
    rows: events.map((row) => {
      const id = String(row.id);
      const party = partyOf(row);
      const dueOn = text(row.due_on) || null;
      const statusValue = text(row.status);
      const totals = lineMap.get(id) ?? summarizeQuoteLines([]);
      return {
        id,
        reference: text(row.reference),
        label: quoteEventLabel({ reference: text(row.reference), counterparty: party.originator, receivedOn: text(row.received_on) }),
        receivedOn: text(row.received_on),
        dueOn,
        dueSoon: isQuoteDueSoon({ dueOn, status: statusValue, today }),
        vendorId: party.vendorId,
        customerId: party.customerId,
        prospectId: party.prospectId,
        originatorKind: party.kind,
        company: party.company,
        contact: party.contact,
        originator: party.originator,
        channel: text(row.channel),
        direction: text(row.direction),
        side: text(row.side),
        status: statusValue,
        lineCount: totals.lineCount,
        qty: totals.qty,
        offerExt: totals.offerExt,
        competingExt: totals.competingExt,
        currency: text(row.currency) || "USD",
        related: relatedMap.get(id) ?? [],
      };
    }),
  };
}

export async function loadQuoteReview(id: string): Promise<QuoteDetailResult> {
  const access = await quoteReviewPageAccess();
  if (!access.canView) throw new Error(VIEW_DENIED);
  if (!UUID.test(id)) return { status: "missing" };
  const supabase = await getSupabase();
  const event = await supabase
    .from("quote_events")
    .select(
      "id, received_on, due_on, vendor_id, customer_id, prospect_id, counterparty_name, channel, direction, side, originator_kind, status, reference, notes, currency, dds_column_code, dds_bid_note, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (event.error) {
    if (quoteReviewsUnavailable(event.error)) return { status: "unavailable" };
    throw new Error(errorText(event.error));
  }
  if (!event.data) return { status: "missing" };
  const lines = await supabase
    .from("quote_event_lines")
    .select(
      "id, sort_order, item_id, part_number, sku, item_name, condition, qty, target_price, special_requirements, reply_qty, our_unit_price, lead_time, decision, decision_note, award_winner, award_qty, quote_event_bids(id, sort_order, bidder_name, unit_price, note, sku, item_name, qty, lead_time), quote_event_line_alts(id, sort_order, item_id, part_number, sku, item_name, unit_price)",
    )
    .eq("quote_event_id", id)
    .order("sort_order");
  if (lines.error) {
    if (quoteReviewsUnavailable(lines.error)) return { status: "unavailable" };
    throw new Error(errorText(lines.error));
  }
  const lineRows = ((lines.data ?? []) as Row[]).slice().sort((a, b) => numberOf(a.sort_order) - numberOf(b.sort_order));
  const bidderRows = await supabase
    .from("quote_event_bidders")
    .select("bidder_name, column_code, bid_note, bidder_class, sort_order")
    .eq("quote_event_id", id)
    .order("sort_order");
  if (bidderRows.error) {
    if (quoteReviewsUnavailable(bidderRows.error)) return { status: "unavailable" };
    throw new Error(errorText(bidderRows.error));
  }
  const context = await itemContext(lineRows.map((row) => text(row.item_id)).filter(Boolean));
  const header = event.data as Row;
  const relations = await relationsFor(id);
  const profiles = new Map(
    ((bidderRows.data ?? []) as Row[]).map((row) => [text(row.bidder_name).trim().toLowerCase(), row]),
  );
  return {
    status: "ok",
    draft: {
      id,
      reference: text(header.reference),
      counterpartyName: text(header.counterparty_name),
      vendorId: text(header.vendor_id),
      customerId: text(header.customer_id),
      prospectId: text(header.prospect_id),
      originatorKind: text(header.originator_kind),
      channel: text(header.channel),
      direction: text(header.direction),
      side: text(header.side),
      status: text(header.status),
      receivedOn: text(header.received_on),
      dueOn: text(header.due_on),
      currency: text(header.currency) || "USD",
      notes: text(header.notes),
      ddsColumnCode: text(header.dds_column_code),
      ddsBidNote: text(header.dds_bid_note),
      lines: lineRows.map((row) => lineDraft(row, context, profiles)),
    },
    relations,
    offers: await relatedOfferColumns(relations),
    order: await linkedQuoteOrder(id, text(header.side)),
  };
}

async function relatedOfferColumns(relations: QuoteRelationView[]): Promise<QuoteOfferColumn[]> {
  if (relations.length === 0) return [];
  const ids = relations.map((relation) => relation.otherId).filter((id) => UUID.test(id));
  if (ids.length === 0) return [];
  const supabase = await getSupabase();
  const listed = await supabase
    .from("quote_event_lines")
    .select("quote_event_id, sort_order, part_number, sku, our_unit_price, quote_event_bids(sort_order, bidder_name, unit_price)")
    .in("quote_event_id", ids);
  if (listed.error) throw dbError(listed.error);
  const eventCodes = await supabase.from("quote_events").select("id, dds_column_code").in("id", ids);
  if (eventCodes.error) throw dbError(eventCodes.error);
  const bidderCodes = await supabase.from("quote_event_bidders").select("quote_event_id, bidder_name, column_code").in("quote_event_id", ids);
  if (bidderCodes.error) throw dbError(bidderCodes.error);
  const ddsCodeByEvent = new Map(((eventCodes.data ?? []) as Row[]).map((row) => [text(row.id), text(row.dds_column_code)]));
  const bidderCodeByEvent = new Map<string, Map<string, string>>();
  for (const row of (bidderCodes.data ?? []) as Row[]) {
    const eventId = text(row.quote_event_id);
    const names = bidderCodeByEvent.get(eventId) ?? new Map<string, string>();
    names.set(text(row.bidder_name).trim().toLowerCase(), text(row.column_code));
    bidderCodeByEvent.set(eventId, names);
  }
  const byEvent = new Map<string, Row[]>();
  for (const row of (listed.data ?? []) as Row[]) {
    const eventId = text(row.quote_event_id);
    const list = byEvent.get(eventId) ?? [];
    list.push(row);
    byEvent.set(eventId, list);
  }
  const columns: QuoteOfferColumn[] = [];
  for (const relation of relations) {
    const rows = (byEvent.get(relation.otherId) ?? []).slice().sort((a, b) => numberOf(a.sort_order) - numberOf(b.sort_order));
    const ddsPrices = rows.flatMap((row) => {
      const unit = moneyInput(asMoney(row.our_unit_price));
      const matchKey = quoteLineMatchKey(text(row.part_number), text(row.sku));
      if (!unit || !matchKey) return [];
      return [{ matchKey, unitPrice: unit }];
    });
    if (ddsPrices.length > 0) {
      columns.push({
        id: `dds:${relation.otherId}`,
        label: quoteOfferHeading(relation.otherLabel),
        title: relation.otherLabel,
        columnCode: ddsCodeByEvent.get(relation.otherId) ?? "",
        prices: ddsPrices,
      });
    }
    const bidderNames: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      for (const bid of rowsOf(row.quote_event_bids).slice().sort((a, b) => numberOf(a.sort_order) - numberOf(b.sort_order))) {
        const name = text(bid.bidder_name).trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        bidderNames.push(name);
      }
    }
    for (const name of bidderNames) {
      const prices = rows.flatMap((row) => {
        const bid = rowsOf(row.quote_event_bids).find((item) => text(item.bidder_name).trim().toLowerCase() === name.toLowerCase());
        const unit = bid ? moneyInput(asMoney(bid.unit_price)) : "";
        const matchKey = quoteLineMatchKey(text(row.part_number), text(row.sku));
        if (!unit || !matchKey) return [];
        return [{ matchKey, unitPrice: unit }];
      });
      if (prices.length === 0) continue;
      columns.push({
        id: `bid:${relation.otherId}:${name.toLowerCase()}`,
        label: name,
        title: name,
        columnCode: bidderCodeByEvent.get(relation.otherId)?.get(name.toLowerCase()) ?? "",
        prices,
      });
    }
  }
  return columns;
}

export async function listQuoteReviewChoices(exceptId: string): Promise<QuoteChoice[]> {
  const access = await quoteReviewPageAccess();
  if (!access.canView) return [];
  const supabase = await getSupabase();
  let request = supabase
    .from("quote_events")
    .select(
      "id, reference, counterparty_name, direction, side, originator_kind, received_on, vendors(display_name), customers(display_name), quote_prospects(display_name)",
    )
    .order("received_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (UUID.test(exceptId)) request = request.neq("id", exceptId);
  const { data, error } = await request;
  if (error) {
    if (quoteReviewsUnavailable(error)) return [];
    throw new Error(errorText(error));
  }
  return ((data ?? []) as Row[]).map((row) => {
    const party = partyOf(row);
    const label = quoteEventLabel({ reference: text(row.reference), counterparty: party.originator, receivedOn: text(row.received_on) });
    return {
      id: String(row.id),
      label: `${label} · ${quoteFlowLabel(text(row.side), text(row.direction))} · ${formatDataDate(text(row.received_on))}`,
    };
  });
}

export async function saveQuoteReview(id: string | null, input: QuoteSaveInput): Promise<QuoteSaveResult> {
  const access = await quoteReviewPageAccess();
  if (!access.canEdit) return { ok: false, message: EDIT_DENIED };
  const parsed = parseQuoteSave(input);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (id && !UUID.test(id)) return { ok: false, message: "That quote was not found." };
  const supabase = await getSupabase();
  const header = {
    reference: parsed.value.reference,
    counterparty_name: parsed.value.counterpartyName,
    vendor_id: parsed.value.vendorId,
    customer_id: parsed.value.customerId,
    prospect_id: parsed.value.prospectId,
    originator_kind: parsed.value.originatorKind,
    channel: parsed.value.channel,
    direction: parsed.value.direction,
    side: parsed.value.side,
    status: parsed.value.status,
    received_on: parsed.value.receivedOn,
    due_on: parsed.value.dueOn,
    currency: parsed.value.currency,
    notes: parsed.value.notes,
    dds_column_code: parsed.value.ddsColumnCode,
    dds_bid_note: parsed.value.ddsBidNote,
  };
  let eventId = id;
  if (!eventId) {
    const created = await supabase.from("quote_events").insert(header).select("id").single();
    if (created.error || !created.data) throw dbError(created.error);
    eventId = String(created.data.id);
  } else {
    const updated = await supabase.from("quote_events").update(header).eq("id", eventId).select("id").maybeSingle();
    if (updated.error) throw dbError(updated.error);
    if (!updated.data) throw new Error("That quote was not found.");
  }
  try {
    const lines = await saveLines(eventId, parsed.value.lines);
    await saveBidders(eventId, parsed.value.bidders);
    return { ok: true, id: eventId, warnings: parsed.warnings, lines };
  } catch (error) {
    if (!id) await supabase.from("quote_events").delete().eq("id", eventId);
    throw error;
  }
}

export async function searchQuoteItems(query: string): Promise<QuoteItemHit[]> {
  const access = await quoteReviewPageAccess();
  if (!access.canEdit) throw new Error(EDIT_DENIED);
  const needle = searchNeedle(query);
  if (needle.length < 1) return [];
  const supabase = await getSupabase();
  const pattern = `%${needle}%`;
  const listed = await supabase
    .from("items")
    .select("id, sku, name, part_number, oem_part_number, condition, quantity")
    .or(`sku.ilike.${pattern},name.ilike.${pattern},part_number.ilike.${pattern},oem_part_number.ilike.${pattern}`)
    .order("sku")
    .limit(8);
  if (listed.error) throw new Error(errorText(listed.error));
  const rows = new Map<string, Row>();
  for (const row of (listed.data ?? []) as Row[]) rows.set(String(row.id), row);
  const extraIds = (await itemIdsMatchingAlnum(supabase, needle, {
    columns: ["sku", "name", "part_number", "oem_part_number"],
    limit: 8,
  })).filter((itemId) => !rows.has(itemId));
  if (extraIds.length > 0) {
    const extra = await supabase
      .from("items")
      .select("id, sku, name, part_number, oem_part_number, condition, quantity")
      .in("id", extraIds);
    if (extra.error) throw new Error(errorText(extra.error));
    for (const row of (extra.data ?? []) as Row[]) rows.set(String(row.id), row);
  }
  const hits = [...rows.values()].map((row) => hitFromRow(row));
  const context = await itemContext([...rows.keys()]);
  const norm = normalizePartNumber(needle);
  return hits
    .map((hit) => {
      const side = context.get(hit.id);
      return { ...hit, onHand: side?.onHand ?? hit.onHand, lastBuy: side?.lastBuy ?? "", lastSell: side?.lastSell ?? "" };
    })
    .sort((a, b) => rankHit(a, needle, norm) - rankHit(b, needle, norm))
    .slice(0, 8);
}

export async function createRelatedQuoteReview(input: QuoteRelatedInput): Promise<RelatedQuoteResult> {
  const access = await quoteReviewPageAccess();
  if (!access.canEdit) return { ok: false, message: EDIT_DENIED };
  const parsed = parseRelatedQuote(input);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const supabase = await getSupabase();
  const source = await supabase.from("quote_events").select("id, currency").eq("id", parsed.value.sourceId).maybeSingle();
  if (source.error) throw dbError(source.error);
  if (!source.data) throw new Error("That quote was not found.");
  const sourceLines = await supabase
    .from("quote_event_lines")
    .select("item_id, part_number, sku, item_name, condition, qty, target_price, special_requirements, sort_order")
    .eq("quote_event_id", parsed.value.sourceId)
    .order("sort_order");
  if (sourceLines.error) throw dbError(sourceLines.error);
  const copied = linesForRelatedEvent(
    ((sourceLines.data ?? []) as Row[])
      .slice()
      .sort((a, b) => numberOf(a.sort_order) - numberOf(b.sort_order))
      .map((row) => ({
        itemId: text(row.item_id) || null,
        partNumber: text(row.part_number),
        sku: text(row.sku),
        itemName: text(row.item_name),
        condition: text(row.condition),
        qty: quoteQtyText(row.qty),
        targetPrice: moneyInput(asMoney(row.target_price)),
        specialRequirements: text(row.special_requirements),
      })),
  );
  const currency = text((source.data as Row).currency);
  const created = await supabase
    .from("quote_events")
    .insert({
      reference: parsed.value.reference,
      counterparty_name: parsed.value.counterpartyName,
      vendor_id: parsed.value.vendorId,
      customer_id: parsed.value.customerId,
      prospect_id: parsed.value.prospectId,
      originator_kind: parsed.value.originatorKind,
      channel: parsed.value.channel,
      direction: parsed.value.direction,
      side: parsed.value.side,
      status: "open",
      received_on: parsed.value.receivedOn,
      due_on: parsed.value.dueOn,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
      notes: null,
    })
    .select("id")
    .single();
  if (created.error || !created.data) throw dbError(created.error);
  const eventId = String(created.data.id);
  try {
    if (copied.length > 0) {
      const inserted = await supabase.from("quote_event_lines").insert(
        copied.map((line, index) => ({
          quote_event_id: eventId,
          sort_order: index,
          item_id: line.itemId,
          part_number: line.partNumber || null,
          sku: line.sku || null,
          item_name: line.itemName || null,
          condition: line.condition || null,
          qty: storedQty(line.qty),
          target_price: storedMoney(line.targetPrice),
          special_requirements: line.specialRequirements || null,
        })),
      );
      if (inserted.error) throw dbError(inserted.error);
    }
    const linked = await supabase.from("quote_event_relations").insert({
      from_event_id: eventId,
      to_event_id: parsed.value.sourceId,
      relation_type: parsed.value.relationType,
      note: parsed.value.relationNote,
    });
    if (linked.error) throw dbError(linked.error);
    return { ok: true, id: eventId, copiedLines: copied.length };
  } catch (error) {
    await supabase.from("quote_events").delete().eq("id", eventId);
    throw error;
  }
}

export async function linkQuoteReviews(eventId: string, otherId: string, relationType: string, note: string): Promise<void> {
  const access = await quoteReviewPageAccess();
  if (!access.canEdit) throw new Error(EDIT_DENIED);
  if (!UUID.test(eventId) || !UUID.test(otherId)) throw new Error("Choose a quote to link.");
  if (eventId === otherId) throw new Error("A quote cannot relate to itself.");
  if (!isQuoteRelationType(relationType)) throw new Error("Choose how the quotes are related.");
  const relationNote = note.trim();
  if (relationNote.length > 500) throw new Error("The relation note is too long.");
  const supabase = await getSupabase();
  const existing = await supabase
    .from("quote_event_relations")
    .select("id")
    .or(
      `and(from_event_id.eq.${eventId},to_event_id.eq.${otherId}),and(from_event_id.eq.${otherId},to_event_id.eq.${eventId})`,
    )
    .limit(1);
  if (existing.error) throw dbError(existing.error);
  if ((existing.data ?? []).length > 0) throw new Error("Those quotes are already linked.");
  const inserted = await supabase.from("quote_event_relations").insert({
    from_event_id: eventId,
    to_event_id: otherId,
    relation_type: relationType,
    note: relationNote || null,
  });
  if (inserted.error) throw dbError(inserted.error);
}

export async function unlinkQuoteReview(eventId: string, relationId: string): Promise<void> {
  const access = await quoteReviewPageAccess();
  if (!access.canEdit) throw new Error(EDIT_DENIED);
  if (!UUID.test(eventId) || !UUID.test(relationId)) throw new Error("That link was not found.");
  const supabase = await getSupabase();
  const removed = await supabase
    .from("quote_event_relations")
    .delete()
    .eq("id", relationId)
    .or(`from_event_id.eq.${eventId},to_event_id.eq.${eventId}`)
    .select("id");
  if (removed.error) throw dbError(removed.error);
  if ((removed.data ?? []).length < 1) throw new Error("That link was not found.");
}

export async function createQuoteOrderDraft(eventId: string): Promise<QuoteOrderDraftResult> {
  const access = await quoteReviewPageAccess();
  if (!access.canEdit) throw new Error(EDIT_DENIED);
  if (!UUID.test(eventId)) throw new Error("That quote was not found.");
  const supabase = await getSupabase();
  const ready = await supabase.from("purchase_orders").select("quote_event_id").limit(1);
  if (ready.error) throw dbError(ready.error);
  const event = await supabase
    .from("quote_events")
    .select("id, side, status, reference, counterparty_name, vendor_id, customer_id, currency")
    .eq("id", eventId)
    .maybeSingle();
  if (event.error) throw dbError(event.error);
  if (!event.data) throw new Error("That quote was not found.");
  const header = event.data as Row;
  const side = text(header.side);
  const quoteStatus = text(header.status);
  const existing = await linkedQuoteOrder(eventId, side);

  const listed = await supabase
    .from("quote_event_lines")
    .select(
      "id, sort_order, item_id, part_number, sku, item_name, condition, our_unit_price, award_winner, award_qty, quote_event_bids(bidder_name, unit_price, sku, item_name)",
    )
    .eq("quote_event_id", eventId)
    .order("sort_order");
  if (listed.error) throw dbError(listed.error);
  const rows = ((listed.data ?? []) as Row[]).slice().sort((a, b) => numberOf(a.sort_order) - numberOf(b.sort_order));
  const built = buildQuoteAward(
    rows.map((row) => ({
      id: text(row.id),
      partNumber: text(row.part_number) || null,
      sku: text(row.sku) || null,
      itemName: text(row.item_name) || null,
      itemId: text(row.item_id) || null,
      condition: text(row.condition) || null,
      unitPrice: asMoney(row.our_unit_price),
      awardWinner: text(row.award_winner) || null,
      awardQty: asMoney(row.award_qty),
      bids: rowsOf(row.quote_event_bids).map((bid) => ({
        bidderName: text(bid.bidder_name),
        unitPrice: asMoney(bid.unit_price),
        sku: text(bid.sku) || null,
        itemName: text(bid.item_name) || null,
      })),
    })),
  );
  if (!built.ok) {
    if (existing) return { ...existing, created: false, message: quoteOrderReuseMessage(existing), quoteStatus };
    throw new Error(built.message);
  }
  const storedStatus = await storeQuoteAwardStatus(supabase, eventId, quoteStatus, quoteAwardStatus(built.coversAll));
  if (existing) return { ...existing, created: false, message: quoteOrderReuseMessage(existing), quoteStatus: storedStatus };

  const reference = text(header.reference);
  const currency = (text(header.currency) || "USD").toUpperCase();
  const note = currency === "USD" ? quoteOrderNote({ reference, id: eventId }) : `${quoteOrderNote({ reference, id: eventId })} Quote currency is ${currency}.`;
  const kind = quoteOrderKind(side);
  let createdId = "";
  if (kind === "purchase") {
    const vendorId = text(header.vendor_id);
    if (!UUID.test(vendorId)) throw new Error("Choose a vendor before creating a purchase order.");
    const saved = await savePurchaseOrder(null, {
      vendorId,
      fulfillment: "warehouse",
      terms: "Net30",
      orderedOn: quoteCalendarDay(),
      expectedOn: "",
      vendorNotes: "",
      internalNotes: note,
      freightIn: "",
      shipments: [],
      lines: built.lines.map((line) => ({
        itemId: line.itemId ?? "",
        description: orderDescription(line),
        qty: qtyText(line.qty),
        unitCost: formatUnitPrice(line.unitPrice),
        extPrice: formatExtension(extensionFromUnit(line.qty, line.unitPrice)),
        condition: line.condition,
        unit: "Piece",
      })),
    });
    createdId = saved.id;
    const linked = await supabase.from("purchase_orders").update({ quote_event_id: eventId }).eq("id", createdId).eq("status", "draft");
    if (linked.error) {
      if (linked.error.code === "23505") {
        await supabase.from("purchase_orders").delete().eq("id", createdId).eq("status", "draft");
        const again = await linkedQuoteOrder(eventId, side);
        if (again) return { ...again, created: false, message: quoteOrderReuseMessage(again), quoteStatus: storedStatus };
      }
      throw dbError(linked.error);
    }
  } else {
    const customerId = text(header.customer_id);
    if (!UUID.test(customerId)) throw new Error("Pick a customer before creating a sales order. A prospect is not a customer yet.");
    const saved = await saveSalesOrder(
      salesDraftFromAward({
        customerId,
        reference,
        contactName: text(header.counterparty_name),
        currency,
        note,
        lines: built.lines,
      }),
    );
    createdId = saved.id;
    const linked = await supabase.from("sales_orders").update({ quote_event_id: eventId }).eq("id", createdId).eq("status", "draft");
    if (linked.error) {
      if (linked.error.code === "23505") {
        await supabase.from("sales_orders").delete().eq("id", createdId).eq("status", "draft");
        const again = await linkedQuoteOrder(eventId, side);
        if (again) return { ...again, created: false, message: quoteOrderReuseMessage(again), quoteStatus: storedStatus };
      }
      throw dbError(linked.error);
    }
  }
  const link = await linkedQuoteOrder(eventId, side);
  if (!link) throw new Error("The draft was saved, but the quote link was not.");
  const noun = kind === "purchase" ? "purchase order" : "sales order";
  return { ...link, created: true, message: `Draft ${noun} created. It is not approved.`, quoteStatus: storedStatus };
}

async function storeQuoteAwardStatus(
  supabase: Awaited<ReturnType<typeof getSupabase>>,
  eventId: string,
  current: string,
  next: "won" | "won_partial",
): Promise<string> {
  if (next === current) return current;
  const updated = await supabase.from("quote_events").update({ status: next }).eq("id", eventId);
  if (updated.error) {
    if (updated.error.code === "23514") {
      throw new Error(`Won partial needs ${QUOTE_WON_PARTIAL_MIGRATION}. Deploying does not run it.`);
    }
    throw dbError(updated.error);
  }
  return next;
}

function salesDraftFromAward(input: {
  customerId: string;
  reference: string;
  contactName: string;
  currency: string;
  note: string;
  lines: BuiltQuoteAwardLine[];
}): SoDraftInput {
  return {
    id: null,
    customerId: input.customerId,
    customerPo: input.reference.trim().slice(0, 200),
    reference: "",
    channel: "",
    orderDate: quoteCalendarDay(),
    shipDate: "",
    billTo: emptyAddress(),
    shipTo: emptyAddress(),
    terms: "",
    incoterms: "",
    shipMethod: "",
    carrierAccount: "",
    currency: input.currency,
    salesRep: "",
    exportNotes: "",
    internalNotes: input.note,
    paymentRequirement: "terms",
    paymentMethod: "",
    paymentDate: "",
    paymentRef: "",
    paymentAmount: "",
    contactName: input.contactName.trim().slice(0, 200),
    contactEmail: "",
    contactPhone: "",
    ebayTransactionFee: "",
    ebayLabelFee: "",
    ebayAdFee: "",
    ebayOrderEarnings: "",
    lines: input.lines.map((line) => {
      const qty = qtyText(line.qty);
      const unitPrice = formatUnitPrice(line.unitPrice);
      return {
        lineKind: "product",
        customerPartNumber: (line.partNumber || line.sku).slice(0, 120),
        customerDescription: orderDescription(line),
        qty,
        unitPrice,
        condition: line.condition,
        allocations: line.itemId ? [{ itemId: line.itemId, qty, unitPrice }] : [],
      };
    }),
    notes: [],
    shipments: [],
    saveAddressToCustomer: false,
  };
}

function orderDescription(line: BuiltQuoteAwardLine): string {
  return (line.itemName || line.partNumber || line.sku).slice(0, 500);
}

function qtyText(qty: number): string {
  return String(Math.round(qty * 100) / 100);
}

async function linkedQuoteOrder(eventId: string, side: string): Promise<QuoteOrderLink | null> {
  const supabase = await getSupabase();
  const [purchase, sales] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, number, status, created_at")
      .eq("quote_event_id", eventId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("sales_orders")
      .select("id, so_number, status, created_at")
      .eq("quote_event_id", eventId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  if (purchase.error) {
    if (quoteReviewsUnavailable(purchase.error)) return null;
    throw dbError(purchase.error);
  }
  if (sales.error) {
    if (quoteReviewsUnavailable(sales.error)) return null;
    throw dbError(sales.error);
  }
  const purchaseRow = ((purchase.data ?? []) as Row[])[0];
  const salesRow = ((sales.data ?? []) as Row[])[0];
  const purchaseLink = purchaseRow ? purchaseOrderLink(purchaseRow) : null;
  const salesLink = salesRow ? salesOrderLink(salesRow) : null;
  if (side === "buy") return purchaseLink ?? salesLink;
  return salesLink ?? purchaseLink;
}

function purchaseOrderLink(row: Row): QuoteOrderLink {
  const number = purchaseOrderNumberLabel(row.number == null ? null : String(row.number));
  const id = text(row.id);
  return {
    kind: "purchase",
    id,
    status: text(row.status),
    number,
    href: `/purchasing/orders/${id}`,
    label: quoteOrderLinkLabel("purchase", number),
  };
}

function salesOrderLink(row: Row): QuoteOrderLink {
  const formatted = formatSalesOrderNumber(row.so_number == null || row.so_number === "" ? null : Number(row.so_number));
  const id = text(row.id);
  return {
    kind: "sales",
    id,
    status: text(row.status),
    number: formatted ?? "Draft",
    href: `/sales/orders/${id}`,
    label: quoteOrderLinkLabel("sales", formatted ?? "Draft"),
  };
}

async function saveLines(eventId: string, lines: ParsedQuoteLine[]): Promise<QuoteSavedLine[]> {
  const supabase = await getSupabase();
  const existing = await supabase.from("quote_event_lines").select("id").eq("quote_event_id", eventId);
  if (existing.error) throw dbError(existing.error);
  const existingIds = new Set((existing.data ?? []).map((row) => String(row.id)));
  const saved: QuoteSavedLine[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.id && !existingIds.has(line.id)) throw new Error("A line does not belong to this quote.");
    const payload = {
      quote_event_id: eventId,
      sort_order: index,
      item_id: line.itemId,
      part_number: line.partNumber,
      sku: line.sku,
      item_name: line.itemName,
      condition: line.condition,
      qty: line.qty,
      target_price: line.targetPrice,
      special_requirements: line.specialRequirements,
      reply_qty: line.replyQty,
      our_unit_price: line.unitPrice,
      lead_time: line.leadTime,
      decision: line.decision,
      decision_note: line.decisionNote,
      award_winner: line.awardWinner,
      award_qty: line.awardQty,
      updated_at: new Date().toISOString(),
    };
    const written = line.id
      ? await supabase.from("quote_event_lines").update(payload).eq("id", line.id).eq("quote_event_id", eventId).select("id").single()
      : await supabase.from("quote_event_lines").insert(payload).select("id").single();
    if (written.error || !written.data) throw dbError(written.error);
    const lineId = String(written.data.id);
    saved.push({ key: line.key, id: lineId, bids: await saveBids(lineId, line), alts: await saveAlts(lineId, line) });
  }
  const kept = new Set(saved.map((line) => line.id));
  const remove = [...existingIds].filter((lineId) => !kept.has(lineId));
  if (remove.length > 0) {
    const deleted = await supabase.from("quote_event_lines").delete().eq("quote_event_id", eventId).in("id", remove);
    if (deleted.error) throw dbError(deleted.error);
  }
  return saved;
}

async function saveAlts(lineId: string, line: ParsedQuoteLine): Promise<{ key: string; id: string }[]> {
  const supabase = await getSupabase();
  const existing = await supabase.from("quote_event_line_alts").select("id").eq("line_id", lineId);
  if (existing.error) throw dbError(existing.error);
  const existingIds = new Set((existing.data ?? []).map((row) => String(row.id)));
  const saved: { key: string; id: string }[] = [];
  for (const [index, alt] of line.alts.entries()) {
    const payload = {
      line_id: lineId,
      sort_order: index,
      item_id: alt.itemId,
      part_number: alt.partNumber,
      sku: alt.sku,
      item_name: alt.itemName,
      unit_price: alt.unitPrice,
    };
    const id = alt.id && existingIds.has(alt.id) ? alt.id : null;
    const written = id
      ? await supabase.from("quote_event_line_alts").update(payload).eq("id", id).eq("line_id", lineId).select("id").single()
      : await supabase.from("quote_event_line_alts").insert(payload).select("id").single();
    if (written.error || !written.data) throw dbError(written.error);
    saved.push({ key: alt.key, id: String(written.data.id) });
  }
  const kept = new Set(saved.map((alt) => alt.id));
  const remove = [...existingIds].filter((altId) => !kept.has(altId));
  if (remove.length > 0) {
    const deleted = await supabase.from("quote_event_line_alts").delete().eq("line_id", lineId).in("id", remove);
    if (deleted.error) throw dbError(deleted.error);
  }
  return saved;
}

async function saveBids(lineId: string, line: ParsedQuoteLine): Promise<{ key: string; id: string }[]> {
  const supabase = await getSupabase();
  const existing = await supabase.from("quote_event_bids").select("id").eq("line_id", lineId);
  if (existing.error) throw dbError(existing.error);
  const existingIds = new Set((existing.data ?? []).map((row) => String(row.id)));
  const saved: { key: string; id: string }[] = [];
  for (const [index, bid] of line.bids.entries()) {
    const payload = {
      line_id: lineId,
      sort_order: index,
      bidder_name: bid.bidderName,
      unit_price: bid.unitPrice,
      note: bid.note,
      sku: bid.sku,
      item_name: bid.itemName,
      qty: bid.qty,
      lead_time: bid.leadTime,
    };
    const id = bid.id && existingIds.has(bid.id) ? bid.id : null;
    const written = id
      ? await supabase.from("quote_event_bids").update(payload).eq("id", id).eq("line_id", lineId).select("id").single()
      : await supabase.from("quote_event_bids").insert(payload).select("id").single();
    if (written.error || !written.data) throw dbError(written.error);
    saved.push({ key: bid.key, id: String(written.data.id) });
  }
  const kept = new Set(saved.map((bid) => bid.id));
  const remove = [...existingIds].filter((bidId) => !kept.has(bidId));
  if (remove.length > 0) {
    const deleted = await supabase.from("quote_event_bids").delete().eq("line_id", lineId).in("id", remove);
    if (deleted.error) throw dbError(deleted.error);
  }
  return saved;
}

async function saveBidders(
  eventId: string,
  bidders: { name: string; columnCode: string | null; bidNote: string | null; bidderClass: string }[],
): Promise<void> {
  const supabase = await getSupabase();
  const existing = await supabase.from("quote_event_bidders").select("id, bidder_name").eq("quote_event_id", eventId);
  if (existing.error) throw dbError(existing.error);
  const rows = (existing.data ?? []) as Row[];
  const byName = new Map(rows.map((row) => [text(row.bidder_name).trim().toLowerCase(), text(row.id)]));
  const kept = new Set<string>();
  for (const [index, bidder] of bidders.entries()) {
    const payload = {
      quote_event_id: eventId,
      bidder_name: bidder.name,
      column_code: bidder.columnCode,
      bid_note: bidder.bidNote,
      bidder_class: bidder.bidderClass,
      sort_order: index,
    };
    const id = byName.get(bidder.name.toLowerCase());
    if (id) {
      const updated = await supabase.from("quote_event_bidders").update(payload).eq("id", id).eq("quote_event_id", eventId).select("id").single();
      if (updated.error || !updated.data) throw dbError(updated.error);
      kept.add(id);
    } else {
      const inserted = await supabase.from("quote_event_bidders").insert(payload).select("id").single();
      if (inserted.error || !inserted.data) throw dbError(inserted.error);
      kept.add(String(inserted.data.id));
    }
  }
  const remove = rows.map((row) => text(row.id)).filter((id) => id && !kept.has(id));
  if (remove.length > 0) {
    const deleted = await supabase.from("quote_event_bidders").delete().eq("quote_event_id", eventId).in("id", remove);
    if (deleted.error) throw dbError(deleted.error);
  }
}

async function lineSummaries(ids: string[]): Promise<Map<string, ReturnType<typeof summarizeQuoteLines>>> {
  const map = new Map<string, ReturnType<typeof summarizeQuoteLines>>();
  if (ids.length === 0) return map;
  const { data, error } = await (await getSupabase())
    .from("quote_event_lines")
    .select("quote_event_id, qty, our_ext, quote_event_bids(unit_price)")
    .in("quote_event_id", ids);
  if (error) throw dbError(error);
  const grouped = new Map<string, Row[]>();
  for (const row of (data ?? []) as Row[]) {
    const eventId = text(row.quote_event_id);
    const list = grouped.get(eventId) ?? [];
    list.push(row);
    grouped.set(eventId, list);
  }
  for (const [eventId, rows] of grouped) {
    map.set(
      eventId,
      summarizeQuoteLines(
        rows.map((row) => ({
          qty: asMoney(row.qty),
          ext: asMoney(row.our_ext),
          bestUnit: bestCompetingUnit(rowsOf(row.quote_event_bids).map((bid) => ({ unitPrice: moneyInput(asMoney(bid.unit_price)) }))),
        })),
      ),
    );
  }
  return map;
}

async function relationsTouching(ids: string[]): Promise<Row[]> {
  const supabase = await getSupabase();
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (let index = 0; index < ids.length; index += 80) {
    const chunk = ids.slice(index, index + 80);
    const { data, error } = await supabase
      .from("quote_event_relations")
      .select("id, from_event_id, to_event_id, relation_type")
      .or(`from_event_id.in.(${chunk.join(",")}),to_event_id.in.(${chunk.join(",")})`);
    if (error) throw dbError(error);
    for (const row of (data ?? []) as Row[]) {
      const id = text(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
    }
  }
  return rows;
}

async function relatedByEvent(events: Row[], ids: string[]) {
  const map = new Map<string, QuoteListResult["rows"][number]["related"]>();
  if (ids.length === 0) return map;
  const links = await relationsTouching(ids);
  const labels = new Map(events.map((row) => [String(row.id), eventLabel(row)]));
  const missing = [...new Set(links.flatMap((row) => [text(row.from_event_id), text(row.to_event_id)]))].filter((id) => !labels.has(id));
  if (missing.length > 0) {
    const extra = await (await getSupabase())
      .from("quote_events")
      .select(
        "id, reference, counterparty_name, originator_kind, vendor_id, customer_id, prospect_id, received_on, vendors(display_name), customers(display_name), quote_prospects(display_name)",
      )
      .in("id", missing);
    if (extra.error) throw dbError(extra.error);
    for (const row of (extra.data ?? []) as Row[]) labels.set(String(row.id), eventLabel(row));
  }
  for (const row of links) {
    const fromId = text(row.from_event_id);
    const toId = text(row.to_event_id);
    const type = text(row.relation_type);
    pushRelated(map, fromId, {
      id: text(row.id),
      eventId: toId,
      phrase: relationPhrase(type, "from"),
      otherLabel: labels.get(toId) ?? "Quote",
    });
    pushRelated(map, toId, {
      id: text(row.id),
      eventId: fromId,
      phrase: relationPhrase(type, "to"),
      otherLabel: labels.get(fromId) ?? "Quote",
    });
  }
  return map;
}

async function relationsFor(eventId: string): Promise<QuoteRelationView[]> {
  const { data, error } = await (await getSupabase())
    .from("quote_event_relations")
    .select("id, from_event_id, to_event_id, relation_type, note")
    .or(`from_event_id.eq.${eventId},to_event_id.eq.${eventId}`);
  if (error) throw dbError(error);
  const links = (data ?? []) as Row[];
  const otherIds = [...new Set(links.map((row) => (text(row.from_event_id) === eventId ? text(row.to_event_id) : text(row.from_event_id))))];
  const labels = new Map<string, string>();
  if (otherIds.length > 0) {
    const extra = await (await getSupabase())
      .from("quote_events")
      .select(
        "id, reference, counterparty_name, originator_kind, vendor_id, customer_id, prospect_id, received_on, vendors(display_name), customers(display_name), quote_prospects(display_name)",
      )
      .in("id", otherIds);
    if (extra.error) throw dbError(extra.error);
    for (const row of (extra.data ?? []) as Row[]) labels.set(String(row.id), eventLabel(row));
  }
  return links.map((row) => {
    const fromId = text(row.from_event_id);
    const side = fromId === eventId ? "from" : "to";
    const otherId = side === "from" ? text(row.to_event_id) : fromId;
    return {
      id: text(row.id),
      otherId,
      otherLabel: labels.get(otherId) ?? "Quote",
      phrase: relationPhrase(text(row.relation_type), side),
      note: text(row.note),
    };
  });
}

async function itemContext(ids: string[]): Promise<Map<string, { onHand: number | null; lastBuy: string; lastSell: string }>> {
  const map = new Map<string, { onHand: number | null; lastBuy: string; lastSell: string }>();
  const unique = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (unique.length === 0) return map;
  const supabase = await getSupabase();
  const items = await supabase.from("items").select("id, quantity").in("id", unique);
  if (!items.error) {
    for (const row of (items.data ?? []) as Row[]) {
      map.set(text(row.id), { onHand: asMoney(row.quantity), lastBuy: "", lastSell: "" });
    }
  }
  const txns = await supabase
    .from("item_transactions")
    .select("item_id, type, unit_price, txn_date, created_at")
    .in("item_id", unique)
    .order("txn_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (txns.error) return map;
  for (const row of (txns.data ?? []) as Row[]) {
    const itemId = text(row.item_id);
    const current = map.get(itemId) ?? { onHand: null, lastBuy: "", lastSell: "" };
    const label = priceWhen(row.unit_price, row.txn_date);
    if (text(row.type) === "buy" && !current.lastBuy) current.lastBuy = label;
    if (text(row.type) === "sell" && !current.lastSell) current.lastSell = label;
    map.set(itemId, current);
  }
  return map;
}

function lineDraft(
  row: Row,
  context: Map<string, { onHand: number | null; lastBuy: string; lastSell: string }>,
  profiles: Map<string, Row> = new Map(),
): QuoteLineDraft {
  const itemId = text(row.item_id);
  const side = itemId ? context.get(itemId) : undefined;
  const bids = rowsOf(row.quote_event_bids)
    .slice()
    .sort((a, b) => numberOf(a.sort_order) - numberOf(b.sort_order))
    .map((bid) => {
      const bidderName = text(bid.bidder_name);
      const profile = profiles.get(bidderName.trim().toLowerCase());
      return {
        key: text(bid.id),
        id: text(bid.id),
        bidderName,
        unitPrice: moneyInput(asMoney(bid.unit_price)),
        note: text(bid.note),
        sku: text(bid.sku),
        itemName: text(bid.item_name),
        qty: quoteQtyText(bid.qty),
        leadTime: text(bid.lead_time),
        columnCode: text(profile?.column_code),
        bidNote: text(profile?.bid_note),
        bidderClass: text(profile?.bidder_class) === "mkt" || text(profile?.bidder_class) === "fsp" ? text(profile?.bidder_class) : "cmp",
      };
    });
  const alts = rowsOf(row.quote_event_line_alts)
    .slice()
    .sort((a, b) => numberOf(a.sort_order) - numberOf(b.sort_order))
    .map((alt) => ({
      key: text(alt.id),
      id: text(alt.id),
      itemId: text(alt.item_id),
      partNumber: text(alt.part_number),
      sku: text(alt.sku),
      itemName: text(alt.item_name),
      unitPrice: moneyInput(asMoney(alt.unit_price)),
    }));
  return {
    key: text(row.id),
    id: text(row.id),
    itemId,
    partNumber: text(row.part_number),
    sku: text(row.sku),
    itemName: text(row.item_name),
    condition: text(row.condition),
    qty: quoteQtyText(row.qty),
    targetPrice: moneyInput(asMoney(row.target_price)),
    specialRequirements: text(row.special_requirements),
    replyQty: quoteQtyText(row.reply_qty),
    unitPrice: moneyInput(asMoney(row.our_unit_price)),
    leadTime: text(row.lead_time),
    decision: text(row.decision),
    decisionNote: text(row.decision_note),
    awardWinner: text(row.award_winner),
    awardQty: quoteQtyText(row.award_qty),
    bids,
    alts,
    onHand: side?.onHand ?? null,
    lastBuy: side?.lastBuy ?? "",
    lastSell: side?.lastSell ?? "",
  };
}

function hitFromRow(row: Row): QuoteItemHit {
  return {
    id: text(row.id),
    sku: text(row.sku),
    name: text(row.name),
    partNumber: text(row.part_number) || text(row.oem_part_number),
    condition: text(row.condition),
    onHand: asMoney(row.quantity),
    lastBuy: "",
    lastSell: "",
  };
}

function rankHit(hit: QuoteItemHit, needle: string, norm: string): number {
  if (hit.sku.toLowerCase() === needle.toLowerCase()) return 0;
  if (norm && normalizePartNumber(hit.partNumber) === norm) return 1;
  return 2;
}

function eventLabel(row: Row): string {
  return quoteEventLabel({
    reference: text(row.reference),
    counterparty: partyOf(row).originator,
    receivedOn: text(row.received_on),
  });
}

function partyOf(row: Row): {
  kind: string;
  company: string;
  contact: string;
  originator: string;
  vendorId: string | null;
  customerId: string | null;
  prospectId: string | null;
} {
  const kind = text(row.originator_kind);
  const vendorId = text(row.vendor_id) || null;
  const customerId = text(row.customer_id) || null;
  const prospectId = text(row.prospect_id) || null;
  const contact = text(row.counterparty_name);
  let company = "";
  if (customerId && (kind === "customer" || kind === "dds")) company = joinedName(row, "customers");
  else if (vendorId && (kind === "vendor" || kind === "dds")) company = joinedName(row, "vendors");
  else if (prospectId) company = joinedName(row, "quote_prospects");
  else if (vendorId) company = joinedName(row, "vendors");
  return {
    kind,
    company,
    contact,
    originator: originatorDisplay({ kind, company, contact }),
    vendorId,
    customerId,
    prospectId,
  };
}

function pushRelated(
  map: Map<string, QuoteListResult["rows"][number]["related"]>,
  eventId: string,
  link: QuoteListResult["rows"][number]["related"][number],
) {
  if (!eventId) return;
  const list = map.get(eventId) ?? [];
  list.push(link);
  map.set(eventId, list);
}

function storedQty(value: string): number | null {
  const parsed = parseQuoteQty(value);
  return parsed.ok ? parsed.qty : null;
}

function storedMoney(value: string): number | null {
  return asMoney(value.replaceAll(",", "").replaceAll("$", ""));
}

function priceWhen(unitPrice: unknown, date: unknown): string {
  const amount = asMoney(unitPrice);
  if (amount == null) return "";
  const when = formatDataDate(typeof date === "string" ? date : "");
  return when ? `${formatMoney(amount)} on ${when}` : formatMoney(amount);
}

function joinedName(row: Row, key: string): string {
  const value = row[key];
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== "object" || !("display_name" in record)) return "";
  const name = (record as { display_name?: unknown }).display_name;
  return typeof name === "string" ? name : "";
}

function rowsOf(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Row => Boolean(row) && typeof row === "object");
}

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function numberOf(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function searchNeedle(value: string): string {
  return value.trim().replace(/[%_,()"\\]/g, "").slice(0, 80);
}

async function partyIdsByName(table: "vendors" | "customers" | "quote_prospects", needle: string): Promise<string[]> {
  const pattern = quotePartyNamePattern(needle);
  if (!pattern) return [];
  const listed = await (await getSupabase()).from(table).select("id").ilike("display_name", pattern).limit(QUOTE_LIST_PARTY_LIMIT);
  if (listed.error) {
    if (table === "quote_prospects" && quoteReviewsUnavailable(listed.error)) return [];
    throw new Error(errorText(listed.error));
  }
  return (listed.data ?? []).map((row) => String(row.id));
}

function dbError(error: { code?: string; message?: string } | null): Error {
  if (quoteReviewsUnavailable(error)) {
    return new Error(`Quote requests are not set up yet. ${QUOTE_REVIEWS_SETUP}`);
  }
  if (error?.code === "23505") return new Error("Those quotes are already linked.");
  if (error?.code === "23514") return new Error("That originator does not match this quote.");
  if (error?.code === "23503") return new Error("That customer, vendor, prospect, item, or quote was not found.");
  return new Error(errorText(error));
}
