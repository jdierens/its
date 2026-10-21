import assert from "node:assert/strict";
import test from "node:test";
import { safeItemsReturnPath } from "./returnPath.ts";

test("Google returns only to the items list", () => {
  assert.equal(safeItemsReturnPath(null), "/items");
  assert.equal(safeItemsReturnPath("/items?tax=MEM&q=ddr"), "/items?tax=MEM&q=ddr");
  assert.equal(safeItemsReturnPath("https://evil.example/items"), "/items");
  assert.equal(safeItemsReturnPath("//evil.example/items"), "/items");
  assert.equal(safeItemsReturnPath("/login"), "/items");
  assert.equal(safeItemsReturnPath("/items/new"), "/items");
});
