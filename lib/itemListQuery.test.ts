import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { itemListQueryToken, itemListQueryTokens, itemListSearchNote } from "./itemListQuery.ts";

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

test("a pipe is OR and each alternative still uses the longest word", () => {
  assert.deepEqual(itemListQueryTokens("7060DX5"), ["7060DX5"]);
  assert.deepEqual(itemListQueryTokens("7060DX5|7060PX5"), ["7060DX5", "7060PX5"]);
  assert.deepEqual(itemListQueryTokens("7060DX5 | 7060PX5"), ["7060DX5", "7060PX5"]);
  assert.deepEqual(itemListQueryTokens("|7060DX5||7060PX5|"), ["7060DX5", "7060PX5"]);
  assert.deepEqual(itemListQueryTokens("7060-DX5|7060/PX5"), ["7060-DX5", "7060/PX5"]);
  assert.deepEqual(itemListQueryTokens("||"), []);
  assert.deepEqual(itemListQueryTokens("KR M393A8G40BB4-CWE 2349"), ["M393A8G40BB4-CWE"]);
  assert.deepEqual(itemListQueryTokens("KR M393A8G40BB4-CWE 2349 | 7060PX5"), ["M393A8G40BB4-CWE", "7060PX5"]);
  assert.equal(itemListSearchNote("7060DX5 | 7060PX5"), null);
  assert.equal(itemListSearchNote("KR M393A8G40BB4-CWE 2349"), "Searched M393A8G40BB4-CWE.");
  const source = readFileSync(new URL("./itemListSearch.ts", import.meta.url), "utf8");
  assert.match(source, /itemListQueryTokens\(q\)/);
});
