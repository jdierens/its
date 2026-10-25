import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planReceiptEdit, receiptLineAfterPick } from "@/lib/receiptInline";
import type { ReceivingEntry } from "@/lib/receivingSettings";

function entry(overrides: Partial<ReceivingEntry> = {}): ReceivingEntry {
  return {
    id: "evt-1",
    receivedOn: "2026-10-22",
    initials: "JD",
    project: "AZSIM",
    incomingBin: "IN-1",
    originatingSystem: "AZSIM",
    originQty: 12,
    sku: "94415",
    itemName: "Drive",
    itemId: "item-1",
    qty: 4,
    comment: "shelf",
    edited: false,
    editedBy: null,
    cleaned: null,
    wiped: null,
    shortCode: "MEM",
    longCode: "DIM/MEM",
    taxonomyName: "memory",
    putaway: "20042-B · HWS.00.00.00",
    ...overrides,
  };
}

describe("inline receipt edit", () => {
  it("saves a comment without asking, and ignores a value that did not change", () => {
    const changed = planReceiptEdit(entry(), { comment: " relocated " }, false);
    assert.equal(changed.action, "save");
    if (changed.action !== "save") return;
    assert.equal(changed.body.comment, "relocated");
    assert.equal(changed.body.qty, 4);
    assert.equal(changed.body.itemId, "item-1");
    assert.equal(planReceiptEdit(entry(), { comment: "shelf" }, false).action, "unchanged");
    assert.equal(planReceiptEdit(entry(), { project: " AZSIM " }, false).action, "unchanged");
  });

  it("asks before a qty or item change, then saves once that is confirmed", () => {
    const qty = planReceiptEdit(entry(), { qty: "5" }, false);
    assert.equal(qty.action, "confirm");
    if (qty.action !== "confirm") return;
    assert.match(qty.summary, /qty from 4 to 5/);
    assert.equal(planReceiptEdit(entry(), { qty: "5" }, true).action, "save");

    const sku = planReceiptEdit(
      entry(),
      { item: { id: "item-2", sku: "1001", name: "Widget", shortCode: "CPU", longCode: "CPU/PRC", taxonomyName: "CPU" } },
      false,
    );
    assert.equal(sku.action, "confirm");
    if (sku.action !== "confirm") return;
    assert.match(sku.summary, /SKU from 94415 to 1001/);
    assert.equal(sku.body.cleaned, false);
    assert.equal(sku.body.wiped, null);
    assert.deepEqual(
      receiptLineAfterPick(entry(), { id: "item-2", sku: "1001", name: "Widget" }),
      { sku: "1001", itemName: "Widget" },
    );
    assert.deepEqual(receiptLineAfterPick(entry(), { id: "item-2", sku: "1001", name: "" }), {
      sku: "1001",
      itemName: "",
    });
    assert.deepEqual(receiptLineAfterPick(entry(), { id: "item-1", sku: "94415", name: "Other" }), {
      sku: "94415",
      itemName: "Drive",
    });
    assert.deepEqual(receiptLineAfterPick(entry(), null), { sku: "94415", itemName: "Drive" });
  });

  it("stores Cleaned or Wiped only for the taxonomy that asks, without a stock confirm", () => {
    const cpu = entry({ shortCode: "CPU", longCode: "CPU/PRC", taxonomyName: "CPU", cleaned: false });
    const cleaned = planReceiptEdit(cpu, { cleaned: true }, false);
    assert.equal(cleaned.action, "save");
    if (cleaned.action !== "save") return;
    assert.equal(cleaned.body.cleaned, true);
    assert.equal(cleaned.body.wiped, null);

    const drive = entry({ shortCode: "SSD", longCode: "DSK/SSD", taxonomyName: "SSD", wiped: false });
    const wiped = planReceiptEdit(drive, { wiped: true }, false);
    assert.equal(wiped.action, "save");
    if (wiped.action !== "save") return;
    assert.equal(wiped.body.cleaned, null);
    assert.equal(wiped.body.wiped, true);
  });

  it("rejects a bad date or qty and leaves the destination bin alone", () => {
    assert.equal(planReceiptEdit(entry(), { receivedOn: "yesterday" }, false).action, "invalid");
    assert.equal(planReceiptEdit(entry(), { qty: "-1" }, false).action, "invalid");
    assert.equal(planReceiptEdit(entry(), { originQty: "" }, false).action, "save");
    const cleared = planReceiptEdit(entry(), { originQty: "" }, false);
    if (cleared.action !== "save") return;
    assert.equal(cleared.body.originQty, null);
    assert.equal("putaway" in cleared.body, false);
  });
});
