import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import {
  BIN_COPY_MAX,
  BIN_PRINT_MAX,
  DEFAULT_BIN_NEXT_NUMBER,
  binCreatedLabel,
  formatBinReference,
  nextNumberError,
  parseBinRange,
  parseBinReference,
  parsePrintCount,
} from "./bins.ts";

test("bin references are number-type and share one counter format", () => {
  assert.equal(DEFAULT_BIN_NEXT_NUMBER, 20000);
  assert.equal(formatBinReference(20000, "P"), "20000-P");
  assert.equal(formatBinReference(20001, "B"), "20001-B");
  assert.equal(formatBinReference(20002, "C"), "20002-C");
  assert.deepEqual(parseBinReference(" 20000-p "), {
    number: 20000,
    type: "P",
    reference: "20000-P",
  });
  assert.equal(parseBinReference("10001-C")?.reference, "10001-C");
  assert.equal(parseBinReference("020000-P"), null);
  assert.equal(parseBinReference("20000-X"), null);
  assert.equal(parseBinReference("20000"), null);
  assert.equal(parseBinReference("0-P"), null);
});

test("the next bin number cannot land on an issued number", () => {
  assert.equal(nextNumberError(20000, null), null);
  assert.equal(nextNumberError(1, null), null);
  assert.match(nextNumberError(0, null) ?? "", /at least 1/);
  assert.match(nextNumberError(1.5, null) ?? "", /at least 1/);
  assert.match(nextNumberError(20000, 20000) ?? "", /20000/);
  assert.match(nextNumberError(19999, 20000) ?? "", /higher than the highest issued number \(20000\)/);
  assert.equal(nextNumberError(20001, 20000), null);
});

test("print counts and ranges stay inside the staff limits", () => {
  assert.equal(BIN_PRINT_MAX, 100);
  assert.equal(BIN_COPY_MAX, 50);
  assert.equal(parsePrintCount("1", 100), 1);
  assert.equal(parsePrintCount("100", 100), 100);
  assert.equal(parsePrintCount("101", 100), null);
  assert.equal(parsePrintCount("0", 100), null);
  assert.equal(parsePrintCount("01", 100), 1);
  assert.equal(parsePrintCount("1.5", 100), null);
  assert.deepEqual(parseBinRange("20000", "20002"), { from: 20000, to: 20002 });
  assert.equal(parseBinRange("1", "100")?.to, 100);
  assert.equal(parseBinRange("1", "101"), null);
  assert.equal(parseBinRange("5", "4"), null);
  assert.equal(parseBinRange("0", "3"), null);
});

test("created time is shown in Pacific time", () => {
  const label = binCreatedLabel("2026-10-19T22:00:00.000Z");
  assert.match(label, /Oct/);
  assert.match(label, /19/);
  assert.match(label, /2026/);
  assert.match(label, /PDT/);
  assert.equal(binCreatedLabel("not-a-date"), "");
});

test("a bin reference QR symbol encodes the reference at error correction M", () => {
  const symbol = QRCode.create("20000-P", { errorCorrectionLevel: "M" });
  assert.equal(symbol.version, 1);
  assert.equal(symbol.modules.size, 21);
});
