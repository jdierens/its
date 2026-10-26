import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  receiptReportFileName,
  receiptsDetailCsv,
  formatPutawayQty,
  summarizeReceipts,
  summaryCsv,
  type ReceiptSummaryRow,
} from "@/lib/receivingReport";
import type { ReceivingEntry } from "@/lib/receivingSettings";

function entry(patch: Partial<ReceivingEntry> & Pick<ReceivingEntry, "id" | "qty">): ReceivingEntry {
  return {
    receivedOn: "2026-10-26",
    initials: "JD",
    project: "Rack 4",
    incomingBin: "IN-1",
    originatingSystem: "eBay",
    originQty: 2,
    sku: "",
    itemName: "",
    itemId: "",
    comment: null,
    edited: false,
    editedBy: null,
    cleaned: null,
    wiped: null,
    shortCode: null,
    longCode: null,
    taxonomyName: null,
    putaway: "",
    binReference: "",
    searchQuery: null,
    ...patch,
  };
}

describe("receipt summary", () => {
  it("totals one row per item, sorted by name, and keeps pending lines", () => {
    const rows = summarizeReceipts([
      entry({ id: "1", itemId: "b", sku: "200", itemName: "Zebra", qty: 2, searchQuery: "ignored" }),
      entry({ id: "2", itemId: "a", sku: "100", itemName: "apple", qty: 4 }),
      entry({ id: "3", itemId: "a", sku: "100", itemName: "apple", qty: 1 }),
      entry({ id: "4", qty: 3, searchQuery: "samsung 860", putaway: "10010-C" }),
      entry({ id: "5", qty: 1, searchQuery: "samsung 860" }),
      entry({ id: "6", qty: 8, searchQuery: "  " }),
      entry({ id: "7", qty: 2, searchQuery: null }),
    ]);

    assert.deepEqual(
      rows.map((row) => [row.sku, row.name, row.search, row.qty, row.lines, row.pending, row.locations]),
      [
        ["100", "apple", "", 5, 2, false, ""],
        ["200", "Zebra", "", 2, 1, false, ""],
        ["", "", "samsung 860", 4, 2, true, "(x3)10010-C"],
        ["", "", "", 10, 2, true, ""],
      ],
    );
  });

  it("lists quantity in each putaway bin", () => {
    assert.equal(
      formatPutawayQty(
        new Map([
          ["10037", 8],
          ["10002-C", 14],
        ]),
      ),
      "(x14)10002-C | (x8)10037",
    );
    const rows = summarizeReceipts([
      entry({ id: "1", itemId: "a", sku: "100", itemName: "Drive", qty: 14, binReference: "10002-C", putaway: "10002-C · HWS.00.00.00" }),
      entry({ id: "2", itemId: "a", sku: "100", itemName: "Drive", qty: 8, putaway: "10037-B · HWS.01.02.03" }),
      entry({ id: "3", itemId: "a", sku: "100", itemName: "Drive", qty: 1, binReference: "10002-c" }),
      entry({ id: "4", qty: 2, searchQuery: "loose dimm", putaway: "10082-C · HWS.00.00.00" }),
      entry({ id: "5", qty: 4, searchQuery: "loose dimm", binReference: "11103-P" }),
    ]);
    assert.equal(rows[0]?.qty, 23);
    assert.equal(rows[0]?.locations, "(x15)10002-C | (x8)10037-B");
    assert.equal(rows[1]?.locations, "(x2)10082-C | (x4)11103-P");
  });

  it("does not merge a pending search into a matched SKU", () => {
    const rows = summarizeReceipts([
      entry({ id: "1", itemId: "a", sku: "100", itemName: "Drive", qty: 1, searchQuery: "samsung 860" }),
      entry({ id: "2", qty: 9, searchQuery: "samsung 860" }),
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.qty, 1);
    assert.equal(rows[1]?.pending, true);
    assert.equal(rows[1]?.qty, 9);
  });
});

describe("receipt csv", () => {
  it("writes a summary with a pending bucket and neutralizes formulas", () => {
    const rows: ReceiptSummaryRow[] = [
      { sku: "100", name: "apple", search: "", qty: 5, lines: 2, locations: "(x14)10002-C | (x8)10037", pending: false },
      { sku: "", name: "", search: "=cmd|", qty: 4, lines: 1, locations: "", pending: true },
    ];
    const csv = summaryCsv(rows);
    assert.ok(csv.startsWith("\uFEFFSKU,Item name,Search,Qty,Putaway,Lines,Status\r\n"));
    assert.match(csv, /100,apple,,5,\(x14\)10002-C \| \(x8\)10037,2,\r\n/);
    assert.match(csv, /,,'=cmd\|,4,,1,Pending item\r\n/);
  });

  it("exports unmatched lines with cleaned and wiped columns", () => {
    const csv = receiptsDetailCsv([
      entry({
        id: "1",
        qty: 3,
        searchQuery: '2.5" drive',
        comment: "left bay",
        putaway: "10010-C · HWS.00.00.00",
        cleaned: null,
        wiped: null,
      }),
      entry({
        id: "2",
        itemId: "cpu",
        sku: "94415",
        itemName: "Processor",
        qty: 1,
        cleaned: true,
        wiped: null,
        comment: "ok",
      }),
    ]);
    assert.match(
      csv,
      /Date,Initials,Project,Incoming bin,System,System Qty,Search,SKU,Item name,Item Qty,Putaway,Comment,Cleaned,Wiped/,
    );
    assert.match(csv, /"2\.5"" drive",,,3,10010-C · HWS\.00\.00\.00,left bay,,\r\n/);
    assert.match(csv, /,94415,Processor,1,,ok,yes,\r\n/);
  });

  it("names the file from the project", () => {
    assert.equal(receiptReportFileName("summary", " Rack 4 / West ", "2026-10-26"), "receipt-summary-rack-4-west-2026-10-26.csv");
    assert.equal(receiptReportFileName("receipts", "  ", "2026-10-26"), "receipts-no-project-2026-10-26.csv");
  });
});
