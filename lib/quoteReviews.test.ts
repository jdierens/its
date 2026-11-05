import assert from "node:assert/strict";
import test from "node:test";
import { pageMetaFor } from "./nav.ts";
import { quoteReviewAccessForRole } from "./quoteReviewAccess.ts";
import {
  addCalendarDays,
  bestCompetingUnit,
  bestQuotedUnit,
  buildQuoteAward,
  filterQuoteParties,
  quoteFieldChars,
  quoteLineBestIsHigh,
  counterpartyLabel,
  isQuoteDueSoon,
  linesForRelatedEvent,
  displayAxes,
  offerUnit,
  originatorDisplay,
  originatorForFlow,
  originatorPicker,
  parseQuoteSave,
  quoteDirectionLabel,
  quoteLineMatchKey,
  quoteExtTotal,
  quoteExtWhole,
  quoteMoneyExt,
  quoteOverviewExt,
  parseRelatedQuote,
  quoteBidderList,
  quoteBidders,
  quoteBidderExtKind,
  quoteColumnCaption,
  quoteColumnCodeInput,
  quoteColumnHead,
  quotePrintNoteLine,
  quotePrintNotes,
  quoteExtension,
  quoteFlowLabel,
  quoteLeadTime,
  quoteAwardStatus,
  quoteCounterpartyMessage,
  quoteEditSnapshot,
  quoteOrderKind,
  quoteOrderLinkLabel,
  quoteOrderNote,
  quoteOrderReuseMessage,
  quoteStatusLabel,
  quoteReplyExtension,
  quoteReviewsUnavailable,
  relationForNewFlow,
  relationPhrase,
  suggestedRelatedFlow,
  summarizeQuoteLines,
  type QuoteLineInput,
  type QuoteSaveInput,
} from "./quoteReviews.ts";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const VENDOR = "22222222-2222-4222-8222-222222222222";
const PROSPECT = "33333333-3333-4333-8333-333333333333";

test("quote review access follows financial capabilities", () => {
  assert.deepEqual(quoteReviewAccessForRole("admin", true), { canEdit: true, canView: true });
  assert.deepEqual(quoteReviewAccessForRole("staff", true), { canEdit: true, canView: true });
  assert.deepEqual(quoteReviewAccessForRole("read_only", true), { canEdit: false, canView: true });
  assert.deepEqual(quoteReviewAccessForRole("warehouse_manager", true), { canEdit: false, canView: false });
  assert.deepEqual(quoteReviewAccessForRole("warehouse_clerk", true), { canEdit: false, canView: false });
  assert.deepEqual(quoteReviewAccessForRole("warehouse_clerk", true, true), { canEdit: false, canView: true });
  assert.deepEqual(quoteReviewAccessForRole(null, false), { canEdit: true, canView: true });
});

test("quote requests sit under Pricing and keep their own pages", () => {
  assert.equal(pageMetaFor("/pricing/quotes").title, "Quote requests");
  assert.deepEqual(
    pageMetaFor("/pricing/quotes/new").crumbs.map((crumb) => crumb.label),
    ["Pricing", "Quote requests", "New quote request"],
  );
  assert.equal(pageMetaFor("/pricing/quotes/abc").title, "Quote request");
  assert.equal(pageMetaFor("/pricing/quotes/abc/print").title, "Export PDF");
});

test("canonical quote types name the side, the direction, and who is picked", () => {
  assert.equal(quoteFlowLabel("sell", "inbound"), "Inbound Sell Request");
  assert.equal(quoteFlowLabel("buy", "inbound"), "Inbound Buy Request");
  assert.equal(quoteFlowLabel("sell", "outbound"), "Outbound Sell Request");
  assert.equal(quoteFlowLabel("buy", "outbound"), "Outbound Buy Offer");
  assert.deepEqual(originatorPicker("sell", "inbound"), { kind: "party", party: "customer" });
  assert.deepEqual(originatorPicker("buy", "inbound"), { kind: "party", party: "vendor" });
  assert.deepEqual(originatorPicker("sell", "outbound"), { kind: "dds", party: "customer" });
  assert.deepEqual(originatorPicker("buy", "outbound"), { kind: "dds", party: "vendor" });
  assert.equal(originatorDisplay({ kind: "customer", company: "BrightStar Systems LLC", contact: "Josh Robinson" }), "BrightStar Systems LLC (Josh Robinson)");
  assert.equal(originatorDisplay({ kind: "vendor", company: "Mainstream Global, Inc. (V)", contact: "Joe" }), "Mainstream Global, Inc. (V) (Joe)");
  assert.equal(originatorDisplay({ kind: "dds", company: "Hong Li", contact: "Hong Li" }), "DDS → Hong Li");
  assert.equal(originatorDisplay({ kind: "dds", company: "", contact: "" }), "DDS");
  assert.equal(quoteLeadTime(""), "In stock");
  assert.equal(quoteLeadTime("2 weeks"), "2 weeks");
});

