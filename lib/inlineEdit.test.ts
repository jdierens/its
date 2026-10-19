import assert from "node:assert/strict";
import test from "node:test";
import {
  cellKeyAction,
  editedLabel,
  isConflictMessage,
  isEditableColumn,
  patchRow,
  priceError,
  validateCell,
} from "./inlineEdit.ts";
import type { ItemListRow } from "./types.ts";

function row(patch: Partial<ItemListRow> = {}): ItemListRow {
  return {
    id: "1",
    sku: "107075",
    name: "Memory",
    quantity: 1,
    taxonomyName: "memory",
    shortCode: "MEM",
    imageUrl: null,
    manufacturerId: null,
    manufacturerName: null,
    model: "",
    partNumber: "",
    condition: "Used",
    conditionNote: "pulled",
    eccn: "5A992.C",
    usHts: "",
    ccats: "",
    coo: "",
    ecommercePrice: null,
    marketPrice: null,
    msrp: null,
    updatedAt: "2026-10-19T18:00:00.000Z",
    fields: { speed: "4800" },
    ...patch,
  };
}

test("sku and taxonomy stay read-only while trade and attribute cells edit", () => {
  assert.equal(isEditableColumn("sku"), false);
  assert.equal(isEditableColumn("taxonomy"), false);
  assert.equal(isEditableColumn("name"), false);
  assert.equal(isEditableColumn("model"), true);
  assert.equal(isEditableColumn("coo"), true);
  assert.equal(isEditableColumn("ecommerce_price"), true);
  assert.equal(isEditableColumn("attr:speed"), true);
});

test("enter edits a writable cell and opens a read-only one", () => {
  assert.equal(cellKeyAction({ key: "Enter", editable: true, meta: false, ctrl: false, alt: false }), "edit");
  assert.equal(cellKeyAction({ key: "Enter", editable: false, meta: false, ctrl: false, alt: false }), "open");
  assert.equal(cellKeyAction({ key: "a", editable: true, meta: false, ctrl: false, alt: false }), "type");
  assert.equal(cellKeyAction({ key: "a", editable: true, meta: true, ctrl: false, alt: false }), null);
  assert.equal(cellKeyAction({ key: "/", editable: true, meta: false, ctrl: false, alt: false }), null);
});

test("cell checks match the item form", () => {
  assert.equal(validateCell({ columnId: "us_hts", value: "8471.30.0100", condition: "Used" }).error, null);
  assert.match(validateCell({ columnId: "us_hts", value: "84-71", condition: "Used" }).error ?? "", /digits/);
  assert.equal(validateCell({ columnId: "eccn", value: "  ", condition: "Used" }).value, "5A992.C");
  assert.equal(validateCell({ columnId: "condition_note", value: "Factory Sealed", condition: "New" }).error, null);
  assert.match(
    validateCell({ columnId: "condition_note", value: "pulled", condition: "New" }).error ?? "",
    /Factory Sealed/,
  );
  assert.equal(
    validateCell({ columnId: "condition", value: "New", condition: "Used", conditionNote: "pulled" }).conditionNote,
    "",
  );
  assert.equal(validateCell({ columnId: "attr:speed", value: "12.5", condition: "Used", dataType: "integer" }).error, "Enter a whole number.");
  assert.equal(priceError("-1"), "Enter a price with up to 2 decimal places.");
  assert.equal(priceError("12.5"), null);
  assert.equal(priceError(""), null);
});

test("a stale row is recognized from the server message", () => {
  assert.equal(isConflictMessage("This row was edited somewhere else. Reload it and try again."), true);
  assert.equal(isConflictMessage("US HTS must be digits"), false);
});

test("changing condition clears a note that no longer fits", () => {
  const next = patchRow(row(), "condition", "New");
  assert.equal(next.condition, "New");
  assert.equal(next.conditionNote, "");
});

test("the edited time is shown in Pacific time", () => {
  assert.equal(editedLabel("2026-10-19T18:00:00.000Z"), "Oct 19, 11:00 AM");
});
