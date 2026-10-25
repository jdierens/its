import assert from "node:assert/strict";
import test from "node:test";
import { ordersUrl } from "./endpoints.ts";
import {
  draftLines,
  draftOrderRow,
  orderPullWindows,
  parseFulfillmentOrders,
  parseLegacyLogCsv,
  planLegacySeed,
  planOrderPull,
  type ExistingPullOrder,
  type ExistingSeedOrder,
  type ParsedEbayOrder,
} from "./orderMap.ts";
import { allowOrdersNext, runOrderPull, SeedRequiredError } from "./orders.ts";
import { SEED_REQUIRED_MESSAGE } from "./orderMap.ts";

const ORDER = "12-03456-78901";

function ebayOrder(overrides: Partial<ParsedEbayOrder> = {}): ParsedEbayOrder {
  return {
    ebayOrderId: ORDER,
    salesRecordRef: "445566",
    buyer: { username: "buyer_one", name: "Ada Buyer", email: "ada@example.com", phone: "555-0100" },
    shipTo: {
      line1: "1 Main",
      line2: "",
      city: "Austin",
      countrySubDivisionCode: "TX",
      postalCode: "78701",
      country: "US",
      attention: "Ada Buyer",
      phone: "555-0100",
    },
    orderDate: "2026-10-20",
    currency: "USD",
    paymentStatus: "paid",
    paymentDate: "2026-10-20",
    transactionFee: 1.25,
    earnings: 8.75,
    lines: [{ sku: "SKU-1", title: "Memory", qty: 2, unitPrice: 5 }],
    ...overrides,
  };
}

test("legacy log rows keep eBay order ids and the SO number", () => {
  const csv = [
    "notes,next number",
    "REF,Order Number,Sales Record No,Customer",
    "SO#27254,12-03456-78901,445566,Someone",
    "SO#27255-01,12-03456-78902,call Jan,Someone else",
    "PO#6100,not-an-order,1,Vendor",
    'SO#27256,"99-00001-00002","7788","Quoted, name"',
  ].join("\n");
  assert.deepEqual(parseLegacyLogCsv(csv), [
    { soNumber: 27254, ebayOrderId: "12-03456-78901", salesRecordRef: "445566" },
    { soNumber: 27255, ebayOrderId: "12-03456-78902", salesRecordRef: null },
    { soNumber: 27256, ebayOrderId: "99-00001-00002", salesRecordRef: "7788" },
  ]);
});

test("seed links the lowest SO and does not invent orders", () => {
  const existing: ExistingSeedOrder[] = [
    { id: "so-low", soNumber: 100, ebayOrderId: null, ebaySalesRecordRef: null },
    { id: "so-high", soNumber: 101, ebayOrderId: null, ebaySalesRecordRef: null },
    { id: "so-same", soNumber: 102, ebayOrderId: "22-00001-00001", ebaySalesRecordRef: "9" },
    { id: "so-filled", soNumber: 103, ebayOrderId: "33-00001-00001", ebaySalesRecordRef: null },
  ];
  const plan = planLegacySeed(
    [
      { soNumber: 100, ebayOrderId: "11-00001-00001", salesRecordRef: "50" },
      { soNumber: 101, ebayOrderId: "11-00001-00001", salesRecordRef: "50" },
      { soNumber: 102, ebayOrderId: "22-00001-00001", salesRecordRef: "9" },
      { soNumber: 104, ebayOrderId: "44-00001-00001", salesRecordRef: "1" },
      { soNumber: 103, ebayOrderId: "55-00001-00001", salesRecordRef: "2" },
      { soNumber: 103, ebayOrderId: "33-00001-00001", salesRecordRef: "77" },
    ],
    existing,
  );
  assert.deepEqual(plan.updates, [
    { id: "so-low", ebayOrderId: "11-00001-00001", salesRecordRef: "50" },
    { id: "so-filled", ebayOrderId: "33-00001-00001", salesRecordRef: "77" },
  ]);
  assert.equal(plan.linked, 2);
  assert.equal(plan.skipped, 1);
  assert.equal(plan.missing, 1);
  assert.equal(plan.conflicts, 2);
});

test("a paid eBay order becomes an unnumbered draft under the given customer", () => {
  const order = ebayOrder();
  const [action] = planOrderPull([order], [], [{ id: "item-1", sku: "SKU-1" }]);
  assert.equal(action.kind, "create");
  if (action.kind !== "create") return;
  const row = draftOrderRow({ order: action.order, customerId: "customer-ebay", billTo: null });
  assert.equal(row.status, "draft");
  assert.equal(row.so_number, null);
  assert.equal(row.approved_at, null);
  assert.equal(row.customer_id, "customer-ebay");
  assert.equal(row.operator_id, null);
  assert.equal(row.source, "ebay");
  assert.equal(row.ebay_order_id, ORDER);
  assert.deepEqual(action.itemIds, ["item-1"]);
  const lines = draftLines(action.order, action.itemIds);
  assert.equal(lines[0].item_id, "item-1");
  assert.equal(lines[0].ext_price, 10);
});