test("type labels are the pattern name and never say ask", () => {
  for (const side of ["buy", "sell"]) {
    for (const direction of ["inbound", "outbound", "inbound_ask", "outbound_ask", "inbound_response", "outbound_offer"]) {
      const label = quoteFlowLabel(side, direction);
      assert.equal(label.toLowerCase().includes("ask"), false);
      assert.match(label, /^(Inbound|Outbound) (Buy|Sell) /);
    }
  }
  assert.equal(quoteFlowLabel("buy", "inbound"), "Inbound Buy Request");
  assert.equal(quoteFlowLabel("sell", "outbound"), "Outbound Sell Request");
  assert.equal(quoteFlowLabel("buy", "outbound"), "Outbound Buy Offer");
  assert.equal(quoteDirectionLabel("inbound"), "Inbound");
  assert.equal(quoteDirectionLabel("outbound"), "Outbound");
  assert.equal(quoteDirectionLabel("inbound_ask"), "Inbound");
  assert.deepEqual(displayAxes("buy", "inbound_ask"), { side: "buy", direction: "inbound" });
  assert.equal(quoteLineMatchKey("MZ-1 /A", ""), "p:MZ1A");
  assert.equal(offerUnit({ id: "1", label: "LNT", prices: [{ matchKey: "p:MZ1A", unitPrice: "10" }] }, "mz-1/a", ""), "10");
  assert.equal(quoteMoneyExt("2", "10", "USD"), "$20");
  assert.equal(quoteMoneyExt("500", "218.80", "USD"), "$109,400");
  assert.equal(quoteMoneyExt("1", "10.49", "USD"), "$10");
  assert.equal(quoteMoneyExt("1", "10.50", "USD"), "$11");
  assert.equal(quoteExtWhole("500", "218.80"), 109400);
  assert.equal(quoteExtWhole("1", "10.49"), 10);
  assert.equal(quoteExtWhole("", "10"), null);
  assert.equal(quoteOverviewExt({ qty: "2", replyQty: "3" }, "10", "dds"), 30);
  assert.equal(quoteOverviewExt({ qty: "2", replyQty: "3" }, "10", "bid"), 20);
  assert.equal(quoteExtTotal([109400, 10], "USD"), "$109,410");
  assert.equal(quoteExtTotal([quoteExtWhole("1", "10.49"), quoteExtWhole("1", "10.49")], "USD"), "$20");
  assert.equal(quoteExtTotal([null, null], "USD"), "");
});

test("changing side and direction keeps only the party that still fits", () => {
  assert.deepEqual(
    originatorForFlow("buy", "inbound", {
      originatorKind: "customer",
      vendorId: VENDOR,
      customerId: CUSTOMER,
      prospectId: "",
    }),
    { originatorKind: "vendor", vendorId: VENDOR, customerId: "", prospectId: "" },
  );
  assert.deepEqual(
    originatorForFlow("sell", "outbound", {
      originatorKind: "vendor",
      vendorId: VENDOR,
      customerId: "",
      prospectId: PROSPECT,
    }),
    { originatorKind: "dds", vendorId: "", customerId: "", prospectId: PROSPECT },
  );
});

