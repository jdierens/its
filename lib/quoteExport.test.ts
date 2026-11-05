import assert from "node:assert/strict";
import test from "node:test";
import { parseSpreadsheet } from "./data/parseTable.ts";
import {
  quoteExportFilename,
  quoteExportLines,
  quoteExportQty,
  quoteExportTotals,
  quoteExportWorkbook,
  type QuoteExportSource,
} from "./quoteExport.ts";

function line(patch: Partial<QuoteExportSource> = {}): QuoteExportSource {
  return {
    sku: "",
    itemName: "",
    partNumber: "",
    qty: "",
    replyQty: "",
    unitPrice: "",
    fspUnit: "",
    ...patch,
  };
}

test("export quantity prefers the reply and skips a blank line", () => {
  assert.equal(quoteExportQty({ qty: "470", replyQty: "10" }), "10");
  assert.equal(quoteExportQty({ qty: "470", replyQty: "" }), "470");
  const rows = quoteExportLines([
    line(),
    line({
      sku: " 107314 ",
      itemName: "",
      partNumber: "MTA18",
      qty: "470",
      replyQty: "10",
      unitPrice: "58",
      fspUnit: "70",
    }),
    line({ sku: "200", itemName: "32G", qty: "2", unitPrice: "185.50", fspUnit: "215" }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.sku, "107314");
  assert.equal(rows[0]?.name, "MTA18");
  assert.equal(rows[0]?.qty, "10");
  assert.equal(rows[0]?.bidExt, 580);
  assert.equal(rows[0]?.fmpExt, 700);
  assert.equal(rows[1]?.name, "32G");
  assert.equal(rows[1]?.bidExt, 371);
  assert.equal(rows[1]?.fmpExt, 430);
  assert.deepEqual(quoteExportTotals(rows), { qty: 12, bidExt: 951, fmpExt: 1130 });
});

test("the spreadsheet is SKU, Name, and Qty", async () => {
  assert.equal(quoteExportFilename("Archer 2 (AR2)"), "archer-2-ar2.xlsx");
  assert.equal(quoteExportFilename("   "), "quote.xlsx");
  const rows = quoteExportLines([line({ sku: "107314", itemName: "16G module", qty: "470" })]);
  const bytes = await quoteExportWorkbook(rows);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const parsed = await parseSpreadsheet(copy, "quote.xlsx");
  assert.deepEqual(parsed.sheets[0]?.headers, ["SKU", "Name", "Qty"]);
  assert.deepEqual(parsed.sheets[0]?.rows[0], ["107314", "16G module", "470"]);
  assert.equal(parsed.sheets[0]?.name, "Quote");
});
