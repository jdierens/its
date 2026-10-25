import assert from "node:assert/strict";
import test from "node:test";
import { ordersUrl } from "./endpoints.ts";
import {
  addLabelFees,
  allocateDiscount,
  applyLabelFees,
  draftLines,
  draftOrderRow,
  labelFeeFilter,
  orderPullWindows,
  parseFulfillmentOrders,
  parseLegacyLogCsv,
  planLegacySeed,
  planOrderPull,
  type ExistingPullOrder,
  type ExistingSeedOrder,
  type ParsedEbayOrder,
} from "./orderMap.ts";
import { allowFinancesNext, allowOrdersNext, readShippingLabelFees, runOrderPull, SeedRequiredError, watermarkForPriceRevision } from "./orders.ts";
import { financesTransactionsUrl } from "./endpoints.ts";
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
    shippingAmount: null,
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

test("unit and extended prices use the eBay discount amount, not a fixed 5 percent", () => {
  const parsed = parseFulfillmentOrders({
    orders: [
      {
        orderId: "20-15321-25072",
        salesRecordReference: "19283",
        creationDate: "2026-10-25T02:14:40.000Z",
        orderPaymentStatus: "PAID",
        pricingSummary: {
          priceSubtotal: { value: "6388.0", currency: "USD" },
          priceDiscount: { value: "-50.0", currency: "USD" },
          deliveryCost: { value: "12.79", currency: "USD" },
          total: { value: "6350.79", currency: "USD" },
        },
        totalMarketplaceFee: { value: "719.2", currency: "USD" },
        paymentSummary: {
          totalDueSeller: { value: "5631.59", currency: "USD" },
          payments: [{ paymentStatus: "PAID", paymentDate: "2026-10-25T02:14:40.000Z" }],
        },
        lineItems: [
          {
            sku: "106683(x2)",
            title: "Memory",
            quantity: 1,
            lineItemCost: { value: "6388.0", currency: "USD" },
            discountedLineItemCost: { value: "6338.0", currency: "USD" },
            total: { value: "6350.79", currency: "USD" },
            appliedPromotions: [{ description: "Extra 5% off with coupon", discountAmount: { value: "50.0", currency: "USD" } }],
          },
        ],
      },
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].salesRecordRef, "19283");
  assert.equal(parsed[0].lines[0].unitPrice, 6338);
  assert.equal(parsed[0].shippingAmount, 12.79);
  assert.equal(parsed[0].earnings, 5631.59);
  assert.equal(parsed[0].transactionFee, 719.2);
  const lines = draftLines(parsed[0], [null], "item-4343");
  assert.equal(lines[0].line_kind, "product");
  assert.equal(lines[0].unit_price, 6338);
  assert.equal(lines[0].ext_price, 6338);
  const [packed] = planOrderPull(
    [ebayOrder({ ebayOrderId: "20-15321-25072", lines: [{ sku: "106683(x2)", title: "Lot of 2", qty: 1, unitPrice: 6338 }] })],
    [],
    [{ id: "item-106683", sku: "106683" }],
  );
  assert.equal(packed.kind, "create");
  if (packed.kind === "create") {
    assert.equal(packed.order.lines[0].qty, 2);
    assert.equal(packed.order.lines[0].unitPrice, 3169);
    assert.equal(packed.itemIds[0], "item-106683");
    assert.equal(draftLines(packed.order, packed.itemIds)[0].ext_price, 6338);
  }
  assert.equal(Math.round(lines[0].qty * (lines[0].unit_price ?? 0) * 100) / 100, lines[0].ext_price);
  assert.equal(lines[1].line_kind, "freight");
  assert.equal(lines[1].customer_description, "Shipping");
  assert.equal(lines[1].qty, 1);
  assert.equal(lines[1].unit_price, 12.79);
  assert.equal(lines[1].ext_price, 12.79);
  assert.equal(lines[1].item_id, "item-4343");
  assert.notEqual(lines[0].ext_price, Math.round(6388 * 0.95 * 100) / 100);
  const row = draftOrderRow({ order: parsed[0], customerId: "customer-ebay", billTo: null });
  assert.equal(row.ebay_order_id, "20-15321-25072");
  assert.equal(row.ebay_sales_record_ref, "19283");
  assert.equal(row.ebay_order_earnings, 5631.59);
  assert.equal(row.ebay_label_fee, null);
});

test("a delivery discount reduces the shipping line, and a 5 percent coupon uses its amount", () => {
  const parsed = parseFulfillmentOrders({
    orders: [
      {
        orderId: "25-15004-67273",
        salesRecordReference: "1",
        creationDate: "2026-08-02T00:00:00.000Z",
        pricingSummary: {
          deliveryCost: { value: "87.9", currency: "USD" },
          deliveryDiscount: { value: "-43.11", currency: "USD" },
          priceDiscount: { value: "-50.0", currency: "USD" },
        },
        lineItems: [
          {
            sku: "PACK",
            title: "Modules",
            quantity: 10,
            lineItemCost: { value: "1488.8", currency: "USD" },
            discountedLineItemCost: { value: "1438.8", currency: "USD" },
            appliedPromotions: [{ description: "Extra 5% off with coupon", discountAmount: { value: "50.0", currency: "USD" } }],
          },
        ],
      },
    ],
  });
  assert.equal(parsed[0].shippingAmount, 44.79);
  assert.equal(parsed[0].lines[0].unitPrice, 143.88);
  const lines = draftLines(parsed[0], ["item-1"], "item-4343");
  assert.equal(lines[0].ext_price, 1438.8);
  assert.equal(lines[0].item_id, "item-1");
  assert.equal(lines[1].ext_price, 44.79);
  assert.equal(lines[1].item_id, "item-4343");
  assert.equal(lines[1].qty, 1);
  assert.equal(Math.round(lines[0].qty * (lines[0].unit_price ?? 0) * 100) / 100, lines[0].ext_price);
});

test("eBay shipping is allocated to item 4343 for the line quantity", () => {
  const [action] = planOrderPull(
    [ebayOrder({ shippingAmount: 12.79 })],
    [],
    [
      { id: "item-1", sku: "SKU-1" },
      { id: "item-ship", sku: "4343" },
    ],
  );
  assert.equal(action.kind, "create");
  if (action.kind !== "create") return;
  assert.equal(action.shippingItemId, "item-ship");
  const lines = draftLines(action.order, action.itemIds, action.shippingItemId);
  const freight = lines.find((line) => line.line_kind === "freight");
  assert.ok(freight);
  assert.equal(freight.qty, 1);
  assert.equal(freight.item_id, "item-ship");
  assert.equal(freight.customer_description, "Shipping");
  const [plain] = planOrderPull([ebayOrder()], [], [{ id: "item-ship", sku: "4343" }]);
  assert.equal(plain.kind, "create");
  if (plain.kind === "create") {
    assert.equal(plain.shippingItemId, "item-ship");
    assert.equal(draftLines(plain.order, plain.itemIds, plain.shippingItemId).some((line) => line.line_kind === "freight"), false);
  }
  const [missing] = planOrderPull([ebayOrder({ shippingAmount: 4 })], [], [{ id: "item-1", sku: "SKU-1" }]);
  assert.equal(missing.kind, "create");
  if (missing.kind === "create") assert.equal(missing.shippingItemId, null);
});

test("an order-level discount is applied when the line has no discounted cost", () => {
  const parsed = parseFulfillmentOrders({
    orders: [
      {
        orderId: "11-00001-00009",
        salesRecordReference: "9",
        creationDate: "2026-08-02T00:00:00.000Z",
        pricingSummary: { priceDiscount: { value: "-5.00", currency: "USD" } },
        lineItems: [{ sku: "SKU-9", title: "Board", quantity: 2, lineItemCost: { value: "100.00", currency: "USD" } }],
      },
    ],
  });
  assert.equal(parsed[0].lines[0].unitPrice, 47.5);
  assert.equal(draftLines(parsed[0], [null])[0].ext_price, 95);
  assert.deepEqual(allocateDiscount([60, 40], -25), [45, 30]);
});

test("shipping label debits net of credits, and the pull stores that fee without changing earnings", async () => {
  const fees = new Map<string, number>();
  addLabelFees(fees, {
    transactions: [
      { transactionType: "SALE", bookingEntry: "CREDIT", orderId: ORDER, amount: { value: "118.07", currency: "USD" } },
      { transactionType: "SHIPPING_LABEL", bookingEntry: "DEBIT", orderId: ORDER, amount: { value: "9.42", currency: "USD" } },
      { transactionType: "SHIPPING_LABEL", bookingEntry: "DEBIT", orderId: ORDER, amount: { value: "1.00", currency: "USD" } },
      { transactionType: "SHIPPING_LABEL", bookingEntry: "CREDIT", orderId: ORDER, amount: { value: "1.00", currency: "USD" } },
      { transactionType: "SHIPPING_LABEL", bookingEntry: "DEBIT", orderId: "not-an-order", amount: { value: "4.00", currency: "USD" } },
    ],
  });
  assert.equal(fees.get(ORDER), 9.42);
  assert.equal(fees.has("not-an-order"), false);
  const order = ebayOrder({ earnings: 5631.59 });
  applyLabelFees([order], fees);
  const row = draftOrderRow({ order, customerId: "customer-ebay", billTo: null });
  assert.equal(row.ebay_label_fee, 9.42);
  assert.equal(row.ebay_order_earnings, 5631.59);

  const read = await readShippingLabelFees({
    now: new Date("2026-10-25T00:00:00.000Z"),
    pageUrl: (offset) => financesTransactionsUrl("production", labelFeeFilter(new Date("2026-10-25T00:00:00.000Z")), 200, offset),
    allowNext: (url) => allowFinancesNext(url, "production"),
    fetchPage: async (url) => {
      if (url.includes("offset=0")) {
        assert.equal(url.includes("transactionType"), true);
        return {
          ok: true,
          body: {
            next: "https://apiz.ebay.com/sell/finances/v1/transaction?offset=200",
            transactions: [
              { transactionType: "SHIPPING_LABEL", bookingEntry: "DEBIT", orderId: "16-15324-63126", amount: { value: "9.42", currency: "USD" } },
            ],
          },
        };
      }
      return { ok: true, body: { transactions: [] } };
    },
  });
  assert.equal(read?.get("16-15324-63126"), 9.42);
  const denied = await readShippingLabelFees({
    now: new Date("2026-10-25T00:00:00.000Z"),
    pageUrl: () => "https://apiz.ebay.com/sell/finances/v1/transaction",
    allowNext: () => false,
    fetchPage: async () => ({ ok: false, status: 403, message: "denied" }),
  });
  assert.equal(denied, null);
  assert.equal(allowFinancesNext("https://apiz.ebay.com/sell/finances/v1/transaction?offset=200", "production"), true);
  assert.equal(allowFinancesNext("https://api.ebay.com/sell/finances/v1/transaction", "production"), false);
});

test("the first priced pull ignores the watermark so existing drafts can be rewritten", () => {
  assert.equal(watermarkForPriceRevision("2026-10-25T03:00:09.189Z", false), null);
  assert.equal(watermarkForPriceRevision("2026-10-25T03:00:09.189Z", true), "2026-10-25T03:00:09.189Z");
  assert.equal(watermarkForPriceRevision(null, true), null);
});

test("seed is required before history can create drafts", () => {
  const error = new SeedRequiredError();
  assert.equal(error.message, SEED_REQUIRED_MESSAGE);
});