test("a related quote copies the request and leaves the reply behind", () => {
  const copied = linesForRelatedEvent([
    {
      itemId: "11111111-1111-1111-1111-111111111111",
      partNumber: " MZ-1 ",
      sku: " SKU1 ",
      itemName: " Drive ",
      condition: " Used ",
      qty: " 2 ",
      targetPrice: " 9 ",
      specialRequirements: " firmware ",
      unitPrice: "10.00",
      fspUnit: "70",
      leadTime: "2 weeks",
      replyQty: "1",
      decision: "bid",
      decisionNote: "keep",
    },
    {
      itemId: null,
      partNumber: "",
      sku: "",
      itemName: "",
      condition: "Used",
      qty: "",
      unitPrice: "4",
      decision: "pass",
    },
  ]);
  assert.deepEqual(copied, [
    {
      itemId: "11111111-1111-1111-1111-111111111111",
      partNumber: "MZ-1",
      sku: "SKU1",
      itemName: "Drive",
      condition: "Used",
      qty: "2",
      targetPrice: "9",
      specialRequirements: "firmware",
    },
  ]);
  assert.equal("unitPrice" in copied[0], false);
  assert.equal("fspUnit" in copied[0], false);
  assert.deepEqual(suggestedRelatedFlow("buy", "inbound"), {
    side: "sell",
    direction: "outbound",
    relationType: "response_to",
  });
  assert.deepEqual(suggestedRelatedFlow("sell", "inbound"), {
    side: "buy",
    direction: "outbound",
    relationType: "forwarded_for_pricing",
  });
  assert.equal(relationPhrase("response_to", "from"), "Response to");
  assert.equal(relationPhrase("response_to", "to"), "Response from");
  assert.equal(relationPhrase("forwarded_for_pricing", "to"), "Forwarded as");
  assert.equal(relationForNewFlow("sell", "outbound"), "response_to");
  assert.equal(relationForNewFlow("buy", "outbound"), "forwarded_for_pricing");
});

test("due soon includes overdue open quotes and skips closed ones", () => {
  assert.equal(addCalendarDays("2026-11-03", 7), "2026-11-10");
  assert.equal(isQuoteDueSoon({ dueOn: "2026-11-10", status: "open", today: "2026-11-03" }), true);
  assert.equal(isQuoteDueSoon({ dueOn: "2026-11-11", status: "reviewing", today: "2026-11-03" }), false);
  assert.equal(isQuoteDueSoon({ dueOn: "2026-11-01", status: "bid_sent", today: "2026-11-03" }), true);
  assert.equal(isQuoteDueSoon({ dueOn: "2026-11-01", status: "won", today: "2026-11-03" }), false);
  assert.equal(isQuoteDueSoon({ dueOn: null, status: "open", today: "2026-11-03" }), false);
});

test("line totals sum our extension and the lowest competing price", () => {
  assert.deepEqual(
    summarizeQuoteLines([
      { qty: 2, ext: 20, bestUnit: 9 },
      { qty: 1, ext: null, bestUnit: 5 },
      { qty: null, ext: null, bestUnit: 4 },
    ]),
    { lineCount: 3, qty: 3, offerExt: 20, competingExt: 23 },
  );
  assert.equal(bestCompetingUnit([{ unitPrice: "12.00" }, { unitPrice: "9.50" }, { unitPrice: "" }]), 9.5);
  const line = { partNumber: "MZ-1", sku: "", bids: [{ unitPrice: "200.10" }, { unitPrice: "" }] };
  const offers = [{ id: "hong", label: "Hong Li", prices: [{ matchKey: "p:MZ1", unitPrice: "190.25" }] }];
  assert.equal(quoteLineBestIsHigh("buy", "outbound"), false);
  assert.equal(quoteLineBestIsHigh("sell", "inbound"), false);
  assert.equal(quoteLineBestIsHigh("buy", "inbound"), true);
  assert.equal(quoteLineBestIsHigh("sell", "outbound"), true);
  assert.equal(quoteLineBestIsHigh("buy", "inbound_response"), true);
  assert.equal(bestQuotedUnit(line, offers, "buy", "outbound"), 190.25);
  assert.equal(bestQuotedUnit(line, offers, "sell", "inbound"), 190.25);
  assert.equal(bestQuotedUnit(line, offers, "buy", "inbound"), 200.1);
  assert.equal(bestQuotedUnit(line, offers, "sell", "outbound"), 200.1);
  assert.equal(
    bestQuotedUnit(
      { partNumber: "MZ-1", sku: "", bids: [{ unitPrice: "8.00" }] },
      [{ id: "hong", label: "Hong Li", prices: [{ matchKey: "p:MZ1", unitPrice: "9.25" }] }],
      "sell",
      "outbound",
    ),
    9.25,
  );
  assert.equal(
    bestQuotedUnit({ partNumber: "MZ-1", sku: "", bids: [{ unitPrice: "" }] }, [{ id: "hong", label: "Hong Li", prices: [{ matchKey: "p:OTHER", unitPrice: "9.25" }] }], "buy", "inbound"),
    null,
  );
  assert.equal(quoteFieldChars("", 4, 12), 4);
  assert.equal(quoteFieldChars("MZ-1A", 4, 12), 5);
  assert.equal(quoteFieldChars("1", 3, 8, "1000"), 4);
  assert.equal(quoteFieldChars("", 4, 18, "In stock"), 8);
  assert.equal(quoteFieldChars("a very long pasted requirement that should not stretch the row", 8, 32), 32);
  assert.equal(quoteExtension("2", "10"), "$20");
  assert.equal(quoteExtension("2", "10.25"), "$21");
  assert.equal(quoteReplyExtension("2", "3", "10"), "$30");
  assert.equal(quoteReplyExtension("2", "", "10"), "$20");
  assert.equal(counterpartyLabel("Mainstream", "Joe"), "Mainstream (Joe)");
  assert.equal(counterpartyLabel("Mainstream", "mainstream"), "Mainstream");
  assert.deepEqual(quoteBidders([{ bids: [{ bidderName: "LNT" }, { bidderName: "XYS" }] }, { bids: [{ bidderName: "lnt" }, { bidderName: "ACR" }] }]), [
    "LNT",
    "XYS",
    "ACR",
  ]);
  assert.deepEqual(
    quoteBidderList(
      [{ bids: [{ bidderName: "LNT" }] }],
      [{ id: "rel-hong", otherId: "hong", otherLabel: "Hong Li", phrase: "Response from" }],
    ),
    [
      { kind: "bid", name: "LNT" },
      { kind: "related", id: "rel-hong", otherId: "hong", label: "Hong Li", phrase: "Response from" },
    ],
  );
  assert.equal(
    quoteBidderList(
      [{ bids: [{ bidderName: "Hong Li" }] }],
      [{ id: "rel-hong", otherId: "hong", otherLabel: "Hong Li", phrase: " Response from " }],
    )[1].label,
    "Hong Li · related",
  );
});

