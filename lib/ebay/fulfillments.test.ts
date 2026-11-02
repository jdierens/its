import assert from "node:assert/strict";
import test from "node:test";
import {
  ebayOrderShipDate,
  ebayStatusAfterShipments,
  orderNeedsShippingFulfillment,
  parseShippingFulfillments,
  planEbayShipmentWrites,
  readOrderFulfillmentSignal,
  type StoredShipment,
} from "./fulfillments.ts";

const PULLED_AT = "2026-11-02T15:00:00.000Z";

const FULFILLMENTS = {
  fulfillments: [
    {
      fulfillmentId: "ful-1",
      shipmentTrackingNumber: "1Z 999",
      shippingCarrierCode: "UPS",
      shippedDate: "2026-10-26T18:04:00.000Z",
      lineItems: [{ lineItemId: "line-1", quantity: 1 }],
    },
    {
      fulfillmentId: "ful-2",
      trackingNumber: "940011189922385692",
      shippingCarrierCode: "USPS",
      shippedDate: "2026-10-27T01:00:00.000Z",
      lineItems: [{ lineItemId: "line-2", quantity: 2 }],
    },
    {
      fulfillmentId: "ful-blank",
      shippingCarrierCode: "FedEx",
      shippedDate: "2026-10-28T00:00:00.000Z",
    },
    {
      fulfillmentId: "ful-dup",
      shipmentTrackingNumber: "1z999",
      shippedDate: "2026-10-25T00:00:00.000Z",
    },
  ],
};

test("shipping fulfillments keep carrier, tracking, and ship date", () => {
  const parsed = parseShippingFulfillments(FULFILLMENTS);
  assert.deepEqual(parsed, [
    { fulfillmentId: "ful-1", trackingNumber: "1Z999", carrier: "UPS", shipDate: "2026-10-26" },
    { fulfillmentId: "ful-2", trackingNumber: "940011189922385692", carrier: "USPS", shipDate: "2026-10-27" },
    { fulfillmentId: "ful-dup", trackingNumber: "1z999", carrier: null, shipDate: "2026-10-25" },
  ]);
  assert.equal(parseShippingFulfillments({ fulfillments: "nope" }).length, 0);
  assert.equal(parseShippingFulfillments(null).length, 0);
});

test("a fulfilled order, a fulfillment link, or a shipped line is read", () => {
  const fulfilled = readOrderFulfillmentSignal({
    orderFulfillmentStatus: "FULFILLED",
    fulfillmentHrefs: ["https://api.ebay.com/sell/fulfillment/v1/order/12-03456-78901/shipping_fulfillment/1"],
  });
  assert.equal(orderNeedsShippingFulfillment(fulfilled), true);
  assert.equal(orderNeedsShippingFulfillment(readOrderFulfillmentSignal({ orderFulfillmentStatus: "IN_PROGRESS" })), true);
  assert.equal(orderNeedsShippingFulfillment(readOrderFulfillmentSignal({ orderFulfillmentStatus: "NOT_STARTED" })), false);
  assert.equal(
    orderNeedsShippingFulfillment(
      readOrderFulfillmentSignal({
        orderFulfillmentStatus: "NOT_STARTED",
        lineItems: [{ lineItemFulfillmentStatus: "FULFILLED" }],
      }),
    ),
    true,
  );
  assert.equal(orderNeedsShippingFulfillment({}), false);
});

test("the same tracking number is not inserted twice", () => {
  const incoming = parseShippingFulfillments(FULFILLMENTS);
  const first = planEbayShipmentWrites([], incoming, PULLED_AT);
  assert.deepEqual(
    first.map((row) => (row.kind === "insert" ? row.trackingNumber : row.id)),
    ["1Z999", "940011189922385692"],
  );
  const ups = first.find((row) => row.kind === "insert" && row.trackingNumber === "1Z999");
  assert.ok(ups && ups.kind === "insert");
  assert.equal(ups.carrier, "UPS");
  assert.equal(ups.shipDate, "2026-10-25");
  assert.equal(ups.ebayTrackingPushedAt, PULLED_AT);

  const stored: StoredShipment[] = first.flatMap((row) =>
    row.kind === "insert"
      ? [{ id: `id-${row.trackingNumber}`, awb: row.trackingNumber, carrier: row.carrier, shipDate: row.shipDate, ebayTrackingPushedAt: row.ebayTrackingPushedAt }]
      : [],
  );
  assert.deepEqual(planEbayShipmentWrites(stored, incoming, PULLED_AT), []);
});

