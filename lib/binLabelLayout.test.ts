import assert from "node:assert/strict";
import test from "node:test";
import {
  BIN_BARCODE_FORMAT,
  BIN_BARCODE_HEIGHT_PX,
  BIN_BARCODE_MAX_MM,
  BIN_LABEL_BRAND,
  BIN_LABEL_HEIGHT_MM,
  BIN_LABEL_SIZE,
  BIN_LABEL_WIDTH_MM,
  PALLET_BARCODE_HEIGHT_MM,
  PALLET_BARCODE_MAX_MM,
  PALLET_LABEL_HEIGHT_MM,
  PALLET_LABEL_SIZE,
  PALLET_LABEL_WIDTH_MM,
  PALLET_QR_MAX_MM,
  approxBoldWidthPx,
  binBarcodeLayout,
  binLabelAtPageMm,
  binLabelFrameClass,
  binLabelHitClass,
  binLabelNamedPage,
  binLabelPage,
  binLabelSheet,
  previewBinLabelSheet,
  fittedFontSize,
  mmToCssPx,
  palletQrSideMm,
  palletReferenceMaxFontMm,
  palletReferenceWidthMm,
  quietInsetRatio,
  scaledModuleWidth,
} from "./binLabelLayout.ts";

test("a bin barcode is Code 128 of the reference, with DDS beside it", () => {
  assert.equal(BIN_BARCODE_FORMAT, "CODE128");
  assert.equal(BIN_LABEL_BRAND, "DDS");
  assert.equal(BIN_BARCODE_MAX_MM, 84);
  assert.equal(BIN_BARCODE_HEIGHT_PX, 50);
});

test("the barcode grows to the label width and the text inset matches the quiet zone", () => {
  assert.equal(scaledModuleWidth(100, 250), 2.5);
  assert.equal(scaledModuleWidth(0, 250), 1);
  assert.ok(Math.abs(mmToCssPx(25.4) - 96) < 0.001);
  assert.equal(quietInsetRatio(200, 20), 0.1);
  assert.equal(quietInsetRatio(0, 20), 0);
});

test("crate and box stay on the 29 × 90 mm page", () => {
  assert.equal(BIN_LABEL_SIZE, "29 × 90 mm");
  assert.equal(BIN_LABEL_WIDTH_MM, 90);
  assert.equal(BIN_LABEL_HEIGHT_MM, 29);
  assert.equal(binBarcodeLayout("C"), "beside");
  assert.equal(binBarcodeLayout("B"), "beside");
  assert.deepEqual(binLabelPage("C"), binLabelPage("B"));
  assert.equal(binLabelPage("B").paper, "29 × 90 mm");
  assert.equal(binLabelPage("B").stock, "DK-1201");
  assert.equal(binLabelPage("C").widthMm, 90);
  assert.equal(binLabelPage("C").heightMm, 29);
});

test("a pallet label uses the 62 × 100 mm serial page and stacks DDS above the reference", () => {
  assert.equal(PALLET_LABEL_SIZE, "62 × 100 mm");
  assert.equal(PALLET_LABEL_WIDTH_MM, 100);
  assert.equal(PALLET_LABEL_HEIGHT_MM, 62);
  assert.equal(binBarcodeLayout("P"), "mixed");
  const page = binLabelPage("P");
  assert.equal(page.paper, "62 × 100 mm");
  assert.equal(page.stock, "DK-1202");
  assert.equal(page.widthMm, 100);
  assert.equal(page.heightMm, 62);
  assert.equal(PALLET_BARCODE_HEIGHT_MM, 16);
  assert.equal(PALLET_BARCODE_MAX_MM, 90);
  assert.ok(PALLET_BARCODE_MAX_MM <= palletReferenceWidthMm());
  assert.ok(PALLET_BARCODE_MAX_MM > BIN_BARCODE_MAX_MM);
});

