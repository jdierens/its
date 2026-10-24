import assert from "node:assert/strict";
import test from "node:test";
import { itemLabelHref, labelItemBackHref } from "./labelReturn.ts";

const ITEM = "f4bd2b78-a33d-43d0-b197-76039ed126cf";
const OTHER = "11111111-1111-4111-8111-111111111111";

test("the label back arrow returns to the item the page was opened from", () => {
  assert.equal(labelItemBackHref(ITEM, OTHER), `/items/${ITEM}`);
  assert.equal(labelItemBackHref(null, ITEM), `/items/${ITEM}`);
  assert.equal(labelItemBackHref("sku-107132", null), null);
  assert.equal(labelItemBackHref(null, null), null);
  assert.equal(labelItemBackHref("  ", ITEM), `/items/${ITEM}`);
});

test("print label keeps the sku and the item to return to", () => {
  assert.equal(itemLabelHref(ITEM, "107132"), `/labels?sku=107132&from=${ITEM}`);
  assert.equal(itemLabelHref(ITEM, " a/b "), `/labels?sku=a%2Fb&from=${ITEM}`);
  assert.equal(itemLabelHref(ITEM, "  "), `/labels?id=${ITEM}`);
  assert.equal(itemLabelHref(null, "107132"), "/labels?sku=107132");
  assert.equal(itemLabelHref("not-an-id", ""), "/labels");
});
