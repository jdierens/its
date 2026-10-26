import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INVENTORY_NO_BINS,
  formatInventoryBins,
  inventoryBinTotals,
  inventoryHits,
  inventoryOnHand,
} from "./inventorySearch.ts";
import { NAV_GROUPS, pageMetaFor } from "./nav.ts";

test("bin totals use the receiving summary shape and include a location", () => {
  assert.equal(
    formatInventoryBins([
      { reference: "10037", qty: 8, locationCode: null },
      { reference: "10002-C", qty: 14, locationCode: null },
    ]),
    "(x14)10002-C | (x8)10037",
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
    "(x33)20000-B · HWS.00.00.00 | (x51)20007-B · HWS.00.00.00 | (x33)20008-B · HWS.00.00.00 | (x51)20009-B · HWS.00.00.00",
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
  assert.doesNotMatch(source, /\.ilike\(/);
  assert.doesNotMatch(source, /rpc\(/);
});
