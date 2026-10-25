import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ITEM_LIST_SEARCH_SOURCES } from "./itemListSearch.ts";

test("receiving find uses the items-page sources, including model", () => {
  assert.ok(ITEM_LIST_SEARCH_SOURCES.includes("model"));
  assert.ok(ITEM_LIST_SEARCH_SOURCES.includes("part_number"));
  assert.ok(ITEM_LIST_SEARCH_SOURCES.includes("oem_part_number"));
  assert.ok(ITEM_LIST_SEARCH_SOURCES.includes("item_attributes.value"));
  assert.ok(ITEM_LIST_SEARCH_SOURCES.includes("manufacturers.name"));
  assert.ok(ITEM_LIST_SEARCH_SOURCES.includes("manufacturer_aliases.alias"));
  assert.ok(ITEM_LIST_SEARCH_SOURCES.includes("ebay_listings.ebay_item_id"));

  const source = readFileSync(new URL("./labelLookupServer.ts", import.meta.url), "utf8");
  assert.match(source, /itemIdsMatchingListQuery\(supabase, query\)/);
  assert.equal(source.includes('columns: ["sku", "name", "description"]'), false);
  assert.equal(source.includes("labelLikeOr"), false);
});
