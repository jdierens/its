import assert from "node:assert/strict";
import test from "node:test";
import { cachedReservation } from "./sku.ts";

test("a second call within a second reuses the reserved SKU", () => {
  let calls = 0;
  const first = cachedReservation(null, 1_000, () => {
    calls += 1;
    return "107133";
  });
  const second = cachedReservation(first.slot, 1_500, () => {
    calls += 1;
    return "107134";
  });
  assert.equal(calls, 1);
  assert.equal(second.value, "107133");
});

test("a later new item takes the next reservation", () => {
  const first = cachedReservation(null, 1_000, () => "107133");
  const second = cachedReservation(first.slot, 2_000, () => "107134");
  assert.equal(second.value, "107134");
});