function saveInput(patch: Partial<QuoteSaveInput> = {}, linePatch: Partial<QuoteLineInput> = {}): QuoteSaveInput {
  return {
    reference: "Joe list",
    counterpartyName: "Josh Robinson",
    vendorId: "",
    customerId: CUSTOMER,
    prospectId: "",
    originatorKind: "customer",
    channel: "whatsapp",
    direction: "inbound",
    side: "sell",
    status: "open",
    receivedOn: "2026-11-03",
    dueOn: "2026-11-01",
    currency: "usd",
    notes: "",
    ddsColumnCode: "",
    ddsBidNote: "",
    lines: [
      {
        key: "a",
        id: "",
        itemId: "",
        partNumber: "ABC-1",
        sku: "",
        itemName: "",
        condition: "",
        qty: "1",
        targetPrice: "12.50",
        specialRequirements: "new date code",
        replyQty: "",
        unitPrice: "",
        fspUnit: "",
        leadTime: "",
        decision: "",
        decisionNote: "",
        awardWinner: "",
        awardQty: "",
        bids: [{ key: "b", id: "", bidderName: "", unitPrice: "", note: "", sku: "", itemName: "", qty: "", leadTime: "" }],
        alts: [],
        ...linePatch,
      },
    ],
    ...patch,
  };
}