test("an existing tracking row keeps its carrier and is marked already on eBay", () => {
  const existing: StoredShipment[] = [
    { id: "ship-1", awb: "1z999", carrier: "FedEx", shipDate: null, ebayTrackingPushedAt: null },
  ];
  const writes = planEbayShipmentWrites(existing, parseShippingFulfillments(FULFILLMENTS), PULLED_AT);
  assert.deepEqual(writes, [
    { kind: "update", id: "ship-1", shipDate: "2026-10-25", ebayTrackingPushedAt: PULLED_AT },
    {
      kind: "insert",
      trackingNumber: "940011189922385692",
      carrier: "USPS",
      shipDate: "2026-10-27",
      ebayTrackingPushedAt: PULLED_AT,
    },
  ]);
  const filled: StoredShipment[] = [
    { id: "ship-1", awb: "1z999", carrier: "FedEx", shipDate: "2026-10-25", ebayTrackingPushedAt: PULLED_AT },
    { id: "ship-2", awb: "940011189922385692", carrier: "USPS", shipDate: "2026-10-27", ebayTrackingPushedAt: PULLED_AT },
  ];
  assert.deepEqual(planEbayShipmentWrites(filled, parseShippingFulfillments(FULFILLMENTS), "2026-11-03T00:00:00.000Z"), []);
});

test("a blank carrier is filled and a blank sales-order ship date uses the earliest fulfillment", () => {
  const existing: StoredShipment[] = [{ id: "ship-1", awb: "1Z999", carrier: "  ", shipDate: null, ebayTrackingPushedAt: PULLED_AT }];
  assert.deepEqual(planEbayShipmentWrites(existing, parseShippingFulfillments(FULFILLMENTS), PULLED_AT), [
    { kind: "update", id: "ship-1", carrier: "UPS", shipDate: "2026-10-25" },
    {
      kind: "insert",
      trackingNumber: "940011189922385692",
      carrier: "USPS",
      shipDate: "2026-10-27",
      ebayTrackingPushedAt: PULLED_AT,
    },
  ]);
  assert.equal(ebayOrderShipDate(null, ["2026-10-27", "2026-10-25", null]), "2026-10-25");
  assert.equal(ebayOrderShipDate("2026-10-01", ["2026-10-25"]), null);
  assert.equal(ebayOrderShipDate(null, [null]), null);
});

test("approved orders with a ship date and tracking become shipped", () => {
  assert.equal(ebayStatusAfterShipments({ status: "approved", shipDate: "2026-10-26", hasTracking: true }), "shipped");
  assert.equal(ebayStatusAfterShipments({ status: "packed", shipDate: "2026-10-26", hasTracking: true }), "shipped");
  assert.equal(ebayStatusAfterShipments({ status: "picking", shipDate: "2026-10-26", hasTracking: true }), "shipped");
  assert.equal(ebayStatusAfterShipments({ status: "partially_shipped", shipDate: "2026-10-26", hasTracking: true }), "shipped");
  assert.equal(ebayStatusAfterShipments({ status: "approved", shipDate: "2026-10-26", hasTracking: false }), null);
  assert.equal(ebayStatusAfterShipments({ status: "approved", shipDate: null, hasTracking: true }), null);
  assert.equal(ebayStatusAfterShipments({ status: "draft", shipDate: "2026-10-26", hasTracking: true }), null);
  assert.equal(ebayStatusAfterShipments({ status: "cancelled", shipDate: "2026-10-26", hasTracking: true }), null);
  assert.equal(ebayStatusAfterShipments({ status: "shipped", shipDate: "2026-10-26", hasTracking: true }), null);
  assert.equal(ebayStatusAfterShipments({ status: "invoiced", shipDate: "2026-10-26", hasTracking: true }), null);
  assert.equal(ebayStatusAfterShipments({ status: "closed", shipDate: "2026-10-26", hasTracking: true }), null);
});
