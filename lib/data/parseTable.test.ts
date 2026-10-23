import assert from "node:assert/strict";
import test from "node:test";
import { instructionRows, templateCsv } from "./csv.ts";
import { detectDelimiter, parseCsvText, parseSpreadsheet, stripBom } from "./parseTable.ts";
import { BINS_TABLE, exportColumns, importSizeError, type DataTable } from "./registry.ts";
import { templateWorkbook } from "./templateWorkbook.ts";

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function arrayBufferOf(raw: ArrayBuffer | Uint8Array | number[]): ArrayBuffer {
  if (raw instanceof ArrayBuffer) return raw;
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test("delimiters and a UTF-8 BOM are detected", () => {
  assert.equal(stripBom("\uFEFFcode,location"), "code,location");
  assert.equal(detectDelimiter("code,location,note"), ",");
  assert.equal(detectDelimiter("\uFEFFcode;location;note"), ";");
  assert.equal(detectDelimiter("Bin #\tShelf\tComment"), "\t");
  assert.equal(detectDelimiter('code,"a;b",note'), ",");
  assert.equal(detectDelimiter("only"), ",");

  const parsed = parseCsvText("\uFEFFcode;location;note\r\n12345-B;HWS.01.02.03;existing shelf box\r\n");
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.sheets[0]?.headers, ["code", "location", "note"]);
  assert.deepEqual(parsed.sheets[0]?.rows, [["12345-B", "HWS.01.02.03", "existing shelf box"]]);
});

test("an xlsx workbook and an xls workbook use the first sheet's grid", async () => {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Bin #", "Shelf", "Comment", "Type"],
    ["1234", "HWS.01.02.03", "existing shelf box", "Box"],
    ["20000", "HWS.00.00.00", "", "Crate"],
  ]);
  const other = XLSX.utils.aoa_to_sheet([["Ignore me"]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Jan");
  XLSX.utils.book_append_sheet(workbook, other, "Other");

  for (const bookType of ["xlsx", "xls"] as const) {
    const raw = XLSX.write(workbook, { type: "array", bookType }) as ArrayBuffer | Uint8Array | number[];
    const parsed = await parseSpreadsheet(arrayBufferOf(raw), `jan.${bookType}`);
    assert.deepEqual(parsed.sheets.map((item) => item.name), ["Jan", "Other"]);
    assert.deepEqual(parsed.sheets[0]?.headers, ["Bin #", "Shelf", "Comment", "Type"]);
    assert.equal(parsed.sheets[0]?.rows[0]?.[0], "1234");
    assert.equal(parsed.sheets[0]?.rows[1]?.[3], "Crate");
  }

  const csv = await parseSpreadsheet(bytesOf("\uFEFFa\tb\n1\t2\n"), "jan.csv");
  assert.equal(csv.delimiter, "\t");
  assert.deepEqual(csv.sheets[0]?.rows, [["1", "2"]]);
});

test("the template is generated from the importer column spec", async () => {
  const csv = templateCsv(BINS_TABLE);
  assert.equal(csv, "\uFEFFcode,location,note\r\n12345-B,HWS.01.02.03,existing shelf box\r\n");
  const instructions = instructionRows(BINS_TABLE, { location: ["HWS", "HWR"] });
  assert.equal(instructions[0]?.required, "Required");
  assert.equal(instructions[1]?.required, "Optional");
  assert.match(instructions[0]?.allowed ?? "", /B box/);
  assert.match(instructions[1]?.allowed ?? "", /HWS, HWR/);
  assert.equal(instructions.find((row) => row.column === "type")?.required, "Optional — not in the template");
  assert.equal(instructions.some((row) => row.column === "qty"), false);

  const bytes = await templateWorkbook(BINS_TABLE, { location: ["HWS", "HWR"] });
  const parsed = await parseSpreadsheet(arrayBufferOf(bytes), "bins-template.xlsx");
  assert.deepEqual(parsed.sheets.map((sheet) => sheet.name), ["Bins", "Instructions"]);
  assert.deepEqual(parsed.sheets[0]?.headers, ["code", "location", "note"]);
  assert.deepEqual(parsed.sheets[0]?.rows[0], ["12345-B", "HWS.01.02.03", "existing shelf box"]);
  assert.equal(parsed.sheets[1]?.headers[1], "Required");
  assert.match(parsed.sheets[1]?.rows.map((row) => row.join(" ")).join("\n"), /HWS, HWR/);
});

test("import limits and money columns", () => {
  assert.equal(importSizeError(10, 10), null);
  assert.match(importSizeError(3 * 1024 * 1024, 1) ?? "", /2 MB/);
  assert.match(importSizeError(1, 5001) ?? "", /5000/);
  const table: DataTable = {
    ...BINS_TABLE,
    exportOrder: ["code", "cost"],
    columns: [
      ...BINS_TABLE.columns,
      {
        key: "cost",
        required: false,
        template: false,
        export: true,
        money: true,
        format: "",
        example: "1.00",
        description: "Cost",
        allowed: [],
        synonyms: [],
      },
    ],
  };
  assert.deepEqual(exportColumns(table, true).map((column) => column.key), ["code", "cost"]);
  assert.deepEqual(exportColumns(table, false).map((column) => column.key), ["code"]);
});
