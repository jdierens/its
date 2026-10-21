import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { applyItemMatch, mapImportSheet } from "./poLineImport.ts";
import { readTabularFile } from "./poSpreadsheet.ts";

test("a csv maps headers and fills a missing extension", () => {
  const table = readTabularFile(
    "lines.csv",
    new TextEncoder().encode("SKU,Qty,Unit,Unit Price,Description\nDDR4,2,Piece,40.50,32GB DIMM\n"),
  );
  const mapped = mapImportSheet(table);
  assert.equal(mapped.error, null);
  assert.equal(mapped.rows.length, 1);
  assert.equal(mapped.rows[0]?.itemSku, "DDR4");
  assert.equal(mapped.rows[0]?.extPrice, "81.00");
  assert.equal(mapped.rows[0]?.description, "32GB DIMM");
});

test("an unknown item stays as a description line", () => {
  const mapped = mapImportSheet([["Item ID", "Qty", "Ext Price"], ["NO-SUCH", "1", "12.00"]]);
  assert.equal(mapped.error, null);
  const finished = applyItemMatch(mapped.rows[0]!, null);
  assert.equal(finished.level, "warning");
  assert.equal(finished.itemId, "");
  assert.equal(finished.description, "NO-SUCH");
});

test("a known item keeps its id and name", () => {
  const mapped = mapImportSheet([["Item ID", "Qty", "Unit Price"], ["DDR4", "1", "10"]]);
  const finished = applyItemMatch(mapped.rows[0]!, {
    id: "11111111-1111-4111-8111-111111111111",
    sku: "DDR4",
    name: "32GB DIMM",
    description: "Registered ECC",
  });
  assert.equal(finished.level, "ok");
  assert.equal(finished.itemSku, "DDR4");
  assert.equal(finished.itemName, "32GB DIMM");
  assert.equal(finished.description, "Registered ECC");
  assert.notEqual(finished.description, finished.itemName);
});

test("mismatched prices are a row error", () => {
  const mapped = mapImportSheet([["Description", "Qty", "Unit Price", "Ext"], ["CPU", "2", "10", "15"]]);
  assert.equal(mapped.rows[0]?.level, "error");
});

test("xlsx cells come back as a table", () => {
  const shared =
    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>SKU</t></si><si><t>Qty</t></si><si><t>Unit Price</t></si><si><t>HDD1</t></si></sst>';
  const sheet =
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>4</v></c><c r="C2"><v>12.5</v></c></row></sheetData></worksheet>';
  const book =
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Lines" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels =
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
  const bytes = zipSync({
    "xl/sharedStrings.xml": strToU8(shared),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
    "xl/workbook.xml": strToU8(book),
    "xl/_rels/workbook.xml.rels": strToU8(rels),
  });
  const table = readTabularFile("lines.xlsx", bytes);
  const mapped = mapImportSheet(table);
  assert.equal(mapped.error, null);
  assert.equal(mapped.rows[0]?.itemSku, "HDD1");
  assert.equal(mapped.rows[0]?.qty, "4");
  assert.equal(mapped.rows[0]?.extPrice, "50.00");
});
