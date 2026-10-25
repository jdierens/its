export type PackLabel = {
  baseSku: string;
  packQty: number;
};

export type SkuAssignment = {
  itemId: string | null;
  packQty: number;
  baseSku: string | null;
};

export type KitEdge = {
  kitItemId: string;
  componentItemId: string;
  qtyPerKit: number;
};

export type DirectListing = {
  ebayItemId: string;
  packQty: number;
};

export type KitListingUse = {
  ebayItemId: string;
  kitItemId: string;
  kitSku: string;
  packQty: number;
  qty: number;
};

export type ItemEbayView = {
  direct: DirectListing[];
  kits: KitListingUse[];
};

/** Suffix forms, first match wins. Hyphen packs stay valid for listings already stored that way. */
const PACK_LABELS = [
  /^(.+)_([1-9]\d*)pk$/i,
  /^(.+)\(x([1-9]\d*)\)$/i,
  /^(.+)-([1-9]\d*)pk$/i,
];

export function parsePackLabel(label: string): PackLabel | null {
  const trimmed = label.trim();
  for (const pattern of PACK_LABELS) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const baseSku = match[1]?.trim() ?? "";
    const packQty = Number(match[2]);
    if (!baseSku || !/[A-Za-z0-9]/.test(baseSku) || !Number.isSafeInteger(packQty) || packQty < 1) continue;
    return { baseSku, packQty };
  }
  return null;
}

/**
 * Piece count for a pack label.
 * eBay's line quantity is how many packs were bought. `106683(x2)` with quantity 1 is 2 pieces.
 * A quantity that is already at least one pack and divides evenly is left alone, so applying
 * the same label again does not multiply a second time.
 */
export function pieceQtyForPack(lineQty: number, packQty: number): number {
  if (!Number.isInteger(packQty) || packQty <= 1) return lineQty;
  if (!Number.isFinite(lineQty) || lineQty <= 0) return lineQty;
  const qtyMillis = Math.round(lineQty * 1000);
  const packMillis = packQty * 1000;
  if (qtyMillis >= packMillis && qtyMillis % packMillis === 0) return lineQty;
  const pieces = Math.round(lineQty * packQty * 1000) / 1000;
  return Number.isFinite(pieces) && pieces > 0 ? pieces : lineQty;
}

/** Pieces to allocate. Customer qty stays as entered. A 2-pack with quantity 1 allocates 2. */
export function allocationQtyForLine(part: string, lineQty: number): number {
  if (!Number.isFinite(lineQty) || lineQty <= 0) return lineQty;
  const pack = parsePackLabel(part);
  if (!pack || pack.packQty <= 1) return lineQty;
  const pieces = Math.round(lineQty * pack.packQty * 1000) / 1000;
  return Number.isFinite(pieces) && pieces > 0 ? pieces : lineQty;
}

export function formatAllocationQty(qty: number): string {
  if (!Number.isFinite(qty)) return "";
  if (Number.isInteger(qty)) return String(qty);
  return String(Math.round(qty * 1000) / 1000);
}

export type CleanSkuHit = { id: string; sku: string; name: string };

