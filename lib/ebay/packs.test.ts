import assert from "node:assert/strict";
import test from "node:test";
import { assignListingSku, kitListingUses, parsePackLabel } from "./packs.ts";

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
