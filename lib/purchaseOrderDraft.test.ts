import assert from "node:assert/strict";
import test from "node:test";
import { hidePurchaseMoney, normalizePurchaseOrderDraft, purchaseOrderTotal, type PoDraftInput } from "./purchaseOrderDraft.ts";

const vendorId = "11111111-1111-4111-8111-111111111111";

function draft(overrides: Partial<PoDraftInput> = {}): PoDraftInput {
  return {
    vendorId,
    fulfillment: "warehouse",
    terms: "Net 30",
    orderedOn: "2026-10-21",
    expectedOn: "",
    notes: "",
    lines: [
      {
        itemId: "",
        description: "32GB DDR4",
        qty: "2",
        unitCost: "40.50",
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
      lines: [{ itemId: "", description: "DIMM", qty: "1", unitCost: "", condition: "Used", unit: "Piece" }],
    }),
  );
  assert.equal(missingCost.ok, false);

  const saved = normalizePurchaseOrderDraft(draft());
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.lines[0]?.qty, 2);
  assert.equal(saved.value.lines[0]?.unitCost, 40.5);
  assert.equal(purchaseOrderTotal(saved.value.lines), 81);
});

test("a blank extra line is ignored", () => {
  const saved = normalizePurchaseOrderDraft(
    draft({
      lines: [
        { itemId: "", description: "CPU", qty: "1", unitCost: "10", condition: "New", unit: "Piece" },
        { itemId: "", description: "", qty: "", unitCost: "", condition: "Used", unit: "Piece" },
      ],
    }),
  );
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.lines.length, 1);
});

test("people who cannot see money do not receive costs", () => {
  const hidden = hidePurchaseMoney(
    { terms: "Net 30", currency: "USD", unitCost: 12, total: 24 },
    { canEdit: false, canViewMoney: false },
  );
  assert.equal(hidden.terms, null);
  assert.equal(hidden.unitCost, null);
  assert.equal(hidden.total, null);

  const visible = hidePurchaseMoney(
    { terms: "Net 30", unitCost: 12 },
    { canEdit: false, canViewMoney: true },
  );
  assert.equal(visible.unitCost, 12);
});
