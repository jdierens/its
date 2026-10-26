import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMoveWhen,
  isBinCode,
  moveItemLines,
  movePlaceFromJson,
  parseMoveQty,
  setMoveItemQty,
  targetFields,
  toggleMoveItem,
} from "@/lib/moveInventory";

describe("move inventory", () => {
  it("treats a bin code and a location code as different targets", () => {
    assert.equal(isBinCode("10099-C"), true);
    assert.equal(isBinCode("40001-G"), true);
    assert.equal(isBinCode("hwr.01.01.01"), false);
    assert.deepEqual(targetFields(" 10099-c "), { targetBin: "10099-C", targetLocation: null });
    assert.deepEqual(targetFields("HWR.01.01.01"), { targetBin: null, targetLocation: "HWR.01.01.01" });
    assert.deepEqual(targetFields(" "), { targetBin: null, targetLocation: null });
  });

  it("keeps every checked item when another row is checked", () => {
    const first = toggleMoveItem([], "item-a", 4);
    const both = toggleMoveItem(first, "item-b", 2);
    assert.deepEqual(both, [
      { itemId: "item-a", qty: "4" },
      { itemId: "item-b", qty: "2" },
    ]);
    assert.deepEqual(setMoveItemQty(both, "item-a", "3"), [
      { itemId: "item-a", qty: "3" },
      { itemId: "item-b", qty: "2" },
    ]);
    assert.deepEqual(toggleMoveItem(both, "item-a", 4), [{ itemId: "item-b", qty: "2" }]);
  });

  it("reads a quantity for each selected line", () => {
    const onHand = (itemId: string) => (itemId === "item-a" ? 4 : 2);
    assert.deepEqual(moveItemLines(
      [
        { itemId: "item-a", qty: "3" },
        { itemId: "item-b", qty: "2" },
      ],
      onHand,
    ), {
      ok: true,
      items: [
        { itemId: "item-a", qty: 3 },
        { itemId: "item-b", qty: 2 },
      ],
    });
    assert.deepEqual(moveItemLines([{ itemId: "item-a", qty: "9" }], onHand), {
      ok: false,
      message: "Only 4 are in that bin.",
    });
  });

  it("accepts a quantity up to the amount in the bin", () => {
    assert.equal(parseMoveQty("4", 4), 4);
    assert.equal(parseMoveQty("5", 4), null);
    assert.equal(parseMoveQty("0", 4), null);
    assert.equal(parseMoveQty("1.5", 4), null);
  });

  it("formats the warehouse clock", () => {
    assert.equal(formatMoveWhen("2026-10-24T18:05:00Z"), "24 Oct, 11:05");
  });

  it("reads a missing bin the same way receiving does", () => {
    const place = movePlaceFromJson({
      kind: "missing_bin",
      code: "23456-B",
      type: "B",
      message: "No bin with that code. Use New bin.",
    });
    assert.equal(place.kind, "missing_bin");
    if (place.kind !== "missing_bin") return;
    assert.equal(place.message, "No bin with that code. Use New bin.");
  });
});
