import assert from "node:assert/strict";
import test from "node:test";
import { formatEntityResult, parseSyncRequest } from "./syncOptions.ts";

test("accepts a customer pull with a full resync", () => {
  const parsed = parseSyncRequest({ entities: ["customer"], direction: "pull", full: true });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value, { entities: ["customer"], direction: "pull", full: true });
});

test("rejects an empty selection, a bad direction, and a missing full flag", () => {
  assert.equal(parseSyncRequest({ entities: [], direction: "both", full: false }).ok, false);
  assert.equal(parseSyncRequest({ entities: ["invoice"], direction: "both", full: false }).ok, false);
  assert.equal(parseSyncRequest({ entities: ["customer", "customer"], direction: "both", full: false }).ok, false);
  assert.equal(parseSyncRequest({ entities: ["vendor"], direction: "sideways", full: false }).ok, false);
  assert.equal(parseSyncRequest({ entities: ["vendor"], direction: "push" }).ok, false);
  assert.equal(parseSyncRequest(null).ok, false);
});

test("formats a per-entity result and includes conflicts only when present", () => {
  assert.equal(
    formatEntityResult("customer", { created: 12, updated: 3, conflicts: 0, errors: 0 }),
    "Customers: 12 new, 3 updated, 0 errors",
  );
  assert.equal(
    formatEntityResult("vendor", { created: 0, updated: 1, conflicts: 2, errors: 1 }),
    "Vendors: 0 new, 1 updated, 2 conflicts, 1 error",
  );
});
