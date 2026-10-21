import assert from "node:assert/strict";
import test from "node:test";
import { skuSubmittedForCreate } from "./sku.ts";

test("an untouched preview does not send a SKU to save", () => {
  assert.equal(skuSubmittedForCreate(false, "107134"), "");
  assert.equal(skuSubmittedForCreate(false, ""), "");
});

test("a typed SKU is saved as written", () => {
  assert.equal(skuSubmittedForCreate(true, " 107200 "), "107200");
  assert.equal(skuSubmittedForCreate(true, " SM-1 "), "SM-1");
});
