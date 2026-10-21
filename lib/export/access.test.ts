import assert from "node:assert/strict";
import test from "node:test";
import { canViewFinancials } from "./access.ts";

test("admin, staff, and read_only can export prices", () => {
  assert.equal(canViewFinancials("admin"), true);
  assert.equal(canViewFinancials("staff"), true);
  assert.equal(canViewFinancials("read_only"), true);
});

test("an unknown role, including a future warehouse role, cannot export prices", () => {
  assert.equal(canViewFinancials("warehouse_clerk"), false);
  assert.equal(canViewFinancials(""), false);
});
