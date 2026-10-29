import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INVENTORY_NO_BINS,
  formatInventoryBins,
  inventoryBinTotals,
  inventoryBinsSortLabel,
  inventoryHits,
  inventoryOnHand,
  sortInventoryHits,
  toggleInventorySort,
  type InventoryHit,
} from "./inventorySearch.ts";
import { NAV_GROUPS, pageMetaFor } from "./nav.ts";

test("bin totals use the receiving summary shape and include a location", () => {
  assert.equal(
    formatInventoryBins([
      { reference: "10037", qty: 8, locationCode: null },
      { reference: "10002-C", qty: 14, locationCode: null },
    ]),
    "(x14)10002-C\n(x8)10037",
  );
  const onHand = inventoryOnHand([
    { reference: "20009-B", qty: 51, locationCode: "HWS.00.00.00" },
    { reference: "20000-B", qty: 33, locationCode: "HWS.00.00.00" },
    { reference: "20008-B", qty: 33, locationCode: " HWS.00.00.00 " },
    { reference: "20007-B", qty: 51, locationCode: "HWS.00.00.00" },
    { reference: "20000-B", qty: 0, locationCode: "HWS.00.00.00" },
  ]);
  assert.equal(onHand.qty, 168);
  assert.equal(
    onHand.locations,
    "(x33)20000-B · HWS.00.00.00\n(x51)20007-B · HWS.00.00.00\n(x33)20008-B · HWS.00.00.00\n(x51)20009-B · HWS.00.00.00",
  );
});

test("the same bin adds together and keeps a location from either row", () => {
  const bins = inventoryBinTotals([
    { reference: "10010-C", qty: 4, locationCode: null },
    { reference: "10010-C", qty: 6, locationCode: "HWS.01.02.03" },
    { reference: " ", qty: 9, locationCode: "HWS.00.00.00" },
  ]);
  assert.deepEqual(bins, [{ reference: "10010-C", qty: 10, locationCode: "HWS.01.02.03" }]);
});

test("a match with no open quantity stays in the list", () => {
  const hits = inventoryHits(
    [
      { id: "drive", sku: "106683", name: "Drive", description: "Kioxia 15.36TB" },
      { id: "empty", sku: "100054", name: "Memory", description: "" },
    ],
    [
      { itemId: "drive", qty: 33, binReference: "20000-B", locationCode: "HWS.00.00.00", cycleOpen: true },
      { itemId: "drive", qty: 10, binReference: "20001-B", locationCode: "HWS.00.00.00", cycleOpen: false },
      { itemId: "empty", qty: 4, binReference: "10002-C", locationCode: "HWS.00.00.00", cycleOpen: false },
    ],
  );
  assert.equal(hits[0]?.qty, 33);
  assert.equal(hits[0]?.locations, "(x33)20000-B · HWS.00.00.00");
  assert.equal(hits[0]?.empty, false);
  assert.equal(hits[1]?.qty, 0);
  assert.equal(hits[1]?.locations, "");
  assert.equal(hits[1]?.empty, true);
  assert.equal(INVENTORY_NO_BINS, "no bins");
});

function hit(partial: Partial<InventoryHit> & Pick<InventoryHit, "id">): InventoryHit {
  return {
    sku: partial.sku ?? partial.id,
    name: partial.name ?? "",
    description: partial.description ?? "",
    qty: partial.qty ?? 0,
    locations: partial.locations ?? "",
    empty: partial.empty ?? false,
    ...partial,
  };
}

test("column sort starts ascending and then toggles", () => {
  assert.deepEqual(toggleInventorySort(null, "qty"), { key: "qty", dir: "asc" });
  assert.deepEqual(toggleInventorySort({ key: "qty", dir: "asc" }, "qty"), { key: "qty", dir: "desc" });
  assert.deepEqual(toggleInventorySort({ key: "qty", dir: "desc" }, "qty"), { key: "qty", dir: "asc" });
  assert.deepEqual(toggleInventorySort({ key: "qty", dir: "desc" }, "sku"), { key: "sku", dir: "asc" });
});

