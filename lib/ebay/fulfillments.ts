/**
 * eBay shipping fulfillments pulled into so_shipments.
 *
 * Inventory is not posted here. A pick is what moves stock. This module only
 * decides tracking rows, a blank sales-order ship date, and whether status
 * may become shipped. A draft stays a draft: it has no SO number yet.
 * Cancelled, invoiced, closed, and already shipped orders are left alone.
 */

export const EBAY_SHIPPABLE_STATUSES = [
  "approved",
  "proforma_sent",
  "awaiting_payment",
  "released",
  "picking",
  "packing",
  "packed",
  "partially_shipped",
] as const;

export type EbayOrderFulfillmentStatus = "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED";

export type OrderFulfillmentSignal = {
  fulfillmentStatus: EbayOrderFulfillmentStatus | null;
  hasFulfillmentHrefs: boolean;
  /** True when a line item is FULFILLED or IN_PROGRESS. */
  lineItemShipped: boolean;
};

export type ParsedEbayShipment = {
  fulfillmentId: string | null;
  trackingNumber: string;
  carrier: string | null;
  /** Calendar date from shippedDate, YYYY-MM-DD. */
  shipDate: string | null;
};

export type StoredShipment = {
  id: string;
  awb: string | null;
  carrier: string | null;
  shipDate: string | null;
  ebayTrackingPushedAt: string | null;
};

export type EbayShipmentWrite =
  | {
      kind: "insert";
      trackingNumber: string;
      carrier: string | null;
      shipDate: string | null;
      ebayTrackingPushedAt: string;
    }
  | {
      kind: "update";
      id: string;
      carrier?: string;
      shipDate?: string;
      ebayTrackingPushedAt?: string;
    };

const FULFILLMENT_STATUSES = new Set<EbayOrderFulfillmentStatus>(["NOT_STARTED", "IN_PROGRESS", "FULFILLED"]);
const SHIPPED_ORDER_STATUSES = new Set<EbayOrderFulfillmentStatus>(["IN_PROGRESS", "FULFILLED"]);
const LINE_SHIPPED = new Set(["IN_PROGRESS", "FULFILLED"]);

export function trackingKey(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export function storedTrackingNumber(value: string): string | null {
  const compact = value.trim().replace(/\s+/g, "");
  if (!compact) return null;
  return compact.slice(0, 80);
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function shippedDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== match[1]) return null;
  return match[1];
}

function earlierDate(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left <= right ? left : right;
}

export function readOrderFulfillmentSignal(order: object): OrderFulfillmentSignal {
  const row = order as Record<string, unknown>;
  const raw = row.orderFulfillmentStatus;
  const fulfillmentStatus = typeof raw === "string" && FULFILLMENT_STATUSES.has(raw as EbayOrderFulfillmentStatus)
    ? (raw as EbayOrderFulfillmentStatus)
    : null;
  const hrefs = Array.isArray(row.fulfillmentHrefs) ? row.fulfillmentHrefs : [];
  const hasFulfillmentHrefs = hrefs.some((href) => typeof href === "string" && href.trim() !== "");
  let lineItemShipped = false;
  if (Array.isArray(row.lineItems)) {
    for (const line of row.lineItems) {
      if (!line || typeof line !== "object") continue;
      const status = (line as { lineItemFulfillmentStatus?: unknown }).lineItemFulfillmentStatus;
      if (typeof status === "string" && LINE_SHIPPED.has(status)) {
        lineItemShipped = true;
        break;
      }
    }
  }
  return { fulfillmentStatus, hasFulfillmentHrefs, lineItemShipped };
}

export function orderNeedsShippingFulfillment(order: {
  fulfillmentStatus?: string | null;
  hasFulfillmentHrefs?: boolean;
  lineItemShipped?: boolean;
}): boolean {
  if (order.hasFulfillmentHrefs) return true;
  if (order.lineItemShipped) return true;
  return typeof order.fulfillmentStatus === "string" && SHIPPED_ORDER_STATUSES.has(order.fulfillmentStatus as EbayOrderFulfillmentStatus);
}