test("saving a quote drops an empty line and warns when the due date is earlier", () => {
  const saved = parseQuoteSave({
    ...saveInput(),
    lines: [
      ...saveInput().lines,
      {
        key: "empty",
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
        fspUnit: "",
        leadTime: "",
        decision: "",
        decisionNote: "",
        awardWinner: "",
        awardQty: "",
        bids: [],
        alts: [],
      },
    ],
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.deepEqual(saved.warnings, ["Due date is before the received date. You can still save."]);
  assert.equal(saved.value.currency, "USD");
  assert.equal(saved.value.side, "sell");
  assert.equal(saved.value.direction, "inbound");
  assert.equal(saved.value.originatorKind, "customer");
  assert.equal(saved.value.lines.length, 1);
  assert.equal(saved.value.lines[0]?.partNumber, "ABC-1");
  assert.equal(saved.value.lines[0]?.targetPrice, 12.5);
  assert.equal(saved.value.lines[0]?.specialRequirements, "new date code");
  assert.equal(saved.value.lines[0]?.bids.length, 0);

  const priced = parseQuoteSave(
    saveInput(
      { reference: "", counterpartyName: "", direction: "outbound", side: "sell", originatorKind: "dds", customerId: "", status: "bid_sent", channel: "email", dueOn: "" },
      { partNumber: "", qty: "2", unitPrice: "nope", targetPrice: "", specialRequirements: "", decision: "bid" },
    ),
  );
  assert.equal(priced.ok, false);
});

test("each canonical originator is accepted and a mismatched party is refused", () => {
  const sell = parseQuoteSave(saveInput({ dueOn: "" }));
  assert.equal(sell.ok, true);

  const buy = parseQuoteSave(
    saveInput({
      reference: "Mainstream",
      counterpartyName: "Joe",
      side: "buy",
      originatorKind: "vendor",
      vendorId: VENDOR,
      customerId: "",
      dueOn: "",
    }),
  );
  assert.equal(buy.ok, true);
  if (buy.ok) assert.equal(buy.value.vendorId, VENDOR);

  const hong = parseQuoteSave(
    saveInput({
      reference: "Hong Li HK market",
      counterpartyName: "Hong Li",
      side: "sell",
      direction: "outbound",
      originatorKind: "dds",
      customerId: "",
      prospectId: PROSPECT,
      dueOn: "",
    }),
  );
  assert.equal(hong.ok, true);
  if (hong.ok) {
    assert.equal(hong.value.originatorKind, "dds");
    assert.equal(hong.value.prospectId, PROSPECT);
    assert.equal(hong.value.vendorId, null);
  }

  const vendorOnSell = parseQuoteSave(saveInput({ vendorId: VENDOR, dueOn: "" }));
  assert.equal(vendorOnSell.ok, false);
  if (!vendorOnSell.ok) assert.match(vendorOnSell.message, /Inbound Sell Request/);

  const customerOnBuy = parseQuoteSave(saveInput({ side: "buy", originatorKind: "customer", dueOn: "" }));
  assert.equal(customerOnBuy.ok, false);
  if (!customerOnBuy.ok) assert.match(customerOnBuy.message, /Inbound Buy Request/);
});

test("a related quote keeps the chosen flow and rejects a bad link type", () => {
  const parsed = parseRelatedQuote({
    sourceId: "11111111-1111-1111-1111-111111111111",
    reference: "Hong Li HK market",
    counterpartyName: "Hong Li",
    vendorId: "",
    customerId: "",
    prospectId: PROSPECT,
    originatorKind: "dds",
    channel: "whatsapp",
    direction: "outbound",
    side: "sell",
    receivedOn: "2026-11-03",
    dueOn: "",
    relationType: "response_to",
    relationNote: "",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.direction, "outbound");
  assert.equal(parsed.value.side, "sell");
  assert.equal(parsed.value.relationType, "response_to");
  assert.equal(
    parseRelatedQuote({
      sourceId: "11111111-1111-1111-1111-111111111111",
      reference: "",
      counterpartyName: "",
      vendorId: "",
      customerId: CUSTOMER,
      prospectId: "",
      originatorKind: "customer",
      channel: "email",
      direction: "inbound",
      side: "sell",
      receivedOn: "2026-11-03",
      dueOn: "",
      relationType: "copied",
      relationNote: "",
    }).ok,
    false,
  );
});

test("a missing quote table or prospect table is recognized and another missing table is not", () => {
  assert.equal(
    quoteReviewsUnavailable({ code: "PGRST205", message: "Could not find the table 'public.quote_events' in the schema cache" }),
    true,
  );
  assert.equal(
    quoteReviewsUnavailable({ code: "PGRST204", message: "Could not find the 'side' column of 'quote_events' in the schema cache" }),
    true,
  );
  assert.equal(
    quoteReviewsUnavailable({ code: "PGRST205", message: "Could not find the table 'public.quote_prospects' in the schema cache" }),
    true,
  );
  assert.equal(
    quoteReviewsUnavailable({ code: "PGRST205", message: "Could not find the table 'public.vendors' in the schema cache" }),
    false,
  );
  assert.equal(
    quoteReviewsUnavailable({
      code: "PGRST205",
      message: "Could not find the table 'public.quote_event_line_alts' in the schema cache",
    }),
    true,
  );
  assert.equal(
    quoteReviewsUnavailable({
      code: "PGRST204",
      message: "Could not find the 'quote_event_id' column of 'purchase_orders' in the schema cache",
    }),
    true,
  );
});

test("the party picker filters by name and stays a short list", () => {
  const parties = [
    { id: "1", name: "BrightStar Systems LLC" },
    { id: "2", name: "Globaltek" },
    { id: "3", name: "Acme Bright" },
  ];
  assert.deepEqual(
    filterQuoteParties(parties, "bright").map((party) => party.name),
    ["BrightStar Systems LLC", "Acme Bright"],
  );
  assert.equal(filterQuoteParties(parties, "").length, 3);
  assert.equal(filterQuoteParties(Array.from({ length: 20 }, (_, index) => ({ id: String(index), name: `N${index}` })), "n").length, 12);
});

test("a response line keeps the primary item and optional alternative SKUs", () => {
  const saved = parseQuoteSave(
    saveInput({ dueOn: "" }, {
      itemId: "11111111-1111-4111-8111-111111111111",
      sku: "107314",
      unitPrice: "225",
      alts: [
        { key: "alt-empty", id: "", itemId: "", partNumber: "", sku: "", itemName: "", unitPrice: "" },
        {
          key: "alt-1",
          id: "",
          itemId: "22222222-2222-4222-8222-222222222222",
          partNumber: "MTA18ASF2G72PDZ-2G6",
          sku: "107315",
          itemName: "16G substitute",
          unitPrice: "70",
        },
      ],
    }),
  );
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.lines[0]?.itemId, "11111111-1111-4111-8111-111111111111");
  assert.equal(saved.value.lines[0]?.sku, "107314");
  assert.equal(saved.value.lines[0]?.alts.length, 1);
  assert.equal(saved.value.lines[0]?.alts[0]?.sku, "107315");
  assert.equal(saved.value.lines[0]?.alts[0]?.unitPrice, 70);
  assert.equal(saved.value.lines[0]?.awardWinner, null);
});

test("a partial award keeps the won lines and a buy becomes a purchase order", () => {
  const item = "11111111-1111-4111-8111-111111111111";
  const built = buildQuoteAward([
    {
      id: "line-1",
      partNumber: "MTA72ASS8G72LZ-2G9",
      sku: "107314",
      itemName: "64G",
      itemId: item,
      condition: "used",
      unitPrice: 225,
      awardWinner: "dds",
      awardQty: 100,
      bids: [{ bidderName: "LNT", unitPrice: 230, sku: "ALT-1", itemName: "Other" }],
    },
    {
      id: "line-2",
      partNumber: "M393A2K43CB2-CTD",
      sku: "96049",
      itemName: "16G",
      itemId: "22222222-2222-4222-8222-222222222222",
      condition: "New",
      unitPrice: 83.25,
      awardWinner: null,
      awardQty: null,
      bids: [],
    },
  ]);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.coversAll, false);
  assert.equal(built.lines.length, 1);
  assert.equal(built.lines[0]?.itemId, item);
  assert.equal(built.lines[0]?.qty, 100);
  assert.equal(built.lines[0]?.unitPrice, 225);
  assert.equal(built.lines[0]?.condition, "Used");
  assert.equal(quoteOrderKind("buy"), "purchase");
  assert.equal(quoteOrderKind("sell"), "sales");

  const bidder = buildQuoteAward([
    {
      id: "line-1",
      partNumber: "ABC",
      sku: "100",
      itemName: "Primary",
      itemId: item,
      condition: "",
      unitPrice: 10,
      awardWinner: "LNT",
      awardQty: 4,
      bids: [{ bidderName: "LNT", unitPrice: 9.5, sku: "200", itemName: "Substitute" }],
    },
  ]);
  assert.equal(bidder.ok, true);
  if (!bidder.ok) return;
  assert.equal(bidder.coversAll, true);
  assert.equal(bidder.lines[0]?.itemId, null);
  assert.equal(bidder.lines[0]?.sku, "200");
  assert.equal(bidder.lines[0]?.unitPrice, 9.5);
  assert.equal(bidder.lines[0]?.itemName, "Substitute");
});

test("an inbound sell without a customer or prospect is refused before save", () => {
  assert.equal(
    quoteCounterpartyMessage({
      side: "sell",
      direction: "inbound",
      originatorKind: "customer",
      vendorId: "",
      customerId: "",
      prospectId: "",
    }),
    "Inbound Sell Request starts with a customer or a prospect.",
  );
  assert.equal(
    quoteCounterpartyMessage({
      side: "buy",
      direction: "inbound",
      originatorKind: "vendor",
      vendorId: "",
      customerId: "",
      prospectId: "",
    }),
    "Inbound Buy Request starts with a vendor.",
  );
  assert.equal(
    quoteCounterpartyMessage({
      side: "sell",
      direction: "inbound",
      originatorKind: "customer",
      vendorId: "",
      customerId: CUSTOMER,
      prospectId: "",
    }),
    null,
  );
  const missing = saveInput({ customerId: "" });
  const parsed = parseQuoteSave(missing);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.message, "Inbound Sell Request starts with a customer or a prospect.");
});

