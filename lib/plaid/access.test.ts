import assert from "node:assert/strict";
import test from "node:test";
import { bankFeedAllowed } from "./access.ts";

test("bank feeds are open while sign-in is off and limited to admin and staff when it is on", () => {
  assert.equal(bankFeedAllowed(null, false), true);
  assert.equal(bankFeedAllowed("admin", true), true);
  assert.equal(bankFeedAllowed("staff", true), true);
  assert.equal(bankFeedAllowed("read_only", true), false);
  assert.equal(bankFeedAllowed(null, true), false);
});
