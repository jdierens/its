import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import {
  DEFAULT_LABEL_TEMPLATE,
  LABEL_TEMPLATES,
  QR_ERROR_CORRECTION,
  QR_MODULE_MM,
  QR_QUIET_MODULES,
  labelTemplateOrDefault,
  qrLabelPayload,
  qrSymbolMm,
} from "./labelTemplates.ts";

const ITEM_ID = "3f3826a6-1492-4a4e-a2bd-64a53922c549";

test("label template defaults to the barcode and ignores unknown values", () => {
  assert.equal(DEFAULT_LABEL_TEMPLATE, "barcode");
  assert.deepEqual(
    LABEL_TEMPLATES.map((template) => template.label),
    ["Barcode (current)", "QR code"],
  );
  assert.equal(labelTemplateOrDefault(null), "barcode");
  assert.equal(labelTemplateOrDefault(""), "barcode");
  assert.equal(labelTemplateOrDefault("poster"), "barcode");
  assert.equal(labelTemplateOrDefault("barcode"), "barcode");
  assert.equal(labelTemplateOrDefault("qr"), "qr");
});

test("qr payload uses the public origin and keeps a blank sku off the query", () => {
  assert.equal(
    qrLabelPayload("https://its-epks.vercel.app", ITEM_ID, "107131"),
    `https://its-epks.vercel.app/items/${ITEM_ID}?sku=107131`,
  );
  assert.equal(
    qrLabelPayload("https://its-epks.vercel.app/", ITEM_ID, "  "),
    `https://its-epks.vercel.app/items/${ITEM_ID}`,
  );
  assert.equal(
    qrLabelPayload("http://127.0.0.1:3000", ITEM_ID, "A&B"),
    `http://127.0.0.1:3000/items/${ITEM_ID}?sku=A%26B`,
  );
});

test("qr modules are five printer dots and a version 5 symbol is about 19 mm", () => {
  assert.equal(QR_ERROR_CORRECTION, "M");
  assert.equal(QR_QUIET_MODULES, 4);
  assert.ok(Math.abs(QR_MODULE_MM - (5 * 25.4) / 300) < 1e-12);
  const side = qrSymbolMm(37);
  assert.ok(Math.abs(side - 45 * QR_MODULE_MM) < 1e-12);
  assert.ok(Math.abs(side - 19.05) < 0.001);
});

test("the production item url picks QR version 5 at error correction M", () => {
  const payload = qrLabelPayload("https://its-epks.vercel.app", ITEM_ID, "107131");
  const symbol = QRCode.create(payload, { errorCorrectionLevel: "M" });
  assert.equal(symbol.version, 5);
  assert.equal(symbol.modules.size, 37);
});
