import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickAccessForRole } from "./pickAccess.ts";

describe("pick access", () => {
  it("lets staff and warehouse roles pick and keeps read_only from recording", () => {
    assert.equal(pickAccessForRole("admin", true).canPick, true);
    assert.equal(pickAccessForRole("staff", true).canPick, true);
    assert.equal(pickAccessForRole("warehouse_clerk", true).canPick, true);
    assert.equal(pickAccessForRole("read_only", true).canPick, false);
    assert.equal(pickAccessForRole(null, true).canPick, false);
    assert.equal(pickAccessForRole(null, false).canPick, true);
  });
});