function uniqueSku<T extends { id: string; sku: string }>(hits: readonly T[], sku: string): T | null {
  const wanted = sku.trim().toLowerCase();
  if (!wanted) return null;
  const matches = hits.filter((hit) => hit.id && hit.sku.trim().toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * An exact ITS SKU, or a pack label whose base SKU is exactly one item.
 * `106683_2PK` with customer quantity 1 allocates item `106683` quantity 2.
 * A label that is itself an item allocates the customer quantity.
 * A fuzzy part-number hit is not a match.
 */
export function cleanSkuAllocation(
  part: string,
  lineQty: string,
  hits: readonly CleanSkuHit[],
): { itemId: string; sku: string; name: string; qty: string } | null {
  const label = part.trim();
  if (!label) return null;
  const qtyNumber = Number(lineQty);
  if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) return null;
  const exact = uniqueSku(hits, label);
  if (exact) {
    return { itemId: exact.id, sku: exact.sku, name: exact.name, qty: formatAllocationQty(qtyNumber) };
  }
  const pack = parsePackLabel(label);
  if (!pack) return null;
  const base = uniqueSku(hits, pack.baseSku);
  if (!base) return null;
  return {
    itemId: base.id,
    sku: base.sku,
    name: base.name,
    qty: formatAllocationQty(allocationQtyForLine(label, qtyNumber)),
  };
}

/**
 * What Customer PN blur and Find SKU do with a pack label.
 * `106683_2PK` with quantity 1 and unit 6338 stays 1 × 6338.
 * The search is ITS SKU `106683`, and the allocation quantity is 2.
 */
export function applyPackToLine(input: { part: string; qty: string; unitPrice: string }): {
  search: string;
  qty: string;
  unitPrice: string;
  packQty: number | null;
  allocationQty: string | null;
} {
  const pack = parsePackLabel(input.part);
  const search = (pack?.baseSku ?? input.part).trim();
  if (!pack) return { search, qty: input.qty, unitPrice: input.unitPrice, packQty: null, allocationQty: null };
  const qty = Number(input.qty);
  const pieces = allocationQtyForLine(input.part, Number.isFinite(qty) ? qty : 0);
  return {
    search,
    qty: input.qty,
    unitPrice: input.unitPrice,
    packQty: pack.packQty,
    allocationQty: qty > 0 ? formatAllocationQty(pieces) : null,
  };
}

export function resolveSkuMap(wanted: readonly string[], items: readonly { id: string; sku: string }[]): Map<string, string> {
  const exact = new Map<string, string>();
  const folded = new Map<string, { id: string; count: number }>();
  for (const item of items) {
    const sku = item.sku.trim();
    if (!sku || !item.id) continue;
    if (!exact.has(sku)) exact.set(sku, item.id);
    const key = sku.toLowerCase();
    const previous = folded.get(key);
    if (!previous) folded.set(key, { id: item.id, count: 1 });
    else if (previous.id !== item.id) folded.set(key, { id: previous.id, count: previous.count + 1 });
  }
  const matched = new Map<string, string>();
  for (const raw of wanted) {
    const sku = raw.trim();
    if (!sku || matched.has(sku)) continue;
    const exactId = exact.get(sku);
    if (exactId) {
      matched.set(sku, exactId);
      continue;
    }
    const loose = folded.get(sku.toLowerCase());
    if (loose && loose.count === 1) matched.set(sku, loose.id);
  }
  return matched;
}

export function assignListingSku(label: string | null, items: readonly { id: string; sku: string }[]): SkuAssignment {
  const sku = label?.trim() ?? "";
  if (!sku) return { itemId: null, packQty: 1, baseSku: null };
  const exact = resolveSkuMap([sku], items).get(sku);
  if (exact) return { itemId: exact, packQty: 1, baseSku: null };
  const pack = parsePackLabel(sku);
  if (!pack) return { itemId: null, packQty: 1, baseSku: null };
  const baseId = resolveSkuMap([pack.baseSku], items).get(pack.baseSku) ?? null;
  return { itemId: baseId, packQty: pack.packQty, baseSku: pack.baseSku };
}

export function packMark(packQty: number, always = false): string | null {
  if (!Number.isSafeInteger(packQty) || packQty < 1) return null;
  if (!always && packQty === 1) return null;
  return `${packQty}x`;
}

export function kitListingLabel(count: number): string {
  return count === 1 ? "in 1 kit listing" : `in ${count} kit listings`;
}

export function componentQtyInKits(componentId: string, edges: readonly KitEdge[]): Map<string, number> {
  const parents = new Map<string, KitEdge[]>();
  for (const edge of edges) {
    if (!edge.kitItemId || !edge.componentItemId) continue;
    if (!Number.isSafeInteger(edge.qtyPerKit) || edge.qtyPerKit < 1) continue;
    const list = parents.get(edge.componentItemId) ?? [];
    list.push(edge);
    parents.set(edge.componentItemId, list);
  }
  const totals = new Map<string, number>();
  const queue: { id: string; qty: number; seen: string[] }[] = [{ id: componentId, qty: 1, seen: [componentId] }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const edge of parents.get(current.id) ?? []) {
      if (current.seen.includes(edge.kitItemId)) continue;
      const qty = current.qty * edge.qtyPerKit;
      if (!Number.isSafeInteger(qty)) continue;
      totals.set(edge.kitItemId, (totals.get(edge.kitItemId) ?? 0) + qty);
      queue.push({ id: edge.kitItemId, qty, seen: [...current.seen, edge.kitItemId] });
    }
  }
  return totals;
}

export function kitListingUses(input: {
  componentId: string;
  edges: readonly KitEdge[];
  listings: readonly { ebayItemId: string; itemId: string; packQty: number }[];
  kitSkus: ReadonlyMap<string, string>;
}): KitListingUse[] {
  const perKit = componentQtyInKits(input.componentId, input.edges);
  const grouped = new Map<string, KitListingUse>();
  for (const listing of input.listings) {
    const qtyPerKit = perKit.get(listing.itemId);
    const kitSku = input.kitSkus.get(listing.itemId);
    if (!qtyPerKit || !kitSku) continue;
    const packQty = listing.packQty >= 1 ? listing.packQty : 1;
    const qty = qtyPerKit * packQty;
    if (!Number.isSafeInteger(qty)) continue;
    const key = `${listing.ebayItemId}\u0000${listing.itemId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.qty += qty;
      if (packQty > existing.packQty) existing.packQty = packQty;
      continue;
    }
    grouped.set(key, {
      ebayItemId: listing.ebayItemId,
      kitItemId: listing.itemId,
      kitSku,
      packQty,
      qty,
    });
  }
  return [...grouped.values()].sort(
    (a, b) => a.ebayItemId.localeCompare(b.ebayItemId, undefined, { numeric: true }) || a.kitSku.localeCompare(b.kitSku),
  );
}

export function directListings(rows: readonly { ebayItemId: string; packQty: number }[]): DirectListing[] {
  const packs = new Map<string, Set<number>>();
  for (const row of rows) {
    const id = row.ebayItemId.trim();
    if (!/^\d+$/.test(id)) continue;
    const packQty = Number.isSafeInteger(row.packQty) && row.packQty >= 1 ? row.packQty : 1;
    const set = packs.get(id) ?? new Set<number>();
    set.add(packQty);
    packs.set(id, set);
  }
  const views: DirectListing[] = [];
  for (const [ebayItemId, quantities] of packs) {
    for (const packQty of [...quantities].sort((a, b) => a - b)) views.push({ ebayItemId, packQty });
  }
  return views.sort(
    (a, b) => a.ebayItemId.localeCompare(b.ebayItemId, undefined, { numeric: true }) || a.packQty - b.packQty,
  );
}
