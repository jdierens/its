import assert from "node:assert/strict";
import test from "node:test";
import { hidePurchaseMoney, normalizePurchaseOrderDraft, purchaseOrderTotal, type PoDraftInput } from "./purchaseOrderDraft.ts";

const vendorId = "11111111-1111-4111-8111-111111111111";

function draft(overrides: Partial<PoDraftInput> = {}): PoDraftInput {
  return {
    vendorId,
    fulfillment: "warehouse",
    terms: "Net30",
    orderedOn: "2026-10-21",
    expectedOn: "",
    vendorNotes: "",
    internalNotes: "",
    lines: [
      {
        itemId: "",
        description: "32GB DDR4",
        qty: "2",
        unitCost: "40.50",
        extPrice: "",
        condition: "Used",
        unit: "Piece",
      },
    ],
    ...overrides,
  };
}

test("a known line needs a vendor, a quantity, and a unit cost", () => {
  const missingVendor = normalizePurchaseOrderDraft(draft({ vendorId: "" }));
  assert.equal(missingVendor.ok, false);

  const missingCost = normalizePurchaseOrderDraft(
    draft({
      lines: [{ itemId: "", description: "DIMM", qty: "1", unitCost: "", extPrice: "", condition: "Used", unit: "Piece" }],
    }),
  );
  assert.equal(missingCost.ok, false);

  const saved = normalizePurchaseOrderDraft(draft());
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.lines[0]?.qty, 2);
  assert.equal(saved.value.lines[0]?.unitCost, 40.5);
  assert.equal(saved.value.lines[0]?.extPrice, 81);
  assert.equal(purchaseOrderTotal(saved.value.lines), 81);
  assert.equal(saved.value.terms, "Net30");
});

test("quantity, unit price, and extension have to agree", () => {
  const mismatch = normalizePurchaseOrderDraft(
    draft({
      lines: [
        {
          itemId: "",
          description: "CPU",
          qty: "2",
          unitCost: "10",
          extPrice: "15",
          condition: "Used",
          unit: "Piece",
        },
      ],
    }),
  );
  assert.equal(mismatch.ok, false);

  const fromExt = normalizePurchaseOrderDraft(
    draft({
      lines: [
        {
          itemId: "",
          description: "CPU",
          qty: "3",
          unitCost: "",
          extPrice: "10",
          condition: "Used",
          unit: "Piece",
        },
      ],
    }),
  );
  assert.equal(fromExt.ok, true);
  if (!fromExt.ok) return;
  assert.equal(fromExt.value.lines[0]?.unitCost, 3.3333);
  assert.equal(fromExt.value.lines[0]?.extPrice, 10);
});

test("terms must be one of the fixed values", () => {
  assert.equal(normalizePurchaseOrderDraft(draft({ terms: "Net 30" })).ok, false);
  assert.equal(normalizePurchaseOrderDraft(draft({ terms: "" })).ok, false);
  assert.equal(normalizePurchaseOrderDraft(draft({ terms: "Net15" })).ok, true);
});

test("a blank extra line is ignored", () => {
  const saved = normalizePurchaseOrderDraft(
    draft({
      lines: [
        { itemId: "", description: "CPU", qty: "1", unitCost: "10", extPrice: "", condition: "New", unit: "Piece" },
        { itemId: "", description: "", qty: "", unitCost: "", extPrice: "", condition: "Used", unit: "Piece" },
      ],
    }),
  );
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.lines.length, 1);
});

test("people who cannot see money do not receive costs", () => {
  const hidden = hidePurchaseMoney(
    { terms: "Net30", currency: "USD", unitCost: 12, extPrice: 24, internalNotes: "cost note", subtotal: 24, freightIn: 8, total: 32 },
    { canEdit: false, canViewMoney: false },
  );
  assert.equal(hidden.terms, null);
  assert.equal(hidden.unitCost, null);
  assert.equal(hidden.extPrice, null);
  assert.equal(hidden.internalNotes, null);
  assert.equal(hidden.subtotal, null);
  assert.equal(hidden.freightIn, null);
  assert.equal(hidden.total, null);

  const visible = hidePurchaseMoney(
    { terms: "Net 30", unitCost: 12 },
    { canEdit: false, canViewMoney: true },
  );
  assert.equal(visible.unitCost, 12);
});