export function parseShippingFulfillments(body: unknown): ParsedEbayShipment[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as { fulfillments?: unknown }).fulfillments;
  if (!Array.isArray(raw)) return [];
  const out: ParsedEbayShipment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const trackingSource =
      typeof row.shipmentTrackingNumber === "string"
        ? row.shipmentTrackingNumber
        : typeof row.trackingNumber === "string"
          ? row.trackingNumber
          : "";
    const trackingNumber = storedTrackingNumber(trackingSource);
    if (!trackingNumber) continue;
    out.push({
      fulfillmentId: clean(row.fulfillmentId, 40),
      trackingNumber,
      carrier: clean(row.shippingCarrierCode, 40),
      shipDate: shippedDate(row.shippedDate),
    });
  }
  return out;
}

function mergedIncoming(rows: readonly ParsedEbayShipment[]): ParsedEbayShipment[] {
  const byKey = new Map<string, ParsedEbayShipment>();
  for (const row of rows) {
    const trackingNumber = storedTrackingNumber(row.trackingNumber);
    if (!trackingNumber) continue;
    const key = trackingKey(trackingNumber);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        fulfillmentId: row.fulfillmentId,
        trackingNumber,
        carrier: clean(row.carrier, 40),
        shipDate: shippedDate(row.shipDate),
      });
      continue;
    }
    byKey.set(key, {
      fulfillmentId: prev.fulfillmentId ?? row.fulfillmentId,
      trackingNumber: prev.trackingNumber,
      carrier: prev.carrier ?? clean(row.carrier, 40),
      shipDate: earlierDate(prev.shipDate, shippedDate(row.shipDate)),
    });
  }
  return [...byKey.values()];
}

function blank(value: string | null): boolean {
  return value == null || value.trim() === "";
}

/**
 * One write per tracking number. A second call with the same eBay rows and
 * the rows those writes would store returns nothing.
 * An existing carrier or ship date is kept. A blank one is filled.
 * ebay_tracking_pushed_at is set when it is empty so a later ITS-to-eBay
 * push skips tracking that already came from eBay.
 */
export function planEbayShipmentWrites(
  existing: readonly StoredShipment[],
  incoming: readonly ParsedEbayShipment[],
  pulledAt: string,
): EbayShipmentWrite[] {
  const writes: EbayShipmentWrite[] = [];
  const used = new Set<string>();
  for (const row of mergedIncoming(incoming)) {
    const key = trackingKey(row.trackingNumber);
    if (used.has(key)) continue;
    used.add(key);
    const match = existing.find((item) => item.awb != null && trackingKey(item.awb) === key);
    if (!match) {
      writes.push({
        kind: "insert",
        trackingNumber: row.trackingNumber,
        carrier: row.carrier,
        shipDate: row.shipDate,
        ebayTrackingPushedAt: pulledAt,
      });
      continue;
    }
    const update: Extract<EbayShipmentWrite, { kind: "update" }> = { kind: "update", id: match.id };
    if (blank(match.carrier) && row.carrier) update.carrier = row.carrier;
    if (blank(match.shipDate) && row.shipDate) update.shipDate = row.shipDate;
    if (blank(match.ebayTrackingPushedAt)) update.ebayTrackingPushedAt = pulledAt;
    if (update.carrier || update.shipDate || update.ebayTrackingPushedAt) writes.push(update);
  }
  return writes;
}

/** Earliest fulfillment or shipment date when the sales order has no ship date. */
export function ebayOrderShipDate(current: string | null, dates: readonly (string | null | undefined)[]): string | null {
  if (shippedDate(current)) return null;
  let chosen: string | null = null;
  for (const date of dates) {
    const parsed = shippedDate(date);
    if (!parsed) continue;
    chosen = earlierDate(chosen, parsed);
  }
  return chosen;
}

/**
 * Shipped when the order already has a ship date and tracking, and the
 * status is still before shipped. Draft is not in that list. This does not
 * post inventory; picking does.
 */
export function ebayStatusAfterShipments(input: {
  status: string;
  shipDate: string | null;
  hasTracking: boolean;
}): "shipped" | null {
  if (!input.hasTracking || !shippedDate(input.shipDate)) return null;
  if (!(EBAY_SHIPPABLE_STATUSES as readonly string[]).includes(input.status)) return null;
  return "shipped";
}
