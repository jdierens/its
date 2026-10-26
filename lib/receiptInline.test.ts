import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planReceiptEdit, receiptLineAfterPick, skuFinderSeed } from "@/lib/receiptInline";
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
    binReference: "20042-B",
    searchQuery: null,
    ...overrides,
  };
}

describe("inline receipt edit", () => {
  it("opens a pending SKU finder on the stored search", () => {
    assert.equal(skuFinderSeed(entry()), "94415");
    assert.equal(skuFinderSeed(entry({ itemId: "", sku: "", searchQuery: " SRM7H " })), "SRM7H");
    assert.equal(skuFinderSeed(entry({ itemId: "", sku: "PARTIAL", searchQuery: "SRM7H" })), "PARTIAL");
    assert.equal(skuFinderSeed(entry({ itemId: "  ", sku: "  ", searchQuery: null })), "");
  });

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

  it("rejects a bad date or qty and asks before a posted putaway bin change", () => {
    assert.equal(planReceiptEdit(entry(), { receivedOn: "yesterday" }, false).action, "invalid");
    assert.equal(planReceiptEdit(entry(), { qty: "-1" }, false).action, "invalid");
    assert.equal(planReceiptEdit(entry(), { originQty: "" }, false).action, "save");
    const cleared = planReceiptEdit(entry(), { originQty: "" }, false);
    if (cleared.action !== "save") return;
    assert.equal(cleared.body.originQty, null);
    assert.equal(cleared.body.binReference, "20042-B");
    const moved = planReceiptEdit(entry(), { bin: "10059-C" }, false);
    assert.equal(moved.action, "confirm");
    if (moved.action !== "confirm") return;
    assert.match(moved.summary, /Move 4 pcs of 94415 from bin 20042-B to bin 10059-C/);
    assert.match(moved.summary, /out of the old bin/);
    const saved = planReceiptEdit(entry(), { bin: "10059-c" }, true);
    assert.equal(saved.action, "save");
    if (saved.action !== "save") return;
    assert.equal(saved.body.binReference, "10059-C");
    assert.equal(planReceiptEdit(entry(), { bin: "20042-B" }, false).action, "unchanged");
    const bad = planReceiptEdit(entry(), { bin: "nope" }, false);
    assert.equal(bad.action, "invalid");
    if (bad.action !== "invalid") return;
    assert.match(bad.message, /five digits/);
    const both = planReceiptEdit(entry(), { bin: "10059-C", qty: "6" }, false);
    assert.equal(both.action, "confirm");
    if (both.action !== "confirm") return;
    assert.match(both.summary, /qty from 4 to 6/);
    assert.match(both.summary, /to bin 10059-C/);
  });

  it("keeps the stored search when another cell or the SKU changes, and saves a search correction without a stock confirm", () => {
    const stored = entry({ searchQuery: "samsung 860" });
    const comment = planReceiptEdit(stored, { comment: "relocated" }, false);
    assert.equal(comment.action, "save");
    if (comment.action !== "save") return;
    assert.equal(comment.body.searchQuery, "samsung 860");

    const cleared = planReceiptEdit(stored, { searchQuery: "  " }, false);
    assert.equal(cleared.action, "save");
    if (cleared.action !== "save") return;
    assert.equal(cleared.body.searchQuery, null);

    const same = planReceiptEdit(stored, { searchQuery: " samsung 860 " }, false);
    assert.equal(same.action, "unchanged");

    const picked = planReceiptEdit(
      stored,
      { item: { id: "item-2", sku: "1001", name: "Widget" } },
      true,
    );
    assert.equal(picked.action, "save");
    if (picked.action !== "save") return;
    assert.equal(picked.body.searchQuery, "samsung 860");
    assert.equal(picked.body.sku, "1001");
    assert.equal(picked.body.itemId, "item-2");
  });

  it("saves a pending line without an item, and posts stock only when that item is linked", () => {
    const pending = entry({
      sku: "",
      itemName: "",
      itemId: "",
      searchQuery: "samsung 860",
      cleaned: null,
      wiped: null,
      shortCode: null,
      longCode: null,
      taxonomyName: null,
    });
    const qty = planReceiptEdit(pending, { qty: "6" }, false);
    assert.equal(qty.action, "save");
    if (qty.action !== "save") return;
    assert.equal(qty.body.itemId, "");
    assert.equal(qty.body.qty, 6);
    assert.equal(qty.body.cleaned, null);
    assert.equal(qty.body.wiped, null);

    const search = planReceiptEdit(pending, { searchQuery: "M393A8G40BB4-CWE" }, false);
    assert.equal(search.action, "save");
    if (search.action !== "save") return;
    assert.equal(search.body.searchQuery, "M393A8G40BB4-CWE");

    const bin = planReceiptEdit(pending, { bin: "10059-c" }, false);
    assert.equal(bin.action, "save");
    if (bin.action !== "save") return;
    assert.equal(bin.body.binReference, "10059-C");

    assert.equal(planReceiptEdit(pending, { searchQuery: " " }, false).action, "invalid");
    assert.equal(planReceiptEdit(pending, { qty: "0" }, false).action, "invalid");
    const flagged = planReceiptEdit(pending, { cleaned: true, wiped: true }, false);
    assert.equal(flagged.action, "unchanged");

    const link = planReceiptEdit(
      pending,
      { item: { id: "item-9", sku: "94415", name: "Drive", shortCode: "CPU", longCode: "CPU/PRC", taxonomyName: "CPU" } },
      false,
    );
    assert.equal(link.action, "confirm");
    if (link.action !== "confirm") return;
    assert.match(link.summary, /Link 94415 and put 4 pcs into bin 20042-B/);
    assert.doesNotMatch(link.summary, /adjustment/);
    assert.equal(link.body.cleaned, false);
    assert.equal(link.body.wiped, null);
    const posted = planReceiptEdit(
      pending,
      { item: { id: "item-9", sku: "94415", name: "Drive", shortCode: "CPU", longCode: "CPU/PRC", taxonomyName: "CPU" } },
      true,
    );
    assert.equal(posted.action, "save");

    const again = planReceiptEdit(
      entry({ searchQuery: "samsung 860" }),
      { item: { id: "item-2", sku: "1001", name: "Widget" } },
      false,
    );
    assert.equal(again.action, "confirm");
    if (again.action !== "confirm") return;
    assert.match(again.summary, /adjustment/);
  });
});
