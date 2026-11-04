import assert from "node:assert/strict";
import test from "node:test";
import { pageMetaFor } from "./nav.ts";
import { quoteReviewAccessForRole } from "./quoteReviewAccess.ts";
import {
  addCalendarDays,
  bestCompetingUnit,
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
  quoteExtension,
  quoteFlowLabel,
  quoteLeadTime,
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

test("quote reviews sit under Pricing and keep their own pages", () => {
  assert.equal(pageMetaFor("/pricing/quotes").title, "Quote reviews");
  assert.deepEqual(
    pageMetaFor("/pricing/quotes/new").crumbs.map((crumb) => crumb.label),
    ["Pricing", "Quote reviews", "New quote review"],
  );
  assert.equal(pageMetaFor("/pricing/quotes/abc").title, "Quote review");
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
        leadTime: "",
        decision: "",
        decisionNote: "",
        bids: [{ key: "b", id: "", bidderName: "", unitPrice: "", note: "", sku: "", itemName: "", qty: "", leadTime: "" }],
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
        leadTime: "",
        decision: "",
        decisionNote: "",
        bids: [],
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
});
