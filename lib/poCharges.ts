export const SHIPMENT_CARRIERS = ["UPS", "FedEx", "USPS", "DHL", "Freight", "Other"] as const;

export type ShipmentCarrier = (typeof SHIPMENT_CARRIERS)[number];

export type ShipmentInput = {
  carrier: string;
  trackingNumber: string;
};

export type NormalizedShipment = {
  carrier: ShipmentCarrier;
  trackingNumber: string;
};

const CARRIERS = new Set<string>(SHIPMENT_CARRIERS);

export function trackingUrl(carrier: string, trackingNumber: string): string | null {
  const number = encodeURIComponent(trackingNumber.trim());
  if (!number) return null;
  if (carrier === "UPS") return `https://www.ups.com/track?tracknum=${number}`;
  if (carrier === "FedEx") return `https://www.fedex.com/fedextrack/?trknbr=${number}`;
  if (carrier === "USPS") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`;
  if (carrier === "DHL") return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${number}`;
  return null;
}

export function parseFreightIn(value: string): number | null | "invalid" {
  const trimmed = value.trim().replace(/[$,]/g, "");
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return "invalid";
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount > 9999999999.99) return "invalid";
  return amount;
}

export function normalizeShipments(
  rows: ShipmentInput[],
): { ok: true; value: NormalizedShipment[] } | { ok: false; error: string } {
  const shipments: NormalizedShipment[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const trackingNumber = row.trackingNumber.trim().replace(/\s+/g, "");
    const carrier = row.carrier.trim();
    if (!trackingNumber && !carrier) continue;
    if (!CARRIERS.has(carrier)) return { ok: false, error: "Choose a carrier." };
    if (!trackingNumber) return { ok: false, error: "Each shipment needs a tracking number." };
    if (trackingNumber.length > 40) return { ok: false, error: "A tracking number is too long." };
    const key = `${carrier}:${trackingNumber.toUpperCase()}`;
    if (seen.has(key)) return { ok: false, error: "That tracking number is already on this order." };
    seen.add(key);
    shipments.push({ carrier: carrier as ShipmentCarrier, trackingNumber });
  }
  if (shipments.length > 20) return { ok: false, error: "A purchase order can have at most 20 shipments." };
  return { ok: true, value: shipments };
}
