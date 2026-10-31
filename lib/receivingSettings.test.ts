import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RECEIVING_DATE_EDITABLE,
  RECEIVING_PAGE_SIZE,
  formatReceivedOn,
  beginReceiptSave,
  finishReceiptSave,
  originQtyInput,
  receiveLineQty,
  systemQtyMultipleWarning,
  putawayLabel,
  receiptBasis,
  receiptInitials,
  receiptSavedNote,
  receivingDateToStore,
  receivingEntryForViewer,
  receivingLastPage,
  receivingPageOffset,
  warehouseToday,
} from "@/lib/receivingSettings";

describe("saved receipt note", () => {
  it("names an empty bin when this receipt opens the fill, and an existing bin otherwise", () => {
    assert.equal(
      receiptSavedNote({ qty: 4, sku: "94415", reference: "10059-C", cycleOpened: true }),
      "Put Away 4Pcs SKU94415 into EMPTY bin 10059-C",
    );
    assert.equal(
      receiptSavedNote({ qty: 4, sku: " 94415 ", reference: "10059-C", cycleOpened: false }),
      "Added 4Pcs SKU94415 into bin 10059-C",
    );
    assert.equal(
      receiptSavedNote({ qty: 1, sku: "", name: "Loose drive", reference: "20042-B", cycleOpened: false }),
      "Added 1Pcs Loose drive into bin 20042-B",
    );
    assert.equal(
      receiptSavedNote({
        qty: 4,
        sku: "",
        reference: "10059-C",
        cycleOpened: false,
        pending: true,
        search: "samsung 860",
      }),
      'Saved 4 pcs of "samsung 860" into bin 10059-C (pending item)',
    );
    assert.doesNotMatch(
      receiptSavedNote({ qty: 4, sku: "94415", reference: "10059-C", cycleOpened: true, pending: true, search: "860" }),
      /Put Away|SKU/,
    );
  });
});

describe("receiving date", () => {
  it("defaults to the warehouse calendar day", () => {
    const morning = new Date("2026-10-23T06:30:00Z");
    assert.equal(warehouseToday(morning), "2026-10-22");
    assert.equal(RECEIVING_DATE_EDITABLE, true);
    assert.equal(receivingDateToStore("2026-10-01", morning), "2026-10-01");
    assert.throws(() => receivingDateToStore("10/01/2026", morning), /receiving date/);
    assert.throws(() => receivingDateToStore("2026-02-31", morning), /receiving date/);
  });
});

describe("one save click", () => {
  it("keeps a single request id until the receipt is stored", () => {
    const first = beginReceiptSave({ inFlight: false, requestId: null }, "click-1");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.requestId, "click-1");
    const doubled = beginReceiptSave(first.gate, "click-2");
    assert.equal(doubled.ok, false);
    const retry = beginReceiptSave(finishReceiptSave(first.gate, false), "click-2");
    assert.equal(retry.ok, true);
    if (!retry.ok) return;
    assert.equal(retry.requestId, "click-1");
    const again = beginReceiptSave(finishReceiptSave(retry.gate, true), "click-3");
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.requestId, "click-3");
  });
});

describe("originating system qty", () => {
  it("is an optional whole number", () => {
    assert.deepEqual(originQtyInput(""), { ok: true, qty: null });
    assert.deepEqual(originQtyInput(" 12 "), { ok: true, qty: 12 });
    assert.deepEqual(originQtyInput("0"), { ok: true, qty: 0 });
    assert.deepEqual(originQtyInput("12.5"), { ok: false });
    assert.deepEqual(originQtyInput("-1"), { ok: false });
  });
});

describe("system qty multiple", () => {
  it("warns only when a positive system qty does not divide the item qty", () => {
    assert.equal(systemQtyMultipleWarning(8, 4), null);
    assert.equal(systemQtyMultipleWarning(4, 4), null);
    assert.equal(systemQtyMultipleWarning(4, 1), null);
    assert.equal(systemQtyMultipleWarning(7, 4), "Item qty 7 is not a multiple of system qty 4.");
    assert.equal(systemQtyMultipleWarning(3, 6), "Item qty 3 is not a multiple of system qty 6.");
    assert.equal(systemQtyMultipleWarning(5, null), null);
    assert.equal(systemQtyMultipleWarning(5, 0), null);
    assert.equal(systemQtyMultipleWarning(0, 4), null);
  });
});

