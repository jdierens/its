import assert from "node:assert/strict";
import test from "node:test";
import { safeItemsHref } from "./itemsReturn.ts";

test("items back link keeps the list query and drops item paths", () => {
  assert.equal(safeItemsHref(null), "/items");
  assert.equal(safeItemsHref("/items"), "/items");
  assert.equal(safeItemsHref("/items?q=hdd&page=2"), "/items?q=hdd&page=2");
  assert.equal(safeItemsHref("/items/abc"), "/items");
  assert.equal(safeItemsHref("/items/new"), "/items");
  assert.equal(safeItemsHref("https://example.com/items"), "/items");
  assert.equal(safeItemsHref("/pricing"), "/items");
});
