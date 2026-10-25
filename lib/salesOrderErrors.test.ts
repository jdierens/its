import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { salesOrderErrorMessage } from "./salesOrderErrors.ts";

describe("sales order error messages", () => {
  it("keeps the approval sentences the database raises", () => {
    assert.equal(salesOrderErrorMessage(new Error("Enter a bill-to address.")), "Enter a bill-to address.");
    assert.equal(salesOrderErrorMessage({ message: "Choose terms." }), "Choose terms.");
    assert.equal(salesOrderErrorMessage({ message: "Choose a ship method." }), "Choose a ship method.");
    assert.equal(salesOrderErrorMessage({ message: "Enter the sales rep initials." }), "Enter the sales rep initials.");
    assert.equal(
      salesOrderErrorMessage({ message: "Line 2 must be allocated to SKUs that add up to the quantity." }),
      "Line 2 must be allocated to SKUs that add up to the quantity.",
    );
  });

  it("pulls the sentence out of a PostgREST wrapper", () => {
    assert.equal(
      salesOrderErrorMessage({
        message: "approve_sales_order failed",
        details: "Enter a bill-to address.",
        hint: "PL/pgSQL function public.approve_sales_order",
      }),
      "Enter a bill-to address.",
    );
  });
});
