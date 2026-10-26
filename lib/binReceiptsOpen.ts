/** localStorage key. One choice for every bin on this browser. */
export const BIN_RECEIPTS_OPEN_KEY = "its.bin.receiptsOpen";

/**
 * Receipts stay expanded unless this browser last collapsed them.
 * A missing key, any other value, or blocked storage stays expanded.
 */
export function readBinReceiptsOpen(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(BIN_RECEIPTS_OPEN_KEY) !== "closed";
  } catch {
    return true;
  }
}

export function writeBinReceiptsOpen(storage: Pick<Storage, "setItem">, open: boolean): void {
  try {
    storage.setItem(BIN_RECEIPTS_OPEN_KEY, open ? "open" : "closed");
  } catch {
    // Private mode and blocked storage still leave the section usable for this visit.
  }
}
