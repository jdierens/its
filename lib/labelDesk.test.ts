import assert from "node:assert/strict";
import test from "node:test";
import {
  labelCopiesCommit,
  labelCopiesDraft,
  labelQuantityCommit,
  labelQuantityDraft,
} from "./labelDesk.ts";

test("label quantity keeps up to four digits and clamps at 9999", () => {
  assert.equal(labelQuantityDraft("12a"), "12");
  assert.equal(labelQuantityDraft("0007"), "7");
  assert.equal(labelQuantityDraft("10000"), "9999");
  assert.equal(labelQuantityDraft(""), "");
  assert.equal(labelQuantityCommit(""), "0");
  assert.equal(labelQuantityCommit("40"), "40");
});

test("label copies stay from 1 to 99", () => {
  assert.equal(labelCopiesDraft("4"), "4");
  assert.equal(labelCopiesDraft("100"), "99");
  assert.equal(labelCopiesDraft("0"), "0");
  assert.equal(labelCopiesCommit(""), "1");
  assert.equal(labelCopiesCommit("0"), "1");
  assert.equal(labelCopiesCommit("12"), "12");
  assert.equal(labelCopiesCommit("99"), "99");
});
