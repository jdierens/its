import assert from "node:assert/strict";
import test from "node:test";
import {
  extensionFromUnit,
  formatUnitPrice,
  pricesMatch,
  syncLinePrices,
  unitFromExtension,
} from "./poLineMoney.ts";

test("quantity and unit price compute the extension", () => {
  assert.equal(extensionFromUnit(2, 40.5), 81);
  assert.equal(extensionFromUnit(2, 10.125), 20.25);
  const synced = syncLinePrices({ qty: "2", unitCost: "10.125", extPrice: "", edited: "unit" });
  assert.equal(synced.extPrice, "20.25");
  assert.equal(synced.unitCost, "10.125");
});

test("quantity and extension compute a four-decimal unit price", () => {
  assert.equal(unitFromExtension(3, 10), 3.3333);
  assert.equal(pricesMatch(3, 3.3333, 10), true);
  const synced = syncLinePrices({ qty: "3", unitCost: "", extPrice: "10.00", edited: "ext" });
  assert.equal(synced.unitCost, "3.3333");
  assert.equal(formatUnitPrice(10), "10.00");
});

test("a changed quantity keeps the unit price and recomputes the extension", () => {
  const synced = syncLinePrices({ qty: "4", unitCost: "10.00", extPrice: "20.00", edited: "qty" });
  assert.equal(synced.unitCost, "10.00");
  assert.equal(synced.extPrice, "40.00");
});

test("prices that are not a rounding difference are rejected", () => {
  assert.equal(pricesMatch(3, 1, 100), false);
  assert.equal(pricesMatch(2, 10, 20), true);
});
