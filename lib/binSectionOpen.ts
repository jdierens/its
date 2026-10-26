/** One localStorage choice per section, shared by every bin on this browser. */
export const BIN_SECTION_OPEN_KEYS = {
  items: "its.bin.itemsOpen",
  receipts: "its.bin.receiptsOpen",
  history: "its.bin.historyOpen",
} as const;

export type BinSection = keyof typeof BIN_SECTION_OPEN_KEYS;

/** Items start open. Receipts and history start closed until this browser chooses otherwise. */
const DEFAULT_OPEN: Record<BinSection, boolean> = {
  items: true,
  receipts: false,
  history: false,
};

/**
 * A stored "open" or "closed" wins, including an older Receipts choice.
 * A missing key, any other value, or blocked storage uses that section's default.
 */
export function readBinSectionOpen(storage: Pick<Storage, "getItem">, section: BinSection): boolean {
  try {
    const value = storage.getItem(BIN_SECTION_OPEN_KEYS[section]);
    if (value === "open") return true;
    if (value === "closed") return false;
    return DEFAULT_OPEN[section];
  } catch {
    return DEFAULT_OPEN[section];
  }
}

export function writeBinSectionOpen(storage: Pick<Storage, "setItem">, section: BinSection, open: boolean): void {
  try {
    storage.setItem(BIN_SECTION_OPEN_KEYS[section], open ? "open" : "closed");
  } catch {
    // Private mode and blocked storage still leave the section usable for this visit.
  }
}
