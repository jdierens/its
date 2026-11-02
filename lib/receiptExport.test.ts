import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeReceipts, summaryCsv } from "@/lib/receivingReport";
import type { ReceivingEntry } from "@/lib/receivingSettings";
import { receiptExportRequest, receiptListRefreshDelay } from "@/lib/receiptExport";

function entry(patch: Partial<ReceivingEntry> & Pick<ReceivingEntry, "id" | "qty">): ReceivingEntry {
  return {
    receivedOn: "2026-11-02",
    initials: "JD",
    project: "AZSIM",
    incomingBin: null,
    originatingSystem: null,
    originQty: null,
    sku: "94415",
    itemName: "Drive",
    itemId: "item-1",
    comment: null,
    edited: false,
    editedBy: null,
    cleaned: null,
    wiped: null,
    damaged: false,
    shortCode: null,
    longCode: null,
    taxonomyName: null,
    putaway: "10059-C",
    binReference: "10059-C",
    searchQuery: null,
    vendorName: null,
    vendorId: null,
    ownership: null,
    poNumber: null,
    basis: "",
    ...patch,
  };
}

describe("receipt export freshness", () => {
  it("does not wait to refresh the list after a save, and does not reuse a previous download", () => {
    assert.equal(receiptListRefreshDelay(false), 0);
    assert.equal(receiptListRefreshDelay(true), 300);

    const first = receiptExportRequest("AZSIM", "summary", 1);
    const again = receiptExportRequest("AZSIM", "summary", 2);
    assert.equal(first.cache, "no-store");
    assert.equal(again.cache, "no-store");
    assert.equal(first.headers["cache-control"], "no-cache");
    assert.notEqual(first.body, again.body);
    assert.match(first.body, /"project":"AZSIM"/);
    assert.match(again.body, /"kind":"summary"/);
    assert.match(receiptExportRequest("AZSIM", "detail", 3).body, /"kind":"detail"/);
  });

  it("includes a line that was just added in the summary file built from those receipts", () => {
    const before = [entry({ id: "1", qty: 4, sku: "94415", itemName: "Drive" })];
    const added = entry({ id: "2", qty: 2, sku: "100200", itemName: "Fresh line", itemId: "item-2" });
    const stale = summaryCsv(summarizeReceipts(before));
    const current = summaryCsv(summarizeReceipts([...before, added]));
    assert.doesNotMatch(stale, /100200/);
    assert.match(current, /100200/);
    assert.match(current, /Fresh line/);
    assert.match(current, /,2,/);
  });
});
