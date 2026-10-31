import { LABEL_RESULT_CAP } from "@/lib/labelLookup";
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
  /** For-sale quantity. Damaged pieces are `damagedQty`, not this number. */
  qty: number;
  damagedQty?: number;
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
  /** For-sale quantity. Damaged pieces are not included. */
  qty: number;
  /** Damaged pieces still in an open bin. They do not count as on hand for sale. */
  damaged: number;
  /** Bins that hold the damaged quantity, in the same shape as `locations`. */
  damagedLocations: string;
  /** One bin per line, for example `(x14)10002-C · HWS.00.00.00` then `(x8)10037`. Empty when nothing is for sale. */
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

/** Damaged pieces on open cycles. They are tracked and are not for sale. */
export function inventoryDamaged(rows: readonly InventoryContentSource[]): { qty: number; locations: string } {
  return inventoryOnHand(
    rows
      .filter((row) => row.cycleOpen)
      .map((row) => ({
        reference: row.binReference,
        qty: Number(row.damagedQty ?? 0),
        locationCode: row.locationCode,
      })),
  );
}

/** Open-cycle rows only. A closed cycle is not on-hand. For-sale qty only. */
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

/** Query value for every match, including on-hand quantity 0. Absent means in stock only. */
export const INVENTORY_STOCK_PARAM = "stock";

export type InventoryStock = "in" | "all";

/**
 * Ranked matches scored for on-hand before the in-stock list is capped.
 * Wide enough that a zero-quantity match does not take a slot from one with stock.
 */
export const INVENTORY_ON_HAND_POOL = LABEL_RESULT_CAP * 8;

/** Missing, `in`, or any other value is in stock only. `all` keeps quantity 0. */
export function inventoryStockMode(value: string | null | undefined): InventoryStock {
  return value === "all" ? "all" : "in";
}

/** In stock scans the wider pool. All keeps the usual receiving cap. */
export function inventoryScanCap(stock: InventoryStock): number {
  return stock === "in" ? INVENTORY_ON_HAND_POOL : LABEL_RESULT_CAP;
}

/**
 * In stock keeps the On hand column (`qty` > 0), then the same cap as receiving Find.
 * All returns the matches already capped by that scan, including quantity 0.
 * `matched` is the count before this filter. `truncated` is true when more matches
 * may exist beyond the rows returned.
 */
export function applyInventoryStock(
  hits: readonly InventoryHit[],
  stock: InventoryStock,
  scanTruncated: boolean,
): { hits: InventoryHit[]; truncated: boolean; matched: number } {
  const matched = hits.length;
  if (stock !== "in") return { hits: [...hits], truncated: scanTruncated, matched };
  const onHand = hits.filter((hit) => hit.qty > 0);
  return {
    hits: onHand.slice(0, LABEL_RESULT_CAP),
    truncated: scanTruncated || onHand.length > LABEL_RESULT_CAP,
    matched,
  };
}

/** Keep the search ranking. An item with no open quantity stays, with qty 0. */
export function inventoryHits(
  matches: readonly InventoryMatch[],
  contents: readonly InventoryContentSource[],
): InventoryHit[] {
  const byItem = binsByItem(contents);
  return matches.map((match) => {
    const rows = contents.filter((row) => row.itemId.trim() === match.id);
    const onHand = inventoryOnHand(byItem.get(match.id) ?? []);
    const damaged = inventoryDamaged(rows);
    return {
      id: match.id,
      sku: match.sku,
      name: match.name,
      description: match.description,
      qty: onHand.qty,
      damaged: damaged.qty,
      damagedLocations: damaged.locations,
      locations: onHand.locations,
      empty: onHand.qty <= 0,
    };
  });
}
