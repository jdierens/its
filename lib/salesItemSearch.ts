import { allocationQtyForLine, formatAllocationQty, parsePackLabel } from "@/lib/ebay/packs";
import { alnumFieldContains, alnumQueryAlternatives, alnumQueryContains, normalizeAlnum } from "@/lib/itemAlnum";
import { itemListQueryToken } from "@/lib/itemListQuery";

/**
 * Longest word in a customer part number.
 * Spaces, punctuation, and underscores are separators, so `FOO-BAR 106683_2PK` yields `106683`.
 */
export function longestPartToken(value: string): string {
  const parts = value.split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0);
  let best = "";
  let bestMixed = false;
  for (const part of parts) {
    const mixed = /[A-Za-z]/.test(part) && /\d/.test(part);
    if (part.length > best.length || (part.length === best.length && mixed && !bestMixed)) {
      best = part;
      bestMixed = mixed;
    }
  }
  return best;
}

/**
 * Tokens Find SKU searches.
 * The first is the items-page token. A different longest word is searched as well.
 */
export function salesItemSearchTokens(query: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const push = (token: string) => {
    const key = token.toLowerCase();
    if (!token || seen.has(key)) return;
    seen.add(key);
    tokens.push(token);
  };
  for (const alternative of alnumQueryAlternatives(query)) {
    const primary = itemListQueryToken(alternative);
    const longest = longestPartToken(alternative);
    if (primary) push(primary);
    if (longest.length >= 3 && longest.toLowerCase() !== primary.toLowerCase()) push(longest);
  }
  return tokens;
}

export function rankSalesItemHits<T extends { sku: string; name: string; partNumber: string }>(
  tokens: readonly string[],
  rows: readonly T[],
  limit = 8,
): T[] {
  const needles = tokens.map((token) => token.trim()).filter((token) => token.length > 0);
  const score = (row: T) => {
    const sku = row.sku.toLowerCase();
    const part = row.partNumber.toLowerCase();
    const name = row.name.toLowerCase();
    let best = 8;
    for (const needle of needles) {
      const folded = needle.toLowerCase();
      const skuSame = normalizeAlnum(row.sku) === normalizeAlnum(needle) && normalizeAlnum(needle).length > 0;
      const partSame = normalizeAlnum(row.partNumber) === normalizeAlnum(needle) && normalizeAlnum(needle).length > 0;
      if (sku === folded) best = Math.min(best, 0);
      else if (part === folded) best = Math.min(best, 1);
      else if (sku.startsWith(folded) || skuSame) best = Math.min(best, 2);
      else if (part.startsWith(folded) || partSame) best = Math.min(best, 3);
      else if (sku.includes(folded) || alnumFieldContains(row.sku, needle)) best = Math.min(best, 4);
      else if (part.includes(folded) || alnumFieldContains(row.partNumber, needle)) best = Math.min(best, 5);
      else if (name.includes(folded) || alnumFieldContains(row.name, needle)) best = Math.min(best, 6);
      else if (
        alnumQueryContains(row.sku, needle) ||
        alnumQueryContains(row.partNumber, needle) ||
        alnumQueryContains(row.name, needle)
      ) {
        best = Math.min(best, 7);
      }
    }
    return best;
  };
  return [...rows].sort((left, right) => score(left) - score(right) || left.sku.localeCompare(right.sku)).slice(0, limit);
}

/** Quantity stored when a Find SKU result is chosen. A pack that is not itself an item allocates pieces. */
export function qtyForSkuPick(input: { part: string; lineQty: string; sku: string; partIsItem: boolean }): string | null {
  const qtyNumber = Number(input.lineQty);
  if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) return null;
  const label = input.part.trim();
  const exact = input.sku.trim().toLowerCase() === label.toLowerCase();
  const pack = parsePackLabel(label);
  const pieces =
    pack && pack.packQty > 1 && !exact && !input.partIsItem ? allocationQtyForLine(label, qtyNumber) : qtyNumber;
  return formatAllocationQty(pieces);
}
