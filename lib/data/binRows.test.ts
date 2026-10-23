import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBinRows,
  composeBinCode,
  counterAfterImport,
  importRowsFromMapped,
  type BinImportContext,
} from "./binRows.ts";

const context: BinImportContext = {
  existingByNumber: new Map([[20000, "20000-B"]]),
  locations: new Set(["HWS.01.02.03", "HWS.00.00.00", "HWR.00.00.00"]),
  defaults: { B: "HWS.00.00.00", C: "HWS.00.00.00", P: "HWR.00.00.00" },
  nextNumber: 20001,
};

test("a short code is zero-padded and a type column supplies the suffix", () => {
  assert.equal(composeBinCode("1234", "Box"), "01234-B");
  assert.equal(composeBinCode("1234", "crate"), "01234-C");
  assert.equal(composeBinCode("1234", "P"), "01234-P");
  assert.equal(composeBinCode("12345", "Pallet"), "12345-P");
  assert.equal(composeBinCode("12345-b", ""), "12345-B");
  assert.equal(composeBinCode("1234-c", "Box"), "01234-C");
  assert.equal(composeBinCode("12", ""), "00012");
  assert.equal(composeBinCode(" 12345 - B ", ""), "12345-B");
  assert.deepEqual(
    importRowsFromMapped([
      { code: "1234", type: "Box", location: " HWS.01.02.03 ", note: " shelf " },
      { code: "", type: "", location: "", note: "" },
    ]),
    [{ code: "01234-B", location: "HWS.01.02.03", note: "shelf" }],
  );
});

test("bin rows are classified before anything is written", () => {
  const result = classifyBinRows(
    [
      { code: "20050-B", location: "HWS.01.02.03", note: "existing shelf box" },
      { code: "NOPE", location: "HWS.01.02.03", note: "" },
      { code: "20051-B", location: "NOWHERE", note: "" },
      { code: "20050-B", location: "HWS.01.02.03", note: "again" },
      { code: "20000-B", location: "", note: "" },
      { code: "20000-C", location: "HWS.01.02.03", note: "" },
      { code: "20052-P", location: "", note: "" },
    ],
    context,
  );

  assert.deepEqual(
    result.rows.map((row) => [row.status, row.reason, row.location]),
    [
      ["new", null, "HWS.01.02.03"],
      ["error", "A bin code is five digits, a hyphen, and B, C, or P.", "HWS.01.02.03"],
      ["error", "Unknown location NOWHERE.", "NOWHERE"],
      ["error", "Duplicate in file.", "HWS.01.02.03"],
      ["exists", "Already exists.", ""],
      ["error", "Duplicate in file.", "HWS.01.02.03"],
      ["new", null, "HWR.00.00.00"],
    ],
  );
  assert.deepEqual(result.counter, { before: 20001, after: 20053, bumped: true });
});

test("a different suffix on a number that already exists is an error", () => {
  const result = classifyBinRows([{ code: "20000-C", location: "HWS.01.02.03", note: "" }], context);
  assert.equal(result.rows[0]?.status, "error");
  assert.equal(result.rows[0]?.reason, "20000 is already used by 20000-B.");
});

test("a blank location without a default is an error and does not move the counter", () => {
  const result = classifyBinRows([{ code: "20010-B", location: "", note: "" }], {
    ...context,
    defaults: {},
    nextNumber: 30000,
  });
  assert.equal(result.rows[0]?.reason, "No default location for this bin type.");
  assert.deepEqual(result.counter, { before: 30000, after: 30000, bumped: false });
});

test("the counter moves only when an imported number reaches it", () => {
  assert.deepEqual(counterAfterImport(20001, [20000, 12345]), {
    before: 20001,
    after: 20001,
    bumped: false,
  });
  assert.deepEqual(counterAfterImport(20001, [20001]), {
    before: 20001,
    after: 20002,
    bumped: true,
  });
});