test("the pallet reference fills the height under the bars and shrinks only to the width", () => {
  const base = palletReferenceMaxFontMm(PALLET_BARCODE_HEIGHT_MM);
  assert.ok(base > 28);
  const content = palletReferenceWidthMm();
  const textWidth = approxBoldWidthPx("20000-P", base);
  assert.ok(textWidth > content);
  const fitted = fittedFontSize({ textWidthPx: textWidth, maxWidthPx: content, basePx: base });
  assert.ok(fitted < base);
  assert.ok(fitted > 20);
  assert.equal(fittedFontSize({ textWidthPx: 40, maxWidthPx: 100, basePx: base }), base);
  assert.equal(fittedFontSize({ textWidthPx: 0, maxWidthPx: 100, basePx: base }), base);
  assert.equal(fittedFontSize({ textWidthPx: 40, maxWidthPx: 100, basePx: 0 }), 0);
  const short = fittedFontSize({
    textWidthPx: approxBoldWidthPx("1-P", base),
    maxWidthPx: content,
    basePx: base,
  });
  assert.equal(short, base);
});

test("a pallet QR stays on the 62 × 100 mm label and leaves room for the reference", () => {
  assert.equal(palletQrSideMm(0), 0);
  assert.equal(palletQrSideMm(12), PALLET_QR_MAX_MM);
  const dense = palletQrSideMm(80);
  assert.ok(dense < 80);
  assert.ok(dense <= palletReferenceWidthMm());
  assert.ok(palletReferenceMaxFontMm(dense) >= 10);
});

test("print page size follows the bin type, and a mixed job names only the pages that differ", () => {
  const pallet = binLabelSheet(["P", "P"]);
  assert.equal(pallet.mode, "pallet");
  assert.deepEqual(binLabelAtPageMm(pallet), { widthMm: 100, heightMm: 62 });
  assert.equal(binLabelNamedPage("P", pallet), null);

  const crate = binLabelSheet(["C", "B"]);
  assert.equal(crate.mode, "standard");
  assert.deepEqual(binLabelAtPageMm(crate), { widthMm: 90, heightMm: 29 });
  assert.equal(binLabelNamedPage("C", crate), null);
  assert.equal(binLabelNamedPage("B", crate), null);

  const palletFirst = binLabelSheet(["P", "C"]);
  assert.equal(palletFirst.mode, "mixed");
  assert.equal(palletFirst.defaultPallet, true);
  assert.deepEqual(binLabelAtPageMm(palletFirst), { widthMm: 100, heightMm: 62 });
  assert.equal(binLabelNamedPage("P", palletFirst), null);
  assert.equal(binLabelNamedPage("C", palletFirst), "bin-standard");

  const crateFirst = binLabelSheet(["B", "P"]);
  assert.equal(crateFirst.mode, "mixed");
  assert.equal(crateFirst.defaultPallet, false);
  assert.deepEqual(binLabelAtPageMm(crateFirst), { widthMm: 90, heightMm: 29 });
  assert.equal(binLabelNamedPage("B", crateFirst), null);
  assert.equal(binLabelNamedPage("P", crateFirst), "bin-pallet");

  assert.equal(binLabelSheet([]).mode, "standard");
});

test("a bin on screen keeps its page while idle, and an item print uses the short page", () => {
  const pallet = previewBinLabelSheet("P", false);
  assert.equal(pallet.mode, "pallet");
  assert.deepEqual(binLabelAtPageMm(pallet), { widthMm: 100, heightMm: 62 });

  const crate = previewBinLabelSheet("C", false);
  assert.equal(crate.mode, "standard");
  assert.deepEqual(binLabelAtPageMm(crate), { widthMm: 90, heightMm: 29 });
  assert.equal(previewBinLabelSheet("B", false).mode, "standard");

  const itemOnPallet = previewBinLabelSheet("P", true);
  assert.equal(itemOnPallet.mode, "standard");
  assert.deepEqual(binLabelAtPageMm(itemOnPallet), { widthMm: 90, heightMm: 29 });

  assert.equal(previewBinLabelSheet(null, false).mode, "standard");
  assert.equal(previewBinLabelSheet(undefined, false).mode, "standard");
  assert.equal(previewBinLabelSheet("pallet", false).mode, "standard");
});

test("the preview frame and hit target name a pallet without changing crate or box", () => {
  assert.equal(binLabelFrameClass("P"), "label-frame label-frame-pallet");
  assert.equal(binLabelFrameClass("C"), "label-frame");
  assert.equal(binLabelFrameClass("B"), "label-frame");
  assert.equal(binLabelFrameClass(null), "label-frame");
  assert.equal(binLabelHitClass("P"), "bin-label-hit bin-label-hit-pallet");
  assert.equal(binLabelHitClass("C"), "bin-label-hit");
  assert.equal(binLabelHitClass("B"), "bin-label-hit");
});