test("search results sort on the client and ties keep search order", () => {
  const hits = [
    hit({ id: "exact", sku: "100", name: "Drive", description: "Same", qty: 2, locations: "(x2)20000-B" }),
    hit({ id: "later", sku: "20", name: "Adapter", description: "Other", qty: 10, locations: "(x10)10002-C\n(x1)30000-B" }),
    hit({ id: "empty", sku: "3000", name: "", description: "Bare", qty: 0, locations: "", empty: true }),
    hit({ id: "tie", sku: "100", name: "Drive", description: "Same", qty: 2, locations: "(x2)20000-B" }),
  ];
  const original = hits.map((row) => row.id);

  assert.deepEqual(
    sortInventoryHits(hits, { key: "sku", dir: "asc" }).map((row) => row.id),
    ["later", "exact", "tie", "empty"],
  );
  assert.deepEqual(
    sortInventoryHits(hits, { key: "sku", dir: "desc" }).map((row) => row.id),
    ["empty", "exact", "tie", "later"],
  );
  assert.deepEqual(
    sortInventoryHits(hits, { key: "item", dir: "asc" }).map((row) => row.id),
    ["empty", "later", "exact", "tie"],
  );
  assert.deepEqual(
    sortInventoryHits(
      [
        hit({ id: "zebra", sku: "1", name: "Drive", description: "Zebra" }),
        hit({ id: "alpha", sku: "2", name: "Drive", description: "Alpha" }),
      ],
      { key: "item", dir: "asc" },
    ).map((row) => row.id),
    ["alpha", "zebra"],
  );
  assert.deepEqual(
    sortInventoryHits(hits, { key: "qty", dir: "asc" }).map((row) => row.id),
    ["empty", "exact", "tie", "later"],
  );
  assert.deepEqual(
    sortInventoryHits(hits, { key: "qty", dir: "desc" }).map((row) => row.id),
    ["later", "exact", "tie", "empty"],
  );
  assert.equal(inventoryBinsSortLabel(hits[1]!), "10002-C\n30000-B");
  assert.equal(inventoryBinsSortLabel(hits[2]!), "no bins");
  assert.deepEqual(
    sortInventoryHits(hits, { key: "bins", dir: "asc" }).map((row) => row.id),
    ["later", "exact", "tie", "empty"],
  );
  assert.deepEqual(sortInventoryHits(hits, null).map((row) => row.id), original);
  assert.deepEqual(
    hits.map((row) => row.id),
    original,
  );
});

test("inventory search is a warehouse page and reuses receiving Find", () => {
  const warehouse = NAV_GROUPS.find((group) => group.label === "Warehouse");
  const item = warehouse?.items.find((entry) => entry.href === "/warehouse/inventory");
  assert.equal(item?.label, "Inventory search");
  assert.equal(warehouse?.items[0]?.href, "/warehouse/inventory");
  const meta = pageMetaFor("/warehouse/inventory");
  assert.equal(meta.title, "Inventory search");
  assert.deepEqual(
    meta.crumbs.map((crumb) => crumb.label),
    ["Warehouse", "Inventory search"],
  );
  const source = readFileSync(new URL("./inventorySearchServer.ts", import.meta.url), "utf8");
  assert.match(source, /searchReceivingScan/);
  assert.match(source, /alnumQueryAlternatives/);
  assert.doesNotMatch(source, /\.ilike\(/);
  assert.doesNotMatch(source, /rpc\(/);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.receive-table\.inventory-results td\.locations,\s*\.inventory-cards dd\.locations \{\s*white-space: pre-line;/);
  const page = readFileSync(new URL("../components/InventorySearchPage.tsx", import.meta.url), "utf8");
  assert.match(page, /aria-sort=/);
  assert.match(page, /sortInventoryHits/);
  assert.match(page, /inventory-col-sort/);
});
