import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { salesAccessForRole } from "./salesAccess.ts";

describe("sales access", () => {
  it("shows prices to admin, staff, and read only", () => {
    assert.equal(salesAccessForRole("admin", true).canViewMoney, true);
    assert.equal(salesAccessForRole("staff", true).canViewMoney, true);
    assert.equal(salesAccessForRole("read_only", true).canViewMoney, true);
    assert.equal(salesAccessForRole("read_only", true).canEdit, false);
  });

  it("hides prices from a warehouse role", () => {
    const access = salesAccessForRole("warehouse_clerk", true);
    assert.equal(access.canViewMoney, false);
    assert.equal(access.canEdit, false);
  });

  it("lets the open app edit while sign-in is off", () => {
    assert.deepEqual(salesAccessForRole(null, false), { canEdit: true, canViewMoney: true });
  });
});
