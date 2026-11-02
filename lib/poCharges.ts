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

/** UPS, FedEx, USPS, or DHL, including a service written after the name. */
function parcelCarrier(carrier: string): "UPS" | "FedEx" | "USPS" | "DHL" | null {
  const key = carrier.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!key) return null;
  if (key === "usps" || key.startsWith("usps ")) return "USPS";
  if (key === "ups" || key.startsWith("ups ")) return "UPS";
  if (key === "fedex" || key === "federal express" || key.startsWith("fedex ") || key.startsWith("federal express ")) return "FedEx";
  if (key === "dhl" || key.startsWith("dhl ")) return "DHL";
  return null;
}

export function trackingUrl(carrier: string, trackingNumber: string): string | null {
  const number = encodeURIComponent(trackingNumber.trim());
  if (!number) return null;
  const parcel = parcelCarrier(carrier);
  if (parcel === "UPS") return `https://www.ups.com/track?tracknum=${number}`;
  if (parcel === "FedEx") return `https://www.fedex.com/fedextrack/?trknbr=${number}`;
  if (parcel === "USPS") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`;
  if (parcel === "DHL") return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${number}`;
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
