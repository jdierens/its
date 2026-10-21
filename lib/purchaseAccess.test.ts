import assert from "node:assert/strict";
import test from "node:test";
import { purchaseAccessForRole } from "./purchaseAccess.ts";

test("admin and staff can create and see purchase-order costs", () => {
  assert.deepEqual(purchaseAccessForRole("admin", true), { canEdit: true, canViewMoney: true });
  assert.deepEqual(purchaseAccessForRole("staff", true), { canEdit: true, canViewMoney: true });
});

test("read only can see costs and cannot send a purchase order", () => {
  assert.deepEqual(purchaseAccessForRole("read_only", true), { canEdit: false, canViewMoney: true });
});

test("warehouse roles see quantities only", () => {
  assert.deepEqual(purchaseAccessForRole("warehouse_clerk", true), { canEdit: false, canViewMoney: false });
  assert.deepEqual(purchaseAccessForRole("warehouse_manager", true), { canEdit: false, canViewMoney: false });
  assert.deepEqual(purchaseAccessForRole(null, true), { canEdit: false, canViewMoney: false });
});

test("the open app can edit while sign-in is off", () => {
  assert.deepEqual(purchaseAccessForRole(null, false), { canEdit: true, canViewMoney: true });
});