test("an existing eBay order id or sales record is not drafted again", () => {
  const existing: ExistingPullOrder[] = [
    { id: "draft-1", status: "draft", ebayOrderId: ORDER, ebaySalesRecordRef: null, personEdited: false },
    { id: "approved-1", status: "shipped", ebayOrderId: null, ebaySalesRecordRef: "700", personEdited: true },
    { id: "edited-1", status: "draft", ebayOrderId: "13-00001-00001", ebaySalesRecordRef: "701", personEdited: true },
    { id: "one", status: "approved", ebayOrderId: null, ebaySalesRecordRef: "800", personEdited: false },
    { id: "two", status: "approved", ebayOrderId: null, ebaySalesRecordRef: "800", personEdited: false },
  ];
  const actions = planOrderPull(
    [
      ebayOrder(),
      ebayOrder({ ebayOrderId: "12-03456-78902", salesRecordRef: "700" }),
      ebayOrder({ ebayOrderId: "13-00001-00001", salesRecordRef: "701" }),
      ebayOrder({ ebayOrderId: "14-00001-00001", salesRecordRef: "800", lines: [{ sku: "MISSING", title: "Loose", qty: 1, unitPrice: null }] }),
      ebayOrder({ ebayOrderId: ORDER }),
    ],
    existing,
    [],
  );
  assert.deepEqual(
    actions.map((action) => action.kind),
    ["update", "link", "skip", "skip", "skip"],
  );
  assert.equal(actions[1].kind === "link" && actions[1].id, "approved-1");
  assert.equal(actions[3].kind, "skip");
  const fresh = planOrderPull(
    [ebayOrder({ ebayOrderId: "15-00001-00001", salesRecordRef: null, lines: [{ sku: "NOPE", title: null, qty: 1, unitPrice: null }] })],
    [],
    [],
  );
  assert.equal(fresh[0].kind, "create");
  if (fresh[0].kind === "create") {
    assert.deepEqual(fresh[0].itemIds, [null]);
    assert.equal(draftLines(fresh[0].order, fresh[0].itemIds)[0].customer_part_number, "NOPE");
    assert.equal(draftLines(fresh[0].order, fresh[0].itemIds)[0].customer_description, null);
  }
});