describe("receiving line qty", () => {
  it("stays missing when blank and refuses a number below 1", () => {
    assert.deepEqual(receiveLineQty(""), { ok: false, message: "Enter a quantity." });
    assert.deepEqual(receiveLineQty("   "), { ok: false, message: "Enter a quantity." });
    assert.deepEqual(receiveLineQty("0"), { ok: false, message: "Enter a whole number of at least 1." });
    assert.deepEqual(receiveLineQty("1.5"), { ok: false, message: "Enter a whole number of at least 1." });
    assert.deepEqual(receiveLineQty(" 4 "), { ok: true, qty: 4 });
  });
});

describe("recent receiving rows", () => {
  it("drops prices for a role that cannot see them and keeps the line fields", () => {
    const row = {
      id: "evt-1",
      received_on: "2026-10-22",
      occurred_at: "2026-10-23T01:00:00Z",
      qty: 4,
      comment: "shelf box",
      project: "AZSIM6903",
      operator_initials: " jd ",
      incoming_tag: "INCOMING AZSIM6903 P001",
      origin_description: "AZSIM",
      origin_qty: 12,
      unit_cost: "18.00",
      item_id: "item-1",
      items: { sku: "1001", unit_cost: "18.00", name: "Widget" },
    };
    const hidden = receivingEntryForViewer(row, false);
    assert.equal(JSON.stringify(hidden).includes("18.00"), false);
    assert.equal(JSON.stringify(hidden).includes("unit_cost"), false);
    assert.deepEqual(hidden, {
      id: "evt-1",
      receivedOn: "2026-10-22",
      initials: "JD",
      project: "AZSIM6903",
      incomingBin: "INCOMING AZSIM6903 P001",
      originatingSystem: "AZSIM",
      originQty: 12,
      sku: "1001",
      itemName: "Widget",
      itemId: "item-1",
      qty: 4,
      comment: "shelf box",
      edited: false,
      editedBy: null,
      cleaned: null,
      wiped: null,
      damaged: false,
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
    });
    const shown = receivingEntryForViewer(row, true);
    assert.equal(shown.sku, "1001");
    assert.equal(shown.itemName, "Widget");
    assert.equal(shown.originQty, 12);
    assert.equal(receiptInitials("OP"), "OP");
    assert.equal(receiptInitials("JAN"), "JAN");
    assert.equal(formatReceivedOn("2026-10-22"), "10/22/26");
    const located = receivingEntryForViewer(
      {
        ...row,
        cleaned: false,
        wiped: null,
        short_code: "CPU",
        long_code: "CPU/PRC",
        taxonomy_name: "CPU",
        bin_reference: "20042-B",
        location_code: "HWS.00.00.00",
      },
      true,
    );
    assert.equal(located.cleaned, false);
    assert.equal(located.wiped, null);
    assert.equal(located.shortCode, "CPU");
    assert.equal(located.putaway, "20042-B · HWS.00.00.00");
    assert.equal(located.binReference, "20042-B");
    const pending = receivingEntryForViewer(
      { ...row, item_id: null, sku: null, item_name: "", items: null, search_query: "samsung 860", bin_reference: "10059-C", location_code: "HWS.00.00.00" },
      true,
    );
    assert.equal(pending.itemId, "");
    assert.equal(pending.sku, "");
    assert.equal(pending.itemName, "");
    assert.equal(pending.searchQuery, "samsung 860");
    assert.equal(pending.putaway, "10059-C · HWS.00.00.00");
    assert.equal(
      receivingEntryForViewer({ ...row, search_query: "  samsung 860  " }, true).searchQuery,
      "samsung 860",
    );
    assert.equal(receiptBasis("consigned", null), "Consigned");
    assert.equal(receiptBasis(null, "1042"), "PO 1042");
    assert.equal(receiptBasis("consigned", "1042"), "Consigned");
    assert.equal(
      receivingEntryForViewer({ ...row, vendor_name: "Acme", ownership: "consigned", po_number: null }, true).basis,
      "Consigned",
    );
    assert.equal(putawayLabel("20042-B", null), "20042-B");
    assert.equal(putawayLabel(null, "HWS.03.01.02"), "HWS.03.01.02");
  });
});

describe("receiving pages", () => {
  it("pages 50 receipts and treats an empty list as one page", () => {
    assert.equal(RECEIVING_PAGE_SIZE, 50);
    assert.equal(receivingLastPage(0), 1);
    assert.equal(receivingLastPage(50), 1);
    assert.equal(receivingLastPage(51), 2);
    assert.equal(receivingPageOffset(1), 0);
    assert.equal(receivingPageOffset(3), 100);
    assert.equal(receivingPageOffset(0), 0);
  });
});
