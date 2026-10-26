import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BIN_RECEIPTS_OPEN_KEY, readBinReceiptsOpen, writeBinReceiptsOpen } from "@/lib/binReceiptsOpen";

describe("bin receipts open preference", () => {
  it("stays expanded until this browser collapses Receipts, then keeps that for every bin", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };

    assert.equal(readBinReceiptsOpen(storage), true);
    writeBinReceiptsOpen(storage, false);
    assert.equal(memory.get(BIN_RECEIPTS_OPEN_KEY), "closed");
    assert.equal(readBinReceiptsOpen(storage), false);
    writeBinReceiptsOpen(storage, true);
    assert.equal(memory.get(BIN_RECEIPTS_OPEN_KEY), "open");
    assert.equal(readBinReceiptsOpen(storage), true);
    memory.set(BIN_RECEIPTS_OPEN_KEY, "nope");
    assert.equal(readBinReceiptsOpen(storage), true);
  });

  it("leaves the section usable when storage is blocked", () => {
    assert.equal(
      readBinReceiptsOpen({
        getItem() {
          throw new Error("blocked");
        },
      }),
      true,
    );
    assert.doesNotThrow(() =>
      writeBinReceiptsOpen(
        {
          setItem() {
            throw new Error("blocked");
          },
        },
        false,
      ),
    );
  });
});
