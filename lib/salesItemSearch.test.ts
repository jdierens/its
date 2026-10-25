import assert from "node:assert/strict";
import test from "node:test";
import { ITEM_LIST_SEARCH_SOURCES } from "./itemListSearch.ts";
import { itemListQueryToken } from "./itemListQuery.ts";
import { longestPartToken, qtyForSkuPick, rankSalesItemHits, salesItemSearchTokens } from "./salesItemSearch.ts";

test("a noisy customer part also searches its longest word", () => {
  assert.equal(itemListQueryToken("FOO-BAR 106683_2PK"), "106683_2PK");
  assert.equal(longestPartToken("FOO-BAR 106683_2PK"), "106683");
  assert.deepEqual(salesItemSearchTokens("FOO-BAR 106683_2PK"), ["106683_2PK", "106683"]);
  assert.equal(longestPartToken("106683_2PK"), "106683");
  assert.equal(longestPartToken("106683(x2)"), "106683");
  assert.equal(longestPartToken("M393A4K40DB3-CWE"), "M393A4K40DB3");
  assert.deepEqual(salesItemSearchTokens("M393A4K40DB3-CWE"), ["M393A4K40DB3-CWE", "M393A4K40DB3"]);
  assert.deepEqual(salesItemSearchTokens("106683"), ["106683"]);
});

test("Find SKU uses the items-page search sources", () => {
  for (const source of ["sku", "name", "description", "model", "part_number", "oem_name", "oem_part_number", "product_url"]) {
    assert.equal(ITEM_LIST_SEARCH_SOURCES.includes(source as (typeof ITEM_LIST_SEARCH_SOURCES)[number]), true);
  }
  assert.equal(ITEM_LIST_SEARCH_SOURCES.includes("item_attributes.value"), true);
  assert.equal(ITEM_LIST_SEARCH_SOURCES.includes("manufacturers.name"), true);
  assert.equal(ITEM_LIST_SEARCH_SOURCES.includes("manufacturer_aliases.alias"), true);
  assert.equal(ITEM_LIST_SEARCH_SOURCES.includes("ebay_listings.ebay_item_id"), true);
});

test("a hyphenated part ranks the stored name that omits those hyphens", () => {
  const ranked = rankSalesItemHits(["MCX-516A-CDAT"], [
    { sku: "102847", name: "CARD\\NIC\\E30\\100G_2Q\\LP-FH\\MCX516A-CCAT", partNumber: "" },
    { sku: "999", name: "CDAT", partNumber: "" },
    { sku: "107109", name: "CARD\\NIC\\E30\\100G_2Q\\LP-FH\\MCX516A-CDAT_FSB", partNumber: "" },
    { sku: "106823", name: "CARD\\NIC\\E30\\100G_2Q\\LP-FH\\MCX516A-CDAT", partNumber: "" },
  ]);
  assert.deepEqual(
    ranked.map((row) => row.sku),
    ["106823", "107109", "999", "102847"],
  );
});

test("item hits prefer an exact SKU, then a part number", () => {
  const ranked = rankSalesItemHits(["106683"], [
    { sku: "OTHER", name: "holds 106683 in the name", partNumber: "" },
    { sku: "106683-ALT", name: "Memory", partNumber: "106683" },
    { sku: "106683", name: "DDR4", partNumber: "M393" },
  ]);
  assert.deepEqual(
    ranked.map((row) => row.sku),
    ["106683", "106683-ALT", "OTHER"],
  );
});

test("choosing a pack base allocates pieces, and an exact label keeps the customer quantity", () => {
  assert.equal(qtyForSkuPick({ part: "106683_2PK", lineQty: "1", sku: "106683", partIsItem: false }), "2");
  assert.equal(qtyForSkuPick({ part: "106683_2PK", lineQty: "1", sku: "106683_2PK", partIsItem: true }), "1");
  assert.equal(qtyForSkuPick({ part: "106683_2PK", lineQty: "1", sku: "999", partIsItem: true }), "1");
  assert.equal(qtyForSkuPick({ part: "M393", lineQty: "3", sku: "1001", partIsItem: false }), "3");
  assert.equal(qtyForSkuPick({ part: "M393", lineQty: "0", sku: "1001", partIsItem: false }), null);
});
