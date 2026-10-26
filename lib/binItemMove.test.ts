import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  itemMoveIds,
  itemMoveSummary,
  itemMoveTargetBin,
  itemMoveTargetError,
  linesForSelection,
} from "@/lib/binItemMove";

const lines = [
  { itemId: "a", sku: "ABC", name: "Widget", qty: 4 },
  { itemId: "b", sku: "DEF", name: "Gadget", qty: 1 },
  { itemId: "c", sku: "", name: "", qty: 2 },
];

describe("bin item move", () => {
  it("sends a quantity only to a bin code", () => {
    assert.equal(itemMoveTargetError(""), "Enter a bin code.");
    assert.equal(itemMoveTargetError("  "), "Enter a bin code.");
    assert.equal(itemMoveTargetError("HWS.00.00.00"), "Put the quantity into a bin. A location can take a bin.");
    assert.equal(itemMoveTargetError("nope"), "Put the quantity into a bin. A location can take a bin.");
    assert.equal(itemMoveTargetError(" 10001-b "), null);
    assert.equal(itemMoveTargetBin(" 10001-b "), "10001-B");
  });

  it("keeps the first copy of each selected item", () => {
    assert.deepEqual(itemMoveIds([" a ", "b", "a", "", "b"]), ["a", "b"]);
  });

  it("keeps table order for the lines that are checked", () => {
    assert.deepEqual(
      linesForSelection(lines, ["c", "a"]).map((line) => line.itemId),
      ["a", "c"],
    );
    assert.deepEqual(linesForSelection(lines, []), []);
  });

  it("describes the full on-hand quantity of every selected line", () => {
    assert.equal(
      itemMoveSummary("Box 20001-B", "20002-C", [lines[0], lines[2]]),
      "Move 4 of ABC Widget from Box 20001-B to 20002-C Move 2 of item from Box 20001-B to 20002-C",
    );
  });
});
