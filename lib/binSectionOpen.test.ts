import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BIN_SECTION_OPEN_KEYS, readBinSectionOpen, writeBinSectionOpen } from "@/lib/binSectionOpen";

function memoryStorage() {
  const memory = new Map<string, string>();
  return {
    memory,
    storage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    },
  };
}

describe("bin section open preference", () => {
  it("opens Items and closes Receipts and history until this browser chooses", () => {
    const { memory, storage } = memoryStorage();
    assert.equal(readBinSectionOpen(storage, "items"), true);
    assert.equal(readBinSectionOpen(storage, "receipts"), false);
    assert.equal(readBinSectionOpen(storage, "history"), false);

    writeBinSectionOpen(storage, "receipts", true);
    assert.equal(memory.get(BIN_SECTION_OPEN_KEYS.receipts), "open");
    assert.equal(readBinSectionOpen(storage, "receipts"), true);
    writeBinSectionOpen(storage, "items", false);
    writeBinSectionOpen(storage, "history", true);
    assert.equal(readBinSectionOpen(storage, "items"), false);
    assert.equal(readBinSectionOpen(storage, "history"), true);
    assert.equal(memory.get(BIN_SECTION_OPEN_KEYS.items), "closed");
    assert.equal(memory.get(BIN_SECTION_OPEN_KEYS.history), "open");
    assert.equal(BIN_SECTION_OPEN_KEYS.receipts, "its.bin.receiptsOpen");
  });

  it("keeps a Receipts choice saved before the default became collapsed", () => {
    const { memory, storage } = memoryStorage();
    memory.set(BIN_SECTION_OPEN_KEYS.receipts, "open");
    assert.equal(readBinSectionOpen(storage, "receipts"), true);
    memory.set(BIN_SECTION_OPEN_KEYS.receipts, "closed");
    assert.equal(readBinSectionOpen(storage, "receipts"), false);
    memory.set(BIN_SECTION_OPEN_KEYS.receipts, "nope");
    assert.equal(readBinSectionOpen(storage, "receipts"), false);
    memory.set(BIN_SECTION_OPEN_KEYS.items, "nope");
    assert.equal(readBinSectionOpen(storage, "items"), true);
  });

  it("uses the section default when storage is blocked", () => {
    assert.equal(readBinSectionOpen({ getItem() { throw new Error("blocked"); } }, "items"), true);
    assert.equal(readBinSectionOpen({ getItem() { throw new Error("blocked"); } }, "receipts"), false);
    assert.doesNotThrow(() =>
      writeBinSectionOpen(
        {
          setItem() {
            throw new Error("blocked");
          },
        },
        "history",
        true,
      ),
    );
  });
});
