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
  parseQuoteSave,
  parseRelatedQuote,
  quoteExtension,
  quoteReviewsUnavailable,
  relationPhrase,
  suggestedRelatedDirection,
  suggestedRelationType,
  summarizeQuoteLines,
} from "./quoteReviews.ts";

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

test("a related quote copies identity and quantity and leaves prices behind", () => {
  const copied = linesForRelatedEvent([
    {
      itemId: "11111111-1111-1111-1111-111111111111",
      partNumber: " MZ-1 ",
      sku: " SKU1 ",
      itemName: " Drive ",
      condition: " Used ",
      qty: " 2 ",
      unitPrice: "10.00",
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
    },
  ]);
  assert.equal("unitPrice" in copied[0], false);
  assert.equal(suggestedRelatedDirection("inbound_ask"), "outbound_ask");
  assert.equal(suggestedRelatedDirection("outbound_ask"), "inbound_response");
  assert.equal(suggestedRelationType("outbound_ask"), "forwarded_for_pricing");
  assert.equal(suggestedRelationType("inbound_response"), "response_to");
  assert.equal(relationPhrase("response_to", "from"), "Response to");
  assert.equal(relationPhrase("response_to", "to"), "Response from");
  assert.equal(relationPhrase("forwarded_for_pricing", "to"), "Forwarded as");
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
  assert.equal(quoteExtension("2", "10"), "$20.00");
  assert.equal(counterpartyLabel("Mainstream", "Joe"), "Mainstream (Joe)");
  assert.equal(counterpartyLabel("Mainstream", "mainstream"), "Mainstream");
});

test("saving a quote drops an empty line and warns when the due date is earlier", () => {
  const saved = parseQuoteSave({
    reference: "Joe list",
    counterpartyName: "",
    vendorId: "",
    channel: "whatsapp",
    direction: "inbound_ask",
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
        unitPrice: "",
        decision: "",
        decisionNote: "",
        bids: [{ key: "b", id: "", bidderName: "", unitPrice: "", note: "" }],
      },
      {
        key: "empty",
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
      },
    ],
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.deepEqual(saved.warnings, ["Due date is before the received date. You can still save."]);
  assert.equal(saved.value.currency, "USD");
  assert.equal(saved.value.lines.length, 1);
  assert.equal(saved.value.lines[0]?.partNumber, "ABC-1");
  assert.equal(saved.value.lines[0]?.bids.length, 0);

  const priced = parseQuoteSave({
    reference: "",
    counterpartyName: "",
    vendorId: "",
    channel: "email",
    direction: "outbound_offer",
    status: "bid_sent",
    receivedOn: "2026-11-03",
    dueOn: "",
    currency: "USD",
    notes: "",
    lines: [
      {
        key: "a",
        id: "",
        itemId: "",
        partNumber: "",
        sku: "",
        itemName: "",
        condition: "",
        qty: "2",
        unitPrice: "nope",
        decision: "bid",
        decisionNote: "",
        bids: [],
      },
    ],
  });
  assert.equal(priced.ok, false);
});

test("a related quote keeps the chosen direction and rejects a bad link type", () => {
  const parsed = parseRelatedQuote({
    sourceId: "11111111-1111-1111-1111-111111111111",
    reference: "Joe list",
    counterpartyName: "Tyler",
    vendorId: "",
    channel: "whatsapp",
    direction: "outbound_ask",
    receivedOn: "2026-11-03",
    dueOn: "",
    relationType: "forwarded_for_pricing",
    relationNote: "",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.direction, "outbound_ask");
  assert.equal(parsed.value.relationType, "forwarded_for_pricing");
  assert.equal(
    parseRelatedQuote({ ...{
      sourceId: "11111111-1111-1111-1111-111111111111",
      reference: "",
      counterpartyName: "",
      vendorId: "",
      channel: "email",
      direction: "inbound_ask",
      receivedOn: "2026-11-03",
      dueOn: "",
      relationType: "copied",
      relationNote: "",
    } }).ok,
    false,
  );
});

test("a missing quote_events table is recognized and another missing table is not", () => {
  assert.equal(
    quoteReviewsUnavailable({ code: "PGRST205", message: "Could not find the table 'public.quote_events' in the schema cache" }),
    true,
  );
  assert.equal(
    quoteReviewsUnavailable({ code: "PGRST205", message: "Could not find the table 'public.vendors' in the schema cache" }),
    false,
  );
});
