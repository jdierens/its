import assert from "node:assert/strict";
import test from "node:test";
import { allocationQtyForLine, applyPackToLine, assignListingSku, kitListingUses, parsePackLabel, pieceQtyForPack } from "./packs.ts";

const baseAndPackItem = [
  { id: "base", sku: "12345" },
  { id: "real-pack", sku: "12345-4PK" },
];

test("a pack label is base sku plus an integer of at least 1", () => {
  assert.deepEqual(parsePackLabel("12345-4PK"), { baseSku: "12345", packQty: 4 });
  assert.deepEqual(parsePackLabel(" 12345-4pk "), { baseSku: "12345", packQty: 4 });
  assert.deepEqual(parsePackLabel("AB-C-12PK"), { baseSku: "AB-C", packQty: 12 });
  assert.equal(parsePackLabel("-PK"), null);
  assert.equal(parsePackLabel("-0PK"), null);
  assert.equal(parsePackLabel("-4pkx"), null);
  assert.equal(parsePackLabel("12345-PK"), null);
  assert.equal(parsePackLabel("12345-0PK"), null);
  assert.equal(parsePackLabel("12345-4pkx"), null);
  assert.equal(parsePackLabel("12345-04PK"), null);
  assert.equal(parsePackLabel("4PK"), null);
});

test("underscore and parenthesis pack labels become a base sku and a piece count", () => {
  assert.deepEqual(parsePackLabel("106683_2PK"), { baseSku: "106683", packQty: 2 });
  assert.deepEqual(parsePackLabel("106683_2pk"), { baseSku: "106683", packQty: 2 });
  assert.deepEqual(parsePackLabel("106683(x2)"), { baseSku: "106683", packQty: 2 });
  assert.deepEqual(parsePackLabel("106683(X2)"), { baseSku: "106683", packQty: 2 });
  assert.equal(parsePackLabel("106683"), null);
  assert.equal(parsePackLabel("106683_04PK"), null);
  assert.equal(parsePackLabel("106683(x04)"), null);
  assert.equal(pieceQtyForPack(1, 2), 2);
  assert.equal(pieceQtyForPack(2, 2), 2);
  assert.equal(allocationQtyForLine("106683_2PK", 1), 2);
  assert.equal(allocationQtyForLine("106683_2PK", 2), 4);
  const packed = applyPackToLine({ part: "106683_2PK", qty: "1", unitPrice: "6338" });
  assert.equal(packed.search, "106683");
  assert.equal(packed.qty, "1");
  assert.equal(packed.unitPrice, "6338");
  assert.equal(packed.packQty, 2);
  assert.equal(packed.allocationQty, "2");
  const twoPacks = applyPackToLine({ part: "106683(x2)", qty: "2", unitPrice: "6338" });
  assert.equal(twoPacks.qty, "2");
  assert.equal(twoPacks.unitPrice, "6338");
  assert.equal(twoPacks.allocationQty, "4");
});

test("an exact sku wins over the pack pattern", () => {
  const exact = assignListingSku("12345-4PK", baseAndPackItem);
  assert.equal(exact.itemId, "real-pack");
  assert.equal(exact.packQty, 1);
  assert.equal(exact.baseSku, null);

  const cased = assignListingSku("12345-4pk", [{ id: "real-pack", sku: "12345-4PK" }]);
  assert.equal(cased.itemId, "real-pack");
  assert.equal(cased.packQty, 1);
  assert.equal(cased.baseSku, null);

  const pack = assignListingSku("12345-4PK", [{ id: "base", sku: "12345" }]);
  assert.equal(pack.itemId, "base");
  assert.equal(pack.packQty, 4);
  assert.equal(pack.baseSku, "12345");

  const missingBase = assignListingSku("999-2PK", [{ id: "base", sku: "12345" }]);
  assert.equal(missingBase.itemId, null);
  assert.equal(missingBase.packQty, 2);
  assert.equal(missingBase.baseSku, "999");

  const plain = assignListingSku("12345", baseAndPackItem);
  assert.equal(plain.itemId, "base");
  assert.equal(plain.packQty, 1);
  assert.equal(plain.baseSku, null);
});

test("kit rollup multiplies recipe qty by the listing pack", () => {
  const uses = kitListingUses({
    componentId: "part",
    edges: [
      { kitItemId: "kit", componentItemId: "part", qtyPerKit: 2 },
      { kitItemId: "outer", componentItemId: "kit", qtyPerKit: 3 },
      { kitItemId: "outer", componentItemId: "part", qtyPerKit: 1 },
    ],
    listings: [
      { ebayItemId: "111", itemId: "part", packQty: 4 },
      { ebayItemId: "222", itemId: "kit", packQty: 4 },
      { ebayItemId: "333", itemId: "outer", packQty: 1 },
      { ebayItemId: "444", itemId: "other", packQty: 2 },
    ],
    kitSkus: new Map([
      ["kit", "KIT-1"],
      ["outer", "KIT-2"],
    ]),
  });
  assert.deepEqual(uses, [
    { ebayItemId: "222", kitItemId: "kit", kitSku: "KIT-1", packQty: 4, qty: 8 },
    { ebayItemId: "333", kitItemId: "outer", kitSku: "KIT-2", packQty: 1, qty: 7 },
  ]);
});
