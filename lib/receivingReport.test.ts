import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  RECEIPT_DETAIL_ORDER,
  RECEIPT_SUMMARY_DEFAULT_SORT,
  compareReceiptDetail,
  receiptReportFileName,
  receiptsDetailCsv,
  formatPutawayQty,
  sortReceiptSummary,
  summarizeReceipts,
  summaryCsv,
  summaryItemLabel,
  summaryPutawaySortLabel,
  toggleReceiptSummarySort,
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
    vendorName: null,
    ownership: null,
    poNumber: null,
    basis: "",
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
    const special = summarizeReceipts([
      entry({ id: "s1", itemId: "a", sku: "100", itemName: "Drive", qty: 1, binReference: "00000-x" }),
      entry({ id: "s2", itemId: "a", sku: "100", itemName: "Drive", qty: 2, putaway: "rcv · " }),
    ]);
    assert.match(special[0]?.locations ?? "", /00000-X/);
    assert.match(special[0]?.locations ?? "", /RCV/);
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

describe("receipt detail order", () => {
  it("puts the newest data stamp first and does not use the receiving date", () => {
    assert.equal(RECEIPT_DETAIL_ORDER.stamp, "occurred_at");
    assert.notEqual(RECEIPT_DETAIL_ORDER.stamp, "received_on");
    const sorted = [
      { id: "b", occurredAt: "2026-11-02T18:00:00.000Z", receivedOn: "2026-01-01" },
      { id: "a", occurredAt: "2026-11-02T18:00:00.000Z", receivedOn: "2026-12-31" },
      { id: "old", occurredAt: "2026-11-01T00:00:00.000Z", receivedOn: "2026-11-02" },
    ].sort(compareReceiptDetail);
    assert.deepEqual(
      sorted.map((row) => row.id),
      ["b", "a", "old"],
    );
  });
});

describe("receipt csv", () => {
  it("writes a summary with a pending bucket and neutralizes formulas", () => {
    const rows: ReceiptSummaryRow[] = [
      { sku: "100", name: "apple", search: "", qty: 5, lines: 2, locations: "(x14)10002-C | (x8)10037", pending: false },
      { sku: "", name: "", search: "=cmd|", qty: 4, lines: 1, locations: "", pending: true },
    ];
    const csv = summaryCsv(rows);
    assert.ok(csv.startsWith("\uFEFFSKU,Item,Qty,Putaway,Lines,Status\r\n"));
    assert.match(csv, /100,apple,5,\(x14\)10002-C \| \(x8\)10037,2,\r\n/);
    assert.match(csv, /,'=cmd\|,4,,1,Pending item\r\n/);
    assert.equal(summaryItemLabel(rows[0]!), "apple");
    assert.equal(summaryItemLabel({ pending: true, name: "Drive", search: " SRM7H " }), "SRM7H");
    assert.equal(summaryItemLabel({ pending: false, name: "  ", search: "SRM7H" }), "");
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
      /Date,Initials,Project,Incoming bin,System,System Qty,Search,SKU,Item name,Item Qty,Putaway,Comment,Cleaned,Wiped,Damaged,Vendor,Basis,PO/,
    );
    assert.match(csv, /"2\.5"" drive",,,3,10010-C · HWS\.00\.00\.00,left bay,,,,,,\r\n/);
    assert.match(csv, /,94415,Processor,1,,ok,yes,,,,,\r\n/);
  });

  it("names the file from the project", () => {
    assert.equal(receiptReportFileName("summary", " Rack 4 / West ", "2026-10-26"), "receipt-summary-rack-4-west-2026-10-26.csv");
    assert.equal(receiptReportFileName("receipts", "  ", "2026-10-26"), "receipts-no-project-2026-10-26.csv");
  });
});

