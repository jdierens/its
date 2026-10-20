import assert from "node:assert/strict";
import test from "node:test";
import { binPath, isScannerBurst, parseScan } from "./scan.ts";

const ITEM = "3f3826a6-1492-4a4e-a2bd-64a53922c549";

test("an item QR opens that item and keeps the sku", () => {
  assert.deepEqual(parseScan(`https://its-epks.vercel.app/items/${ITEM}?sku=107131`), {
    kind: "item",
    id: ITEM,
    sku: "107131",
  });
  assert.deepEqual(parseScan(`/items/${ITEM}`), { kind: "item", id: ITEM, sku: null });
});

test("a bin reference is five digits, a hyphen, and P, C, or B", () => {
  assert.deepEqual(parseScan("20000-p"), { kind: "bin", reference: "20000-P" });
  assert.deepEqual(parseScan("20001-C"), { kind: "bin", reference: "20001-C" });
  assert.equal(parseScan("20000-X"), null);
  assert.deepEqual(parseScan("9999-P"), { kind: "sku", sku: "9999-P" });
  assert.equal(binPath("20000-P"), "/warehouse/bins/20000-P");
});

test("code 128 text is a sku, and a web address that is not an item is ignored", () => {
  assert.deepEqual(parseScan(" 107131 "), { kind: "sku", sku: "107131" });
  assert.equal(parseScan("https://example.com/nope"), null);
  assert.equal(parseScan(""), null);
});

test("a scanner burst is fast, and ordinary typing is not", () => {
  assert.equal(isScannerBurst(8, 120), true);
  assert.equal(isScannerBurst(3, 40), false);
  assert.equal(isScannerBurst(8, 2000), false);
});
