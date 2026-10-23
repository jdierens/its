import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RECEIVING_DATE_EDITABLE,
  formatReceivedOn,
  beginReceiptSave,
  finishReceiptSave,
  originQtyInput,
  receiptInitials,
  receivingDateToStore,
  receivingEntryForViewer,
  warehouseToday,
} from "@/lib/receivingSettings";

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
    });
    const shown = receivingEntryForViewer(row, true);
    assert.equal(shown.sku, "1001");
    assert.equal(shown.itemName, "Widget");
    assert.equal(shown.originQty, 12);
    assert.equal(receiptInitials("OP"), "OP");
    assert.equal(receiptInitials("JAN"), "JAN");
    assert.equal(formatReceivedOn("2026-10-22"), "10/22/26");
  });
});
