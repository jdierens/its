import assert from "node:assert/strict";
import test from "node:test";
import { canViewFinancials, sameItemName, skuReusesSource } from "./duplicateItem.ts";

test("a duplicate name matches after trim and case folding", () => {
  assert.equal(sameItemName("  CPU\\Platinum  ", "cpu\\platinum"), true);
  assert.equal(sameItemName("CPU\\PLATINUM8468V\\SRM7C_QA", "CPU\\PLATINUM8468V\\SRM7C_QB"), false);
  assert.equal(sameItemName("", " "), true);
});

test("an assigned preview does not reuse the source SKU, and a typed copy does", () => {
  assert.equal(skuReusesSource("", "106827"), false);
  assert.equal(skuReusesSource("107134", "106827"), false);
  assert.equal(skuReusesSource(" 106827 ", "106827"), true);
  assert.equal(skuReusesSource("srm", "SRM"), true);
});

test("prices are visible to admin, staff, and read_only, and hidden from a warehouse role", () => {
  assert.equal(canViewFinancials("admin", true), true);
  assert.equal(canViewFinancials("staff", true), true);
  assert.equal(canViewFinancials("read_only", true), true);
  assert.equal(canViewFinancials("warehouse_clerk", true), false);
  assert.equal(canViewFinancials(null, false), true);
});
