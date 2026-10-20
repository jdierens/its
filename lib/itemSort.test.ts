import assert from "node:assert/strict";
import test from "node:test";
import {
  itemSortRequest,
  parseItemPage,
  parseItemSort,
  toggleItemSort,
  writeItemSort,
} from "./itemSort.ts";

test("the default sort is SKU ascending and a second click reverses it", () => {
  const initial = parseItemSort(null, null);
  assert.deepEqual(initial, { column: "sku", ascending: true });
  const descending = toggleItemSort(initial, "sku");
  assert.deepEqual(descending, { column: "sku", ascending: false });
  const name = toggleItemSort(descending, "name");
  assert.deepEqual(name, { column: "name", ascending: true });
  assert.deepEqual(toggleItemSort(name, "photo"), name);
});

test("sort and direction stay in the query, and a new sort returns to the first page", () => {
  const params = new URLSearchParams("q=xeon&page=4&tax=CPU");
  writeItemSort(params, { column: "name", ascending: false });
  assert.equal(params.get("sort"), "name");
  assert.equal(params.get("dir"), "desc");
  assert.equal(params.get("page"), null);
  assert.equal(params.get("q"), "xeon");
  writeItemSort(params, { column: "sku", ascending: true });
  assert.equal(params.get("sort"), null);
  assert.equal(params.get("dir"), null);
  assert.deepEqual(parseItemSort(params.get("sort"), params.get("dir")), { column: "sku", ascending: true });
});

test("prices and numeric attributes sort as numbers, and text attributes do not", () => {
  assert.equal(itemSortRequest(parseItemSort("quantity", "asc"), null).sort, "quantity");
  assert.deepEqual(itemSortRequest(parseItemSort("attr:Capacity", "desc"), "integer"), {
    sort: "attr",
    attribute: "Capacity",
    numeric: true,
    ascending: false,
  });
  assert.equal(itemSortRequest(parseItemSort("attr:Notes", "asc"), "text").numeric, false);
  assert.equal(parseItemSort("photo", "desc").column, "sku");
  assert.equal(parseItemPage("3"), 3);
  assert.equal(parseItemPage("0"), 1);
  assert.equal(parseItemPage("nope"), 1);
});
