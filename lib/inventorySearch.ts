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
  /** One bin per line, for example `(x14)10002-C · HWS.00.00.00` then `(x8)10037`. Empty when nothing is on hand. */
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

/** Receiving Summary putaway style, one bin per line, with the bin's location when it has one. */
export function formatInventoryBins(bins: readonly InventoryBinQty[]): string {
  return inventoryBinTotals(bins)
    .map((bin) => `(x${bin.qty})${putawayLabel(bin.reference, bin.locationCode)}`)
    .join("\n");
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

export type InventorySortKey = "sku" | "item" | "qty" | "bins";

export type InventorySortDir = "asc" | "desc";

export type InventorySort = {
  key: InventorySortKey;
  dir: InventorySortDir;
};

const INVENTORY_SORT_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

/**
 * Bins column sort key. Each line drops the `(xqty)` prefix so the column sorts by
 * bin reference and location, not by the quantity painted on the line. The cell is
 * already one bin per line in reference order, so the first line leads and later
 * lines break ties. An empty match sorts as the visible label `no bins`.
 */
export function inventoryBinsSortLabel(hit: InventoryHit): string {
  if (hit.empty) return INVENTORY_NO_BINS;
  return hit.locations.replace(/^\(x\d+(?:\.\d+)?\)/gm, "");
}

/** First click on a heading sorts ascending. Another click on it swaps direction. */
export function toggleInventorySort(current: InventorySort | null, key: InventorySortKey): InventorySort {
  if (current?.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: "asc" };
}

function compareInventoryText(left: string, right: string): number {
  return left.localeCompare(right, "en", INVENTORY_SORT_OPTIONS);
}

/** Item sorts by name, then description. A blank name stays blank (the em dash is only display). */
export function compareInventoryHits(left: InventoryHit, right: InventoryHit, key: InventorySortKey): number {
  switch (key) {
    case "sku":
      return compareInventoryText(left.sku.trim(), right.sku.trim());
    case "item": {
      const name = compareInventoryText(left.name.trim(), right.name.trim());
      if (name !== 0) return name;
      return compareInventoryText(left.description.trim(), right.description.trim());
    }
    case "qty":
      return left.qty - right.qty;
    case "bins":
      return compareInventoryText(inventoryBinsSortLabel(left), inventoryBinsSortLabel(right));
  }
}

/**
 * Sort the rows already returned for this search. Equal values keep search order
 * (an exact SKU stays ahead of a tie). No sort leaves that order unchanged.
 */
export function sortInventoryHits(hits: readonly InventoryHit[], sort: InventorySort | null): InventoryHit[] {
  if (!sort) return [...hits];
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...hits].sort((left, right) => factor * compareInventoryHits(left, right, sort.key));
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
