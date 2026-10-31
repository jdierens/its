import assert from "node:assert/strict";
import test from "node:test";
import { safeItemsReturnPath } from "./returnPath.ts";

test("Google returns only to a list that started the export", () => {
  assert.equal(safeItemsReturnPath(null), "/items");
  assert.equal(safeItemsReturnPath("/items?tax=MEM&q=ddr"), "/items?tax=MEM&q=ddr");
  assert.equal(
    safeItemsReturnPath("/admin/integrations/ebay/listings?q=ddr&match=unmatched&page=2"),
    "/admin/integrations/ebay/listings?q=ddr&match=unmatched&page=2",
  );
  assert.equal(safeItemsReturnPath("https://evil.example/items"), "/items");
  assert.equal(safeItemsReturnPath("//evil.example/items"), "/items");
  assert.equal(safeItemsReturnPath("/login"), "/items");
  assert.equal(safeItemsReturnPath("/items/new"), "/items");
  assert.equal(safeItemsReturnPath("/admin/integrations/ebay/listings/extra"), "/items");
  assert.equal(safeItemsReturnPath("/admin/integrations/ebay"), "/items");
});