test("a partial award is won partial and the order link names a draft or a number", () => {
  assert.equal(quoteAwardStatus(true), "won");
  assert.equal(quoteAwardStatus(false), "won_partial");
  assert.equal(quoteStatusLabel("won_partial"), "Won partial");
  assert.equal(isQuoteDueSoon({ dueOn: "2026-11-01", status: "won_partial", today: "2026-11-03" }), false);
  assert.equal(quoteOrderLinkLabel("purchase", "Draft"), "Draft PO");
  assert.equal(quoteOrderLinkLabel("purchase", "PO6304"), "PO6304");
  assert.equal(quoteOrderLinkLabel("sales", "Draft"), "Draft SO");
  assert.equal(quoteOrderLinkLabel("sales", "SO27766"), "SO27766");
  const saved = saveInput();
  const baseline = quoteEditSnapshot(saved);
  assert.equal(JSON.stringify(quoteEditSnapshot(saved)), JSON.stringify(baseline));
  assert.notEqual(JSON.stringify(quoteEditSnapshot({ ...saved, reference: "Other list" })), JSON.stringify(baseline));
  const withBlank = saveInput();
  withBlank.lines = [
    ...withBlank.lines,
    {
      key: "empty",
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
      fspUnit: "",
      leadTime: "",
      decision: "",
      decisionNote: "",
      awardWinner: "",
      awardQty: "",
      bids: [],
      alts: [],
    },
  ];
  assert.equal(JSON.stringify(quoteEditSnapshot(withBlank)), JSON.stringify(baseline));
});

