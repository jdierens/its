import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  binEntriesCode,
  binEntriesFromJson,
  formatMoveWhen,
  isBinCode,
  moveItemLines,
  movePlaceFromJson,
  parseMoveQty,
  placeDescription,
  recentMovesCode,
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

  it("scopes recent moves to a resolved bin or location", () => {
    assert.equal(recentMovesCode(null), null);
    assert.equal(recentMovesCode({ kind: "unknown", code: "NOPE", message: "No bin or location with that code." }), null);
    assert.equal(recentMovesCode({
      kind: "missing_bin",
      code: "23456-B",
      type: "B",
      message: "No bin with that code. Use New bin.",
    }), null);
    assert.equal(recentMovesCode({
      kind: "bin",
      code: "10099-C",
      path: "HWR.01.01.01 > Crate 10099-C",
      place: "HWR.01.01.01",
      bin: { id: "bin-1", reference: "10099-C", type: "C", label: "Crate 10099-C", boxes: 0, items: 1 },
      children: [],
      items: [],
    }), "10099-C");
    assert.equal(recentMovesCode({
      kind: "location",
      code: "HWR.01.01.01",
      path: "HWR.01.01.01",
      place: "HWR.01.01.01",
      children: [],
      items: [],
    }), "HWR.01.01.01");
  });

  it("lists entries for a target bin and not for a location", () => {
    const bin = {
      kind: "bin" as const,
      code: "10099-C",
      path: "HWR.01.01.01 > Crate 10099-C",
      place: "HWR.01.01.01",
      bin: { id: "bin-1", reference: "10099-C", type: "C", label: "Crate 10099-C", boxes: 0, items: 1 },
      children: [],
      items: [],
    };
    assert.equal(binEntriesCode(null), null);
    assert.equal(binEntriesCode({ kind: "unknown", code: "NOPE", message: "No bin or location with that code." }), null);
    assert.equal(binEntriesCode({
      kind: "location",
      code: "HWR.01.01.01",
      path: "HWR.01.01.01",
      place: "HWR.01.01.01",
      children: [],
      items: [],
    }), null);
    assert.equal(binEntriesCode(bin), "10099-C");
    assert.deepEqual(binEntriesFromJson([
      {
        id: "item:1",
        occurred_at: "2026-10-24T18:05:00Z",
        initials: "JD",
        what: "SKU94415 Samsung",
        from_place: "Received",
        qty: 4,
      },
      { id: "bin:2", occurred_at: "2026-10-24T18:00:00Z", initials: "JD", what: "Box 2345-B", from_place: "Crate 10099-C", qty: null },
      "skip",
    ]), [
      {
        id: "item:1",
        occurredAt: "2026-10-24T18:05:00Z",
        initials: "JD",
        what: "SKU94415 Samsung",
        fromPlace: "Received",
        qty: 4,
      },
      {
        id: "bin:2",
        occurredAt: "2026-10-24T18:00:00Z",
        initials: "JD",
        what: "Box 2345-B",
        fromPlace: "Crate 10099-C",
        qty: null,
      },
    ]);
    assert.deepEqual(binEntriesFromJson({}), []);
  });

  it("puts the path beside the search and skips a path that repeats the place", () => {
    assert.deepEqual(placeDescription("HWR.01.03.02 > Pallet 30012-P", "Pallet 30012-P"), {
      path: "HWR.01.03.02 > Pallet 30012-P",
      here: "Now at Pallet 30012-P.",
    });
    assert.deepEqual(placeDescription("HWR.01.01.01", "HWR.01.01.01"), {
      path: "",
      here: "Now at HWR.01.01.01.",
    });
    assert.deepEqual(placeDescription("  ", " "), { path: "", here: "" });
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
