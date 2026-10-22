import assert from "node:assert/strict";
import test from "node:test";
import { mmToCssPx } from "./binLabelLayout.ts";
import {
  SERIAL_BARCODE_MAX_MM,
  SERIAL_DESCRIPTION_MAX,
  SERIAL_QUIET_MODULES,
  addSerial,
  code128SymbolModules,
  serialBarcodePlan,
  serialLabelDescription,
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