describe("receipt summary sort", () => {
  const rows: ReceiptSummaryRow[] = [
    { sku: "200", name: "Zebra", search: "", qty: 2, lines: 1, locations: "(x2)20000-B", pending: false },
    { sku: "20", name: "apple", search: "", qty: 10, lines: 3, locations: "(x99)10002-C | (x1)10010-C", pending: false },
    { sku: "100", name: "Drive", search: "", qty: 4, lines: 2, locations: "(x1)10037-B", pending: false },
    { sku: "", name: "", search: "samsung 860", qty: 8, lines: 2, locations: "(x8)10082-C", pending: true },
    { sku: "", name: "", search: "", qty: 1, lines: 1, locations: "", pending: true },
  ];

  function labels(sorted: readonly ReceiptSummaryRow[]): string[] {
    return sorted.map((row) => summaryItemLabel(row) || row.sku || "(blank)");
  }

  it("opens on item name, linked SKUs first, which is the order summarizeReceipts already returns", () => {
    const summarized = summarizeReceipts([
      entry({ id: "1", itemId: "b", sku: "200", itemName: "Zebra", qty: 2 }),
      entry({ id: "2", itemId: "a", sku: "100", itemName: "apple", qty: 4 }),
      entry({ id: "3", qty: 3, searchQuery: "samsung 860" }),
      entry({ id: "4", qty: 1, searchQuery: "  " }),
    ]);
    assert.deepEqual(RECEIPT_SUMMARY_DEFAULT_SORT, { key: "item", dir: "asc" });
    assert.deepEqual(sortReceiptSummary(summarized, RECEIPT_SUMMARY_DEFAULT_SORT), summarized);
    assert.deepEqual(
      labels(sortReceiptSummary([...summarized].reverse(), RECEIPT_SUMMARY_DEFAULT_SORT)),
      labels(summarized),
    );
  });

  it("toggles direction and starts a new column ascending", () => {
    assert.deepEqual(toggleReceiptSummarySort(RECEIPT_SUMMARY_DEFAULT_SORT, "item"), { key: "item", dir: "desc" });
    assert.deepEqual(toggleReceiptSummarySort({ key: "item", dir: "desc" }, "item"), { key: "item", dir: "asc" });
    assert.deepEqual(toggleReceiptSummarySort(RECEIPT_SUMMARY_DEFAULT_SORT, "qty"), { key: "qty", dir: "asc" });
  });

  it("sorts every summary column", () => {
    assert.deepEqual(labels(sortReceiptSummary(rows, { key: "item", dir: "asc" })), ["apple", "Drive", "Zebra", "samsung 860", "(blank)"]);
    assert.deepEqual(labels(sortReceiptSummary(rows, { key: "item", dir: "desc" })), ["(blank)", "samsung 860", "Zebra", "Drive", "apple"]);
    assert.deepEqual(
      sortReceiptSummary(rows, { key: "sku", dir: "asc" }).map((row) => row.sku || summaryItemLabel(row) || "(blank)"),
      ["20", "100", "200", "samsung 860", "(blank)"],
    );
    assert.deepEqual(
      sortReceiptSummary(rows, { key: "sku", dir: "desc" }).map((row) => row.sku || summaryItemLabel(row) || "(blank)"),
      ["200", "100", "20", "samsung 860", "(blank)"],
    );
    assert.deepEqual(
      sortReceiptSummary(rows, { key: "qty", dir: "asc" }).map((row) => row.qty),
      [1, 2, 4, 8, 10],
    );
    assert.deepEqual(
      sortReceiptSummary(rows, { key: "qty", dir: "desc" }).map((row) => row.qty),
      [10, 8, 4, 2, 1],
    );
    assert.deepEqual(summaryPutawaySortLabel("(x99)10002-C | (x1)10010-C"), "10002-C | 10010-C");
    assert.deepEqual(
      sortReceiptSummary(rows, { key: "putaway", dir: "asc" }).map((row) => summaryItemLabel(row) || "(blank)"),
      ["apple", "Drive", "samsung 860", "Zebra", "(blank)"],
    );
    assert.deepEqual(
      sortReceiptSummary(rows, { key: "putaway", dir: "desc" }).map((row) => summaryItemLabel(row) || "(blank)"),
      ["Zebra", "samsung 860", "Drive", "apple", "(blank)"],
    );
    assert.deepEqual(
      sortReceiptSummary(rows, { key: "lines", dir: "asc" }).map((row) => summaryItemLabel(row) || "(blank)"),
      ["Zebra", "(blank)", "Drive", "samsung 860", "apple"],
    );
    assert.deepEqual(
      sortReceiptSummary(rows, { key: "status", dir: "asc" }).map((row) => row.pending),
      [false, false, false, true, true],
    );
    assert.deepEqual(
      sortReceiptSummary(rows, { key: "status", dir: "desc" }).map((row) => row.pending),
      [true, true, false, false, false],
    );
  });

  it("breaks an item-name tie by SKU and otherwise keeps arrival order", () => {
    const tied: ReceiptSummaryRow[] = [
      { sku: "2", name: "Same", search: "", qty: 1, lines: 1, locations: "(x1)10002-C", pending: false },
      { sku: "1", name: "Same", search: "", qty: 1, lines: 1, locations: "(x4)10002-C", pending: false },
    ];
    assert.deepEqual(
      sortReceiptSummary(tied, { key: "item", dir: "asc" }).map((row) => row.sku),
      ["1", "2"],
    );
    assert.deepEqual(
      sortReceiptSummary(tied, { key: "qty", dir: "desc" }).map((row) => row.sku),
      ["2", "1"],
    );
  });

  it("sorts the summary from the same heading control as the other tables", () => {
    const page = readFileSync(new URL("../components/ReceiptReports.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    assert.match(page, /aria-sort=/);
    assert.match(page, /receive-col-sort/);
    assert.match(page, /sortReceiptSummary/);
    assert.match(page, /RECEIPT_SUMMARY_DEFAULT_SORT/);
    assert.match(css, /\.receive-col-sort/);
  });
});
