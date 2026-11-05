import assert from "node:assert/strict";
import test from "node:test";
import { parseSpreadsheet } from "./data/parseTable.ts";
import {
  quoteExportDocument,
  quoteExportFilename,
  quoteExportLines,
  quoteExportPercent,
  quoteExportQty,
  quoteExportQtyText,
  quoteExportWorkbook,
  quoteForecastProfit,
  quoteForecastProfitTotal,
  type QuoteExportSource,
} from "./quoteExport.ts";

function line(patch: Partial<QuoteExportSource> = {}): QuoteExportSource {
  return {
    sku: "",
    itemName: "",
    partNumber: "",
    qty: "",
    replyQty: "",
    ...patch,
  };
}

test("export quantity prefers the reply and prints a whole number", () => {
  assert.equal(quoteExportQty({ qty: "470", replyQty: "10" }), "10");
  assert.equal(quoteExportQty({ qty: "470", replyQty: "" }), "470");
  assert.equal(quoteExportQtyText(71712), "71,712");
  assert.equal(quoteExportQtyText(71712.4), "71,712");
  const rows = quoteExportLines([
    line(),
    line({ sku: " 107314 ", itemName: "", partNumber: "MTA18", qty: "71712", replyQty: "10" }),
    line({ sku: "200", itemName: "32G", qty: "2" }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.sku, "107314");
  assert.equal(rows[0]?.name, "MTA18");
  assert.equal(rows[0]?.qty, "10");
  assert.equal(rows[0]?.qtyNumber, 10);
  assert.equal(rows[1]?.name, "32G");
  assert.equal(rows[1]?.qtyNumber, 2);
});

test("the spreadsheet is SKU, Name, and Qty with a whole-number format", async () => {
  assert.equal(quoteExportFilename("Archer 2 (AR2)"), "archer-2-ar2.xlsx");
  assert.equal(quoteExportFilename("   "), "quote.xlsx");
  const rows = quoteExportLines([
    line({ sku: "107314", itemName: "16G module", qty: "470" }),
    line({ sku: "200", itemName: "32G", qty: "71,712" }),
  ]);
  const bytes = await quoteExportWorkbook(rows);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const parsed = await parseSpreadsheet(copy, "quote.xlsx");
  assert.deepEqual(parsed.sheets[0]?.headers, ["SKU", "Name", "Qty"]);
  assert.deepEqual(parsed.sheets[0]?.rows[0], ["107314", "16G module", "470"]);
  assert.deepEqual(parsed.sheets[0]?.rows[1], ["200", "32G", "71,712"]);
  assert.equal(parsed.sheets[0]?.name, "Quote");
});

test("the PDF uses bidder codes and margins profit against the FSP extension", () => {
  assert.deepEqual(quoteForecastProfit(580, 700), { dollars: 120, ratio: 120 / 700 });
  assert.deepEqual(quoteForecastProfit(580, null), { dollars: null, ratio: null });
  assert.equal(quoteForecastProfit(100, 0).ratio, null);
  assert.equal(quoteExportPercent(120 / 700), "17.1%");

  const sheet = quoteExportDocument({
    ddsColumnCode: "hpe",
    ddsBidNote: "DDS proposed HPE.",
    lines: [
      {
        sku: "107314",
        itemName: "",
        partNumber: "MTA18",
        qty: "470",
        replyQty: "10",
        unitPrice: "58",
        bids: [
          {
            bidderName: "Forecast",
            unitPrice: "70",
            columnCode: "sal",
            bidNote: "Forecast sale.",
            bidderClass: "fsp",
          },
          { bidderName: "Acme", unitPrice: "40", columnCode: "acm", bidNote: "", bidderClass: "cmp" },
        ],
      },
      {
        sku: "200",
        itemName: "32G",
        partNumber: "",
        qty: "2",
        replyQty: "",
        unitPrice: "185.50",
        bids: [
          { bidderName: "Forecast", unitPrice: "215", columnCode: "sal", bidNote: "Forecast sale.", bidderClass: "fsp" },
          { bidderName: "Acme", unitPrice: "", columnCode: "acm", bidNote: "", bidderClass: "cmp" },
        ],
      },
    ],
  });

  assert.deepEqual(
    sheet.columns.map((column) => column.header),
    ["HPE", "SAL", "ACM"],
  );
  assert.equal(sheet.columns.some((column) => column.header === "FMP" || column.header === "FSP" || column.header === "DDS"), false);
  assert.equal(sheet.rows[0]?.qty, "10");
  assert.equal(sheet.rows[0]?.prices[0]?.ext, 580);
  assert.equal(sheet.rows[0]?.prices[1]?.ext, 700);
  assert.equal(sheet.rows[0]?.fgpDollars, 120);
  assert.equal(sheet.rows[0]?.fgpRatio, 120 / 700);
  assert.equal(sheet.rows[1]?.fgpDollars, 59);
  assert.equal(sheet.rows[1]?.fgpRatio, 59 / 430);
  assert.equal(sheet.showProfit, true);
  assert.deepEqual(sheet.totals.fgp, quoteForecastProfitTotal([
    { dollars: 120, sales: 700 },
    { dollars: 59, sales: 430 },
  ]));
  assert.equal(sheet.totals.fgp.dollars, 179);
  assert.equal(sheet.totals.fgp.ratio, 179 / 1130);
  assert.deepEqual(
    sheet.notes.map((note) => note.note),
    ["DDS proposed HPE.", "Forecast sale."],
  );

  const noFsp = quoteExportDocument({
    ddsColumnCode: "HPE",
    ddsBidNote: "",
    lines: [
      {
        sku: "1",
        itemName: "Drive",
        partNumber: "",
        qty: "71712",
        unitPrice: "10",
        bids: [{ bidderName: "Acme", unitPrice: "9", columnCode: "acm", bidderClass: "cmp" }],
      },
    ],
  });
  assert.equal(noFsp.showProfit, false);
  assert.equal(noFsp.rows[0]?.qty, "71,712");
  assert.equal(noFsp.totals.qty, 71712);
});
