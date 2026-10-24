import assert from "node:assert/strict";
import test from "node:test";
import { itemListQueryToken, itemListSearchNote } from "./itemListQuery.ts";

test("a multi-word items query searches the longest token", () => {
  assert.equal(itemListQueryToken("KR M393A8G40BB4-CWE 2349"), "M393A8G40BB4-CWE");
  assert.equal(itemListSearchNote("KR M393A8G40BB4-CWE 2349"), "Searched M393A8G40BB4-CWE.");
  assert.equal(itemListQueryToken("AB12 WXYZ 99"), "AB12");
  assert.equal(itemListQueryToken("WXYZ AB12"), "AB12");
  assert.equal(itemListSearchNote("WXYZ AB12"), "Searched AB12.");
});

test("one word keeps the whole query and shows no note", () => {
  assert.equal(itemListQueryToken("1001"), "1001");
  assert.equal(itemListSearchNote("1001"), null);
  assert.equal(itemListQueryToken("  "), "");
  assert.equal(itemListSearchNote(""), null);
});