test("an FSP bidder is a price reference with a column code", () => {
  function priced(name: string, unit: string, bidderClass: string, columnCode = ""): QuoteLineInput["bids"][number] {
    return {
      key: name,
      id: "",
      bidderName: name,
      unitPrice: unit,
      note: "",
      sku: "",
      itemName: "",
      qty: "",
      leadTime: "",
      bidderClass,
      columnCode,
    };
  }

  const saved = parseQuoteSave(
    saveInput({ dueOn: "" }, { qty: "470", unitPrice: "58", bids: [priced("Forecast", "70", "fsp", "sal")] }),
  );
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.lines[0]?.unitPrice, 58);
  assert.equal(saved.value.lines[0]?.bids[0]?.unitPrice, 70);
  assert.equal(saved.value.bidders[0]?.bidderClass, "fsp");
  assert.equal(saved.value.bidders[0]?.columnCode, "SAL");
  assert.equal(quoteReplyExtension("470", "", "70"), "$32,900");
  assert.equal(quoteReplyExtension("470", "10", "70"), "$700");
  assert.equal(quoteReplyExtension("4569", "", "215"), "$982,335");
  assert.equal(quoteBidderExtKind("fsp"), "dds");
  assert.equal(quoteBidderExtKind("cmp"), "bid");

  const bad = parseQuoteSave(saveInput({ dueOn: "" }, { bids: [priced("Forecast", "70", "nope")] }));
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.message, /class/);

  const onlyFsp = parseQuoteSave(
    saveInput(
      { dueOn: "" },
      { partNumber: "", qty: "", targetPrice: "", specialRequirements: "", unitPrice: "", bids: [priced("Forecast", "215", "FSP")] },
    ),
  );
  assert.equal(onlyFsp.ok, true);
  if (!onlyFsp.ok) return;
  assert.equal(onlyFsp.value.lines.length, 1);
  assert.equal(onlyFsp.value.lines[0]?.unitPrice, null);
  assert.equal(onlyFsp.value.lines[0]?.bids[0]?.unitPrice, 215);
  assert.equal(onlyFsp.value.bidders[0]?.bidderClass, "fsp");
});

