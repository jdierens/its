/**
 * eBay order cancellation, read from the Sell Fulfillment order payload.
 *
 * cancelStatus.cancelState is CANCELED, IN_PROGRESS, or NONE_REQUESTED.
 * CANCELED is eBay's spelling. getOrders always returns cancelState.
 * cancelRequests is empty on getOrders and filled by getOrder; a request
 * whose cancelRequestState is COMPLETED is a finished cancellation.
 * orderFulfillmentStatus is only NOT_STARTED, IN_PROGRESS, or FULFILLED.
 * It has no cancelled value.
 * orderPaymentStatus FULLY_REFUNDED covers a return or a cancellation.
 * A full refund of an order eBay never started shipping is a cancellation.
 * A full refund of a fulfilled order is a return and stays a return.
 */

import { readOrderFulfillmentSignal } from "@/lib/ebay/fulfillments";

export const EBAY_CANCEL_NOTE = "Cancelled on eBay";

/** getOrders `orderIds` accepts at most 50 ids and cannot be combined with a filter. */
export const EBAY_ORDER_ID_BATCH = 50;

/**
 * Statuses this pull may cancel. cancel_sales_order refuses only cancelled
 * and closed, so it would also cancel a shipped or invoiced order. Those stay
 * as they are.
 */
export const EBAY_CANCELLABLE_STATUSES = [
  "draft",
  "approved",
  "proforma_sent",
  "awaiting_payment",
  "released",
  "picking",
  "packing",
  "packed",
] as const;

/** Already shipped or billed. The pull logs these and does not cancel them. */
export const EBAY_CANCEL_SKIP_STATUSES = ["shipped", "partially_shipped", "invoiced"] as const;

const CANCEL_STATES = new Set(["CANCELED", "IN_PROGRESS", "NONE_REQUESTED"]);

export type EbayCancelState = "CANCELED" | "IN_PROGRESS" | "NONE_REQUESTED";

export type EbayCancelReason = "cancel-state" | "cancel-request" | "full-refund";

export type EbayCancelSignal = {
  cancelled: boolean;
  cancelState: EbayCancelState | null;
  reason: EbayCancelReason | null;
};

export type EbayCancelDecision = "cancel" | "skip-shipped" | "leave";

export function readEbayCancelSignal(order: object): EbayCancelSignal {
  const row = order as Record<string, unknown>;
  const status = row.cancelStatus;
  let cancelState: EbayCancelState | null = null;
  let completedRequest = false;
  if (status && typeof status === "object") {
    const raw = (status as { cancelState?: unknown }).cancelState;
    if (typeof raw === "string" && CANCEL_STATES.has(raw)) cancelState = raw as EbayCancelState;
    const requests = (status as { cancelRequests?: unknown }).cancelRequests;
    if (Array.isArray(requests)) {
      completedRequest = requests.some((entry) => {
        if (!entry || typeof entry !== "object") return false;
        return (entry as { cancelRequestState?: unknown }).cancelRequestState === "COMPLETED";
      });
    }
  }
  if (cancelState === "CANCELED") return { cancelled: true, cancelState, reason: "cancel-state" };
  if (completedRequest) return { cancelled: true, cancelState, reason: "cancel-request" };
  if (cancelState !== "IN_PROGRESS" && unfulfilledFullRefund(row)) {
    return { cancelled: true, cancelState, reason: "full-refund" };
  }
  return { cancelled: false, cancelState, reason: null };
}

function unfulfilledFullRefund(row: Record<string, unknown>): boolean {
  if (row.orderPaymentStatus !== "FULLY_REFUNDED") return false;
  const fulfillment = readOrderFulfillmentSignal(row);
  if (fulfillment.fulfillmentStatus !== "NOT_STARTED") return false;
  if (fulfillment.hasFulfillmentHrefs || fulfillment.lineItemShipped) return false;
  return true;
}

export function ebayCancelDecision(status: string): EbayCancelDecision {
  if ((EBAY_CANCELLABLE_STATUSES as readonly string[]).includes(status)) return "cancel";
  if ((EBAY_CANCEL_SKIP_STATUSES as readonly string[]).includes(status)) return "skip-shipped";
  return "leave";
}