test("fulfillment orders drop tax identifiers and keep the buyer on the order", () => {
  const parsed = parseFulfillmentOrders({
    orders: [
      {
        orderId: ORDER,
        salesRecordReference: "445566",
        creationDate: "2026-10-20T15:00:00.000Z",
        orderPaymentStatus: "PAID",
        buyer: { username: "buyer_one", taxIdentifier: { taxpayerId: "SECRET-TAX" } },
        pricingSummary: { total: { value: "10.00", currency: "USD" } },
        totalMarketplaceFee: { value: "1.25", currency: "USD" },
        paymentSummary: {
          totalDueSeller: { value: "8.75", currency: "USD" },
          payments: [{ paymentStatus: "PAID", paymentDate: "2026-10-20T16:00:00.000Z" }],
        },
        fulfillmentStartInstructions: [
          {
            shippingStep: {
              shipTo: {
                fullName: "Ada Buyer",
                email: "ada@example.com",
                primaryPhone: { phoneNumber: "555-0100" },
                contactAddress: {
                  addressLine1: "1 Main",
                  city: "Austin",
                  stateOrProvince: "TX",
                  postalCode: "78701",
                  countryCode: "US",
                },
              },
            },
          },
        ],
        lineItems: [{ sku: "SKU-1", title: "Memory", quantity: 2, lineItemCost: { value: "10.00", currency: "USD" } }],
      },
      { orderId: "not-an-id", lineItems: [] },
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(JSON.stringify(parsed).includes("SECRET-TAX"), false);
  assert.equal(parsed[0].buyer.username, "buyer_one");
  assert.equal(parsed[0].buyer.name, "Ada Buyer");
  assert.equal(parsed[0].shipTo.line1, "1 Main");
  assert.equal(parsed[0].paymentStatus, "paid");
  assert.equal(parsed[0].lines[0].unitPrice, 5);
  const row = draftOrderRow({ order: parsed[0], customerId: "customer-ebay", billTo: null });
  assert.equal(row.status, "draft");
  assert.equal(row.so_number, null);
});

test("the pull starts on 1 Jan 2026 and a watermark stays inside that window", () => {
  const now = new Date("2026-10-25T00:00:00.000Z");
  const history = orderPullWindows(now, null);
  assert.ok(history.length > 1);
  assert.ok(history.every((window) => window.history && window.filter.startsWith("creationdate:[2026-")));
  assert.equal(history[0].filter.startsWith("creationdate:[2026-01-01T00:00:00.000Z.."), true);
  assert.equal(history.some((window) => window.filter.includes("2025-")), false);
  assert.deepEqual(orderPullWindows(new Date("2025-12-31T00:00:00.000Z"), null), []);
  const next = orderPullWindows(now, "2026-10-20T00:00:00.000Z");
  assert.deepEqual(next, [
    {
      filter:
        "creationdate:[2026-01-01T00:00:00.000Z..2026-10-25T00:00:00.000Z],lastmodifieddate:[2026-10-19T00:00:00.000Z..2026-10-25T00:00:00.000Z]",
      history: false,
    },
  ]);
});

test("orders before 2026 are skipped and a seeded 2026 order is not drafted again", () => {
  const actions = planOrderPull(
    [
      ebayOrder({ ebayOrderId: "10-00001-00001", orderDate: "2025-12-31", salesRecordRef: "100" }),
      ebayOrder({ ebayOrderId: "11-00001-00001", orderDate: "2026-01-01", salesRecordRef: "101" }),
      ebayOrder({ ebayOrderId: "12-00001-00009", orderDate: "2026-01-01", salesRecordRef: null, lines: [] }),
      ebayOrder({ orderDate: null }),
    ],
    [{ id: "seeded", status: "shipped", ebayOrderId: "11-00001-00001", ebaySalesRecordRef: "101", personEdited: true }],
    [],
  );
  assert.deepEqual(
    actions.map((action) => (action.kind === "skip" ? action.reason : action.kind)),
    ["before-cutoff", "unchanged", "create", "before-cutoff"],
  );
});

test("order reads stay on the eBay fulfillment host", () => {
  const url = ordersUrl("production", "creationdate:[2026-01-01T00:00:00.000Z..2026-04-01T00:00:00.000Z]", 200, 0);
  assert.equal(url.startsWith("https://api.ebay.com/sell/fulfillment/v1/order?"), true);
  assert.equal(allowOrdersNext("https://api.ebay.com/sell/fulfillment/v1/order?offset=200", "production"), true);
  assert.equal(allowOrdersNext("https://evil.example/sell/fulfillment/v1/order", "production"), false);
  assert.equal(allowOrdersNext("https://api.sandbox.ebay.com/sell/fulfillment/v1/order", "production"), false);
});

test("a pull creates one draft and links an order that already has the sales record", async () => {
  const created: Record<string, unknown>[] = [];
  const linked: string[] = [];
  const result = await runOrderPull({
    now: new Date("2026-10-25T00:00:00.000Z"),
    watermark: "2026-10-20T00:00:00.000Z",
    customer: { id: "customer-ebay", billTo: null },
    pageUrl: (filter, offset) => `https://api.ebay.com/orders?filter=${encodeURIComponent(filter)}&offset=${offset}`,
    allowNext: () => false,
    fetchPage: async () => ({
      body: {
        orders: [
          {
            orderId: ORDER,
            salesRecordReference: "445566",
            creationDate: "2026-10-24T00:00:00.000Z",
            orderPaymentStatus: "PAID",
            buyer: { username: "buyer_one" },
            lineItems: [{ sku: "SKU-1", title: "Memory", quantity: 1, lineItemCost: { value: "5.00", currency: "USD" } }],
          },
          {
            orderId: "16-00001-00001",
            salesRecordReference: "900",
            creationDate: "2026-10-24T00:00:00.000Z",
            orderPaymentStatus: "PENDING",
            lineItems: [],
          },
        ],
      },
      rlogid: "rlog",
      requestId: "req",
    }),
    store: {
      async existing() {
        return [{ id: "approved-9", status: "shipped", ebayOrderId: null, ebaySalesRecordRef: "900", personEdited: true }];
      },
      async itemsForSkus() {
        return [{ id: "item-1", sku: "SKU-1" }];
      },
      async apply(actions, customer) {
        for (const action of actions) {
          if (action.kind === "create") {
            const row = draftOrderRow({ order: action.order, customerId: customer.id, billTo: customer.billTo });
            assert.equal(row.so_number, null);
            assert.equal(row.status, "draft");
            created.push(row);
          }
          if (action.kind === "link") linked.push(action.id);
        }
        return { created: created.length, updated: 0, linked: linked.length };
      },
      async setWatermark(iso) {
        assert.equal(iso, "2026-10-25T00:00:00.000Z");
      },
    },
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].customer_id, "customer-ebay");
  assert.deepEqual(linked, ["approved-9"]);
  assert.equal(result.created, 1);
  assert.equal(result.linked, 1);
  assert.equal(result.history, false);
});

test("seed is required before history can create drafts", () => {
  const error = new SeedRequiredError();
  assert.equal(error.message, SEED_REQUIRED_MESSAGE);
});