test("a column code is 3 letters or digits and the print lists comments that have text", () => {
  assert.equal(quoteColumnCodeInput("h p-e1"), "HPE");
  assert.equal(quoteColumnCodeInput("abcd"), "ABC");
  assert.deepEqual(quoteColumnHead("hpe", "DDS unit", "DDS"), { label: "HPE", title: "DDS" });
  assert.deepEqual(quoteColumnHead("", "DDS unit", "DDS"), { label: "DDS unit", title: "DDS" });
  assert.equal(quoteColumnCaption("HPE", "Acme").caption, "Acme");
  assert.equal(quoteColumnCaption("", "Acme").caption, "");

  function bid(name: string, patch: Partial<QuoteLineInput["bids"][number]> = {}): QuoteLineInput["bids"][number] {
    return { key: name, id: "", bidderName: name, unitPrice: "10", note: "", sku: "", itemName: "", qty: "", leadTime: "", ...patch };
  }

  const saved = parseQuoteSave(
    saveInput({ dueOn: "", ddsColumnCode: "hpe", ddsBidNote: "DDS proposed HPE bid per Jan 2026-11-05." }, {
      bids: [bid("Acme", { columnCode: "acm", bidNote: "Their bid." }), bid("Quiet", { columnCode: "qet", bidNote: "  " })],
    }),
  );
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.ddsColumnCode, "HPE");
  assert.equal(saved.value.ddsBidNote, "DDS proposed HPE bid per Jan 2026-11-05.");
  assert.deepEqual(
    saved.value.bidders.map((bidder) => [bidder.name, bidder.columnCode, bidder.bidNote]),
    [
      ["Acme", "ACM", "Their bid."],
      ["Quiet", "QET", null],
    ],
  );
  assert.equal(saved.value.bidders[0]?.bidderClass, "cmp");
  const notes = quotePrintNotes({
    ddsColumnCode: saved.value.ddsColumnCode ?? "",
    ddsBidNote: saved.value.ddsBidNote ?? "",
    lines: saved.value.lines,
  });
  assert.deepEqual(notes.map(quotePrintNoteLine), [
    "HPE · DDS — DDS proposed HPE bid per Jan 2026-11-05.",
    "ACM · Acme — Their bid.",
  ]);

  const short = parseQuoteSave(saveInput({ dueOn: "", ddsColumnCode: "HP" }));
  assert.equal(short.ok, false);
  if (!short.ok) assert.match(short.message, /3 letters or digits/);

  const clash = parseQuoteSave(saveInput({ dueOn: "", ddsColumnCode: "ACM" }, { bids: [bid("Acme", { columnCode: "acm" })] }));
  assert.equal(clash.ok, false);
  if (!clash.ok) assert.match(clash.message, /already used by DDS/);

  const pair = parseQuoteSave(saveInput({ dueOn: "" }, { bids: [bid("Acme", { columnCode: "ABC" }), bid("Other", { columnCode: "abc" })] }));
  assert.equal(pair.ok, false);
  if (!pair.ok) assert.match(pair.message, /already used by Acme/);

  const base = saveInput({ dueOn: "" }).lines[0];
  const split = parseQuoteSave({
    ...saveInput({ dueOn: "" }),
    lines: [
      { ...base, bids: [bid("Acme", { columnCode: "ACM", bidNote: "one" })] },
      { ...base, key: "second", partNumber: "ZZ-2", bids: [bid("Acme", { columnCode: "ACM", bidNote: "two" })] },
    ],
  });
  assert.equal(split.ok, false);
  if (!split.ok) assert.match(split.message, /two different comments/);
});

test("awarding the same quote again points at the order that already exists", () => {
  assert.match(quoteOrderReuseMessage({ kind: "purchase", status: "draft", number: "Draft" }), /draft purchase order/);
  assert.match(quoteOrderReuseMessage({ kind: "purchase", status: "open", number: "PO6304" }), /PO6304/);
  assert.match(quoteOrderReuseMessage({ kind: "sales", status: "draft", number: "Draft" }), /draft sales order/);
  assert.match(quoteOrderNote({ reference: "Mainstream", id: "859880a7-9563-488a-aa01-f0e0d2ad2bd8" }), /Mainstream/);
});
