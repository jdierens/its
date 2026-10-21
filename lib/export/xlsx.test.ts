import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { toXlsx } from "./xlsx.ts";

test("xlsx is a workbook of inline strings with formulas already prefixed", () => {
  const bytes = toXlsx({
    headers: ["SKU", "Name"],
    rows: [["'=1+1", "a<b & c"]],
  });
  const files = unzipSync(bytes);
  assert.ok(files["[Content_Types].xml"]);
  assert.ok(files["xl/workbook.xml"]);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"] ?? new Uint8Array());
  assert.match(sheet, /inlineStr/);
  assert.match(sheet, /'=1\+1/);
  assert.match(sheet, /a&lt;b &amp; c/);
  assert.doesNotMatch(sheet, /<t[^>]*>'=1\+1<\/t>[\s\S]*=1\+1/);
});
