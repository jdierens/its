import { isBinCode } from "@/lib/moveInventory";

export type BinMoveLine = {
  itemId: string;
  sku: string;
  name: string;
  qty: number;
};

const ITEM_NEEDS_BIN = "Put the quantity into a bin. A location can take a bin.";

/** A selected line moves into a bin. A location can take the whole bin, not a quantity. */
export function itemMoveTargetError(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed) return "Enter a bin code.";
  if (!isBinCode(trimmed)) return ITEM_NEEDS_BIN;
  return null;
}

export function itemMoveTargetBin(code: string): string {
  return code.trim().toUpperCase();
}

export function itemMoveIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

export function linesForSelection<T extends { itemId: string }>(rows: readonly T[], selected: Iterable<string>): T[] {
  const ids = new Set(selected);
  return rows.filter((row) => ids.has(row.itemId));
}

export function itemMoveSummary(fromLabel: string, toBin: string, lines: readonly BinMoveLine[]): string {
  return lines
    .map((line) => {
      const item = [line.sku, line.name].filter(Boolean).join(" ").trim() || "item";
      return `Move ${line.qty} of ${item} from ${fromLabel} to ${toBin}`;
    })
    .join(" ");
}
