import assert from "node:assert/strict";
import test from "node:test";
import {
  EBAY_CANCEL_NOTE,
  EBAY_CANCELLABLE_STATUSES,
  EBAY_CANCEL_SKIP_STATUSES,
  ebayCancelDecision,
  readEbayCancelSignal,
} from "./cancellations.ts";

const ORDER = "12-03456-78901";

function order(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderId: ORDER,
    orderFulfillmentStatus: "NOT_STARTED",
    orderPaymentStatus: "PAID",
    lineItems: [{ lineItemFulfillmentStatus: "NOT_STARTED" }],
    ...overrides,
  };
}

test("cancelState CANCELED is a cancelled order, including eBay's spelling", () => {
  const signal = readEbayCancelSignal(order({ cancelStatus: { cancelState: "CANCELED", cancelRequests: [] } }));
  assert.equal(signal.cancelled, true);
  assert.equal(signal.cancelState, "CANCELED");
  assert.equal(signal.reason, "cancel-state");
  assert.equal(readEbayCancelSignal(order({ cancelStatus: { cancelState: "IN_PROGRESS" } })).cancelled, false);
  assert.equal(readEbayCancelSignal(order({ cancelStatus: { cancelState: "NONE_REQUESTED" } })).cancelled, false);
  assert.equal(readEbayCancelSignal(order()).cancelled, false);
  assert.equal(readEbayCancelSignal(order({ cancelStatus: { cancelState: "CANCELLED" } })).cancelled, false);
});

test("a completed cancel request counts, and getOrders may leave that array empty", () => {
  const completed = readEbayCancelSignal(
    order({
      cancelStatus: {
        cancelState: "NONE_REQUESTED",
        cancelRequests: [{ cancelRequestId: "1", cancelRequestState: "COMPLETED" }],
      },
    }),
  );
  assert.equal(completed.cancelled, true);
  assert.equal(completed.reason, "cancel-request");
  assert.equal(
    readEbayCancelSignal(
      order({
        cancelStatus: {
          cancelState: "IN_PROGRESS",
          cancelRequests: [{ cancelRequestState: "REQUESTED" }],
        },
      }),
    ).cancelled,
    false,
  );
  assert.equal(
    readEbayCancelSignal(
      order({
        cancelStatus: {
          cancelState: "NONE_REQUESTED",
          cancelRequests: [{ cancelRequestState: "REJECTED" }],
        },
      }),
    ).cancelled,
    false,
  );
});

test("a full refund cancels only an order eBay never started shipping", () => {
  const unfulfilled = readEbayCancelSignal(
    order({
      orderPaymentStatus: "FULLY_REFUNDED",
      cancelStatus: { cancelState: "NONE_REQUESTED", cancelRequests: [] },
      orderFulfillmentStatus: "NOT_STARTED",
    }),
  );
  assert.equal(unfulfilled.cancelled, true);
  assert.equal(unfulfilled.reason, "full-refund");
  assert.equal(
    readEbayCancelSignal(
      order({
        orderPaymentStatus: "FULLY_REFUNDED",
        orderFulfillmentStatus: "FULFILLED",
        cancelStatus: { cancelState: "NONE_REQUESTED" },
        lineItems: [{ lineItemFulfillmentStatus: "FULFILLED" }],
      }),
    ).cancelled,
    false,
  );
  assert.equal(
    readEbayCancelSignal(
      order({
        orderPaymentStatus: "FULLY_REFUNDED",
        orderFulfillmentStatus: "NOT_STARTED",
        fulfillmentHrefs: ["https://api.ebay.com/sell/fulfillment/v1/order/12-03456-78901/shipping_fulfillment/1"],
      }),
    ).cancelled,
    false,
  );
  assert.equal(
    readEbayCancelSignal(
      order({
        orderPaymentStatus: "PARTIALLY_REFUNDED",
        orderFulfillmentStatus: "NOT_STARTED",
        cancelStatus: { cancelState: "NONE_REQUESTED" },
      }),
    ).cancelled,
    false,
  );
  assert.equal(
    readEbayCancelSignal(
      order({
        orderPaymentStatus: "FULLY_REFUNDED",
        orderFulfillmentStatus: "NOT_STARTED",
        cancelStatus: { cancelState: "IN_PROGRESS" },
      }),
    ).cancelled,
    false,
  );
});

test("open sales orders can be cancelled, and shipped or invoiced ones cannot", () => {
  for (const status of EBAY_CANCELLABLE_STATUSES) assert.equal(ebayCancelDecision(status), "cancel");
  for (const status of EBAY_CANCEL_SKIP_STATUSES) assert.equal(ebayCancelDecision(status), "skip-shipped");
  assert.equal(ebayCancelDecision("cancelled"), "leave");
  assert.equal(ebayCancelDecision("closed"), "leave");
  assert.equal(EBAY_CANCEL_NOTE, "Cancelled on eBay");
});
