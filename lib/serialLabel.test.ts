import assert from "node:assert/strict";
import test from "node:test";
import { mmToCssPx } from "./binLabelLayout.ts";
import {
  SERIAL_BARCODE_HEIGHT_MM,
  SERIAL_BARCODE_MAX_MM,
  SERIAL_DESCRIPTION_MAX,
  SERIAL_HEAD_GAP_MM,
  SERIAL_HUMAN_FONT_MM,
  SERIAL_LABEL_PAD_X_MM,
  SERIAL_LABEL_SHOW_QTY,
  SERIAL_LABEL_SIZE,
  SERIAL_LABEL_WIDTH_MM,
  SERIAL_QUIET_MODULES,
  addSerial,
  code128SymbolModules,
  serialBarcodePlan,
  serialLabelDescription,
  serialHumanFontMm,
  serialLabelHeadMode,
  serialLabelQrPayload,
  serialLabelQtyText,
  serialPrintProblem,
  serialsToPrint,
} from "./serialLabel.ts";

const LONG =
  "2U rail kit for the SRM7C chassis, includes left and right rails, mounting screws, and the cable management arm for a full rack install";

test("serial description stays on two lines and ends with an ellipsis", () => {
  assert.equal(serialLabelDescription("Rail kit"), "Rail kit");
  const shown = serialLabelDescription(LONG);
  assert.ok(shown.endsWith("…"));
  assert.ok(shown.length <= SERIAL_DESCRIPTION_MAX);
  assert.ok(shown.length < LONG.length);
});

test("serial label size is named like the 29 × 90 mm item label", () => {
  assert.equal(SERIAL_LABEL_SIZE, "62 × 100 mm");
});

test("107132 and SRM7C-1 keep the description beside the SKU", () => {
  const head = mmToCssPx(SERIAL_LABEL_WIDTH_MM - SERIAL_LABEL_PAD_X_MM * 2);
  const gap = mmToCssPx(SERIAL_HEAD_GAP_MM);
  const qty = 36;
  // Rendered widths of bold 4.4 mm Helvetica: 107132 is 55 px, SRM7C-1 is 73 px.
  assert.equal(serialLabelHeadMode({ headPx: head, skuPx: 55, qtyPx: qty, gapPx: gap }), "inline");
  assert.equal(serialLabelHeadMode({ headPx: head, skuPx: 73, qtyPx: qty, gapPx: gap }), "inline");
  const inlineRoom = head - 73 - qty - gap * 2;
  assert.ok(inlineRoom > head * 0.5);
});

test("a SKU that would leave the description under half the line drops it below", () => {
  const head = mmToCssPx(SERIAL_LABEL_WIDTH_MM - SERIAL_LABEL_PAD_X_MM * 2);
  const gap = mmToCssPx(SERIAL_HEAD_GAP_MM);
  const qty = mmToCssPx(16);
  const sku = head * 0.55;
  assert.equal(serialLabelHeadMode({ headPx: head, skuPx: sku, qtyPx: qty, gapPx: gap }), "stacked");
});

test("barcode bars are about 30 percent shorter and keep the quiet zone", () => {
  assert.ok(Math.abs(SERIAL_BARCODE_HEIGHT_MM - 19.6) < 0.001);
  assert.equal(SERIAL_LABEL_SHOW_QTY, false);
});

test("the serial under the bars grows by half and shrinks only to fit the label", () => {
  assert.equal(SERIAL_HUMAN_FONT_MM, 6);
  assert.equal(serialHumanFontMm({ textWidthPx: 80, maxWidthPx: 200, baseFontMm: 6 }), 6);
  const fitted = serialHumanFontMm({ textWidthPx: 200, maxWidthPx: 100, baseFontMm: 6 });
  assert.ok(Math.abs(fitted - 3) < 0.001);
  assert.ok(fitted <= 6);
});

test("hiding quantity gives that width to the description", () => {
  const head = mmToCssPx(SERIAL_LABEL_WIDTH_MM - SERIAL_LABEL_PAD_X_MM * 2);
  const gap = mmToCssPx(SERIAL_HEAD_GAP_MM);
  const withQty = head - 73 - 36 - gap * 2;
  const withoutQty = head - 73 - gap;
  assert.ok(withoutQty > withQty + 30);
  assert.equal(serialLabelHeadMode({ headPx: head, skuPx: 73, qtyPx: 0, gapPx: gap }), "inline");
});

test("quantity is printed as Qty N and stays inside 0 to 9999", () => {
  assert.equal(serialLabelQtyText("5"), "Qty 5");
  assert.equal(serialLabelQtyText(""), "Qty 0");
  assert.equal(serialLabelQtyText("10000"), "Qty 9999");
});

test("SN2K9X4471AB fits a Code 128 with a ten-module quiet zone", () => {
  const serial = "SN2K9X4471AB";
  const target = mmToCssPx(SERIAL_BARCODE_MAX_MM);
  const plan = serialBarcodePlan(serial, target);
  assert.equal(code128SymbolModules(serial), 12 * 11 + 35);
  assert.equal(plan.quietModules, SERIAL_QUIET_MODULES);
  assert.equal(plan.fits, true);
  assert.ok(plan.dots >= 4);
  assert.ok(plan.totalPx <= target + 0.5);
  assert.ok(plan.quietPx >= plan.modulePx * 10 - 0.01);
  assert.ok(plan.heightPx >= mmToCssPx(15));
});

test("QR payload uses pipes and always splits into four fields", () => {
  const payload = serialLabelQrPayload({
    sku: "SRM7C-1",
    name: "Rail | kit | left",
    quantity: "5",
    serial: "SN|2K9X4471AB",
  });
  assert.equal(payload, "SRM7C-1|Rail kit left|5|SN 2K9X4471AB");
  assert.deepEqual(payload.split("|"), ["SRM7C-1", "Rail kit left", "5", "SN 2K9X4471AB"]);
  const numbered = serialLabelQrPayload({ sku: "A", name: "B", quantity: "Qty 5", serial: "SN" });
  assert.equal(numbered.split("|")[2], "5");
  const capped = serialLabelQrPayload({ sku: "A", name: "B", quantity: "10000", serial: "SN" });
  assert.equal(capped.split("|")[2], "9999");
});

test("a payload field that is only pipes becomes an empty part", () => {
  const payload = serialLabelQrPayload({ sku: "|", name: "", quantity: "|5|", serial: "SN" });
  assert.deepEqual(payload.split("|"), ["", "", "5", "SN"]);
});

test("each scan adds a serial, and a repeat does not", () => {
  const first = addSerial([], "  SN2K9X4471AB ");
  assert.equal(first.status, "added");
  assert.deepEqual(first.list, ["SN2K9X4471AB"]);
  const again = addSerial(first.list, "sn2k9x4471ab");
  assert.equal(again.status, "duplicate");
  assert.deepEqual(again.list, ["SN2K9X4471AB"]);
  assert.equal(addSerial(first.list, "   ").status, "empty");
});

test("print uses the list and a serial still in the field", () => {
  assert.deepEqual(serialsToPrint(["SN1"], ""), ["SN1"]);
  assert.deepEqual(serialsToPrint(["SN1"], "SN2"), ["SN1", "SN2"]);
  assert.deepEqual(serialsToPrint(["SN1"], "sn1"), ["SN1"]);
  assert.equal(serialPrintProblem({ hasItem: false, serialCount: 1 }), "Select an item before printing.");
  assert.equal(serialPrintProblem({ hasItem: true, serialCount: 0 }), "Enter a serial number before printing.");
  assert.equal(serialPrintProblem({ hasItem: true, serialCount: 2 }), null);
});
