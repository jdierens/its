import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INVENTORY_NO_BINS,
  INVENTORY_ON_HAND_POOL,
  applyInventoryStock,
  formatInventoryBins,
  inventoryBinTotals,
  inventoryBinsSortLabel,
  inventoryHits,
  inventoryOnHand,
  inventoryScanCap,
  inventoryStockMode,
  sortInventoryHits,
  toggleInventorySort,
  type InventoryHit,
} from "./inventorySearch.ts";
import { LABEL_RESULT_CAP } from "./labelLookup.ts";
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

test("on hand defaults to in stock and all keeps quantity zero", () => {
  assert.equal(inventoryStockMode(null), "in");
  assert.equal(inventoryStockMode(undefined), "in");
  assert.equal(inventoryStockMode(""), "in");
  assert.equal(inventoryStockMode("in"), "in");
  assert.equal(inventoryStockMode("yes"), "in");
  assert.equal(inventoryStockMode("all"), "all");
  assert.equal(inventoryScanCap("in"), INVENTORY_ON_HAND_POOL);
  assert.equal(inventoryScanCap("all"), LABEL_RESULT_CAP);
  assert.equal(INVENTORY_ON_HAND_POOL, LABEL_RESULT_CAP * 8);

  const hits = [
    hit({ id: "zero", qty: 0, empty: true }),
    hit({ id: "one", qty: 1 }),
    hit({ id: "none", qty: -1 }),
  ];
  const stocked = applyInventoryStock(hits, "in", false);
  assert.deepEqual(
    stocked.hits.map((row) => row.id),
    ["one"],
  );
  assert.equal(stocked.matched, 3);
  assert.equal(stocked.truncated, false);
  const every = applyInventoryStock(hits, "all", false);
  assert.deepEqual(
    every.hits.map((row) => row.id),
    ["zero", "one", "none"],
  );
  assert.equal(every.truncated, false);
  assert.equal(every.matched, 3);
});

test("in stock caps the filtered list and keeps a truncated scan", () => {
  const hits = Array.from({ length: LABEL_RESULT_CAP + 5 }, (_, index) => hit({ id: `row-${index}`, qty: index + 1 }));
  const applied = applyInventoryStock(hits, "in", false);
  assert.equal(applied.hits.length, LABEL_RESULT_CAP);
  assert.equal(applied.truncated, true);
  assert.equal(applied.matched, hits.length);
  assert.ok(applied.hits.every((row) => row.qty > 0));
  assert.equal(applied.hits[0]?.id, "row-0");
  assert.equal(applyInventoryStock(hits.slice(0, 4), "in", true).truncated, true);
  const all = applyInventoryStock(hits, "all", false);
  assert.equal(all.hits.length, hits.length);
  assert.equal(all.truncated, false);
});

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
  assert.match(css, /\.inventory-bin\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.inventory-cards \.receive-card-row dl\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0,\s*1fr\)/);
  assert.match(css, /\.inventory-cards \.receive-card-row dd\s*\{[^}]*text-align:\s*left/);
  assert.match(css, /\.inventory-cards \.receive-card-row dd\.num\s*\{[^}]*text-align:\s*right/);
  assert.doesNotMatch(css, /inventory-results td\.locations,\s*\.inventory-cards dd\.locations \{\s*white-space:\s*pre-line/);
  const page = readFileSync(new URL("../components/InventorySearchPage.tsx", import.meta.url), "utf8");
  assert.match(page, /className="inventory-bin"/);
  assert.match(page, /aria-sort=/);
  assert.match(page, /sortInventoryHits/);
  assert.match(page, /inventory-col-sort/);
  assert.match(page, /className="inventory-stock"/);
  assert.match(page, /aria-pressed=\{stock === "in"\}/);
  assert.match(page, /inventoryStockMode/);
  assert.match(page, /searchInventory\(query, mode\)/);
  assert.match(page, /next\.set\(INVENTORY_STOCK_PARAM, "all"\)/);
  assert.match(page, /next\.delete\(INVENTORY_STOCK_PARAM\)/);
  assert.doesNotMatch(page, /hit\.qty > 0/);
  assert.match(source, /applyInventoryStock/);
  assert.match(source, /inventoryScanCap/);
  assert.match(css, /\.inventory-stock\[aria-pressed="true"\]/);
});
