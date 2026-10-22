import assert from "node:assert/strict";
import test from "node:test";
import { adoptExternalQuery } from "./queryDraft.ts";

test("keys typed after a published prefix stay in the field", () => {
  assert.equal(
    adoptExternalQuery({
      focused: true,
      draft: "CPU\\PLATINUM8468V\\SRM7C_QA",
      external: "CPU\\PLAT",
      published: "CPU\\PLAT",
    }),
    null,
  );
});

test("a focused field ignores an older address value", () => {
  assert.equal(
    adoptExternalQuery({
      focused: true,
      draft: "CPU\\PLATINUM",
      external: "CPU",
      published: "",
    }),
    null,
  );
});

test("back and forward restore the query when the field is idle", () => {
  assert.equal(
    adoptExternalQuery({
      focused: false,
      draft: "CPU",
      external: "HDD",
      published: "CPU",
    }),
    "HDD",
  );
});

test("an address update that matches the field is not written again", () => {
  assert.equal(
    adoptExternalQuery({ focused: false, draft: "CPU", external: "CPU", published: "" }),
    null,
  );
  assert.equal(
    adoptExternalQuery({ focused: false, draft: "CPU ", external: "CPU", published: "CPU" }),
    null,
  );
});
