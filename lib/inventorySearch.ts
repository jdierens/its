import { putawayLabel } from "@/lib/receivingSettings";

/** Shown when a match has no open-cycle quantity. The SKU still stays in the list. */
export const INVENTORY_NO_BINS = "no bins";

export type InventoryBinRow = {
  reference: string;
  qty: number;
  locationCode?: string | null;
};

export type InventoryBinQty = {
  reference: string;
  qty: number;
  locationCode: string | null;
};

export type InventoryContentSource = {
  itemId: string;
  qty: number;
  binReference: string;
  locationCode: string | null;
  cycleOpen: boolean;
};

export type InventoryMatch = {
  id: string;
  sku: string;
  name: string;
  description: string;
};

export type InventoryHit = {
  id: string;
  sku: string;
  name: string;
  description: string;
  qty: number;
  /** `(x14)10002-C · HWS.00.00.00 | (x8)10037`. Empty when nothing is on hand. */
  locations: string;
  empty: boolean;
};

/** One total per bin reference. A non-positive quantity is left out. Bins sort by reference. */
export function inventoryBinTotals(rows: readonly InventoryBinRow[]): InventoryBinQty[] {
  const byRef = new Map<string, InventoryBinQty>();
  for (const row of rows) {
    const reference = row.reference.trim();
    const qty = Number(row.qty);
    if (!reference || !Number.isFinite(qty) || qty <= 0) continue;
    const location = String(row.locationCode ?? "").trim() || null;
    const existing = byRef.get(reference);
    if (!existing) {
      byRef.set(reference, { reference, qty, locationCode: location });
      continue;
    }
    existing.qty += qty;
    if (!existing.locationCode && location) existing.locationCode = location;
  }
  return [...byRef.values()].sort((a, b) =>
    a.reference.localeCompare(b.reference, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** Receiving Summary putaway style, with the bin's location when it has one. */
export function formatInventoryBins(bins: readonly InventoryBinQty[]): string {
  return inventoryBinTotals(bins)
    .map((bin) => `(x${bin.qty})${putawayLabel(bin.reference, bin.locationCode)}`)
    .join(" | ");
}

export function inventoryOnHand(rows: readonly InventoryBinRow[]): { qty: number; locations: string } {
  const bins = inventoryBinTotals(rows);
  return {
    qty: bins.reduce((sum, bin) => sum + bin.qty, 0),
    locations: formatInventoryBins(bins),
  };
}

/** Open-cycle rows only. A closed cycle is not on-hand. */
export function binsByItem(rows: readonly InventoryContentSource[]): Map<string, InventoryBinRow[]> {
  const map = new Map<string, InventoryBinRow[]>();
  for (const row of rows) {
    if (!row.cycleOpen) continue;
    const itemId = row.itemId.trim();
    if (!itemId) continue;
    const list = map.get(itemId) ?? [];
    list.push({ reference: row.binReference, qty: row.qty, locationCode: row.locationCode });
    map.set(itemId, list);
  }
  return map;
}

/** Keep the search ranking. An item with no open quantity stays, with qty 0. */
export function inventoryHits(
  matches: readonly InventoryMatch[],
  contents: readonly InventoryContentSource[],
): InventoryHit[] {
  const byItem = binsByItem(contents);
  return matches.map((match) => {
    const onHand = inventoryOnHand(byItem.get(match.id) ?? []);
    return {
      id: match.id,
      sku: match.sku,
      name: match.name,
      description: match.description,
      qty: onHand.qty,
      locations: onHand.locations,
      empty: onHand.qty <= 0,
    };
  });
}
