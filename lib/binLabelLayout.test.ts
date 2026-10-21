import assert from "node:assert/strict";
import test from "node:test";
import {
  BIN_BARCODE_FORMAT,
  BIN_BARCODE_MAX_MM,
  BIN_LABEL_BRAND,
  mmToCssPx,
  quietInsetRatio,
  scaledModuleWidth,
} from "./binLabelLayout.ts";

test("a bin barcode is Code 128 of the reference, with DDS beside it", () => {
  assert.equal(BIN_BARCODE_FORMAT, "CODE128");
  assert.equal(BIN_LABEL_BRAND, "DDS");
  assert.equal(BIN_BARCODE_MAX_MM, 84);
});

test("the barcode grows to the label width and the text inset matches the quiet zone", () => {
  assert.equal(scaledModuleWidth(100, 250), 2.5);
  assert.equal(scaledModuleWidth(0, 250), 1);
  assert.ok(Math.abs(mmToCssPx(25.4) - 96) < 0.001);
  assert.equal(quietInsetRatio(200, 20), 0.1);
  assert.equal(quietInsetRatio(0, 20), 0);
});
