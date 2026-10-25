import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { salesOrderErrorMessage } from "./salesOrderErrors.ts";

describe("sales order error messages", () => {
  it("keeps the approval sentences the database raises", () => {
    assert.equal(salesOrderErrorMessage(new Error("Choose a customer.")), "Choose a customer.");
    assert.equal(salesOrderErrorMessage({ message: "Add a line before approving." }), "Add a line before approving.");
    assert.equal(salesOrderErrorMessage({ message: "Enter a sales order number." }), "Enter a sales order number.");
    assert.equal(
      salesOrderErrorMessage({ message: "Line 2 must be allocated to SKUs that add up to the quantity." }),
      "Line 2 must be allocated to SKUs that add up to the quantity.",
    );
    assert.equal(
      salesOrderErrorMessage({ message: "Sales order number SO27766 is already used." }),
      "Sales order number SO27766 is already used.",
    );
  });

  it("pulls the sentence out of a PostgREST wrapper", () => {
    assert.equal(
      salesOrderErrorMessage({
        message: "approve_sales_order failed",
        details: "Line 1 must be allocated to SKUs that add up to the quantity.",
        hint: "PL/pgSQL function public.approve_sales_order",
      }),
      "Line 1 must be allocated to SKUs that add up to the quantity.",
    );
  });
});
