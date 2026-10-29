import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paymentMethodChoices } from "./salesPaymentMethods.ts";

describe("sales payment methods", () => {
  it("offers ACH, Wire, PayPal, and Zelle on an order that is not eBay", () => {
    assert.deepEqual(
      paymentMethodChoices({ ebay: false, current: "" }).map((row) => row.label),
      ["ACH", "Wire", "PayPal", "Zelle"],
    );
  });

  it("locks an eBay order to eBay and keeps a legacy value visible", () => {
    assert.deepEqual(paymentMethodChoices({ ebay: true, current: "wire_ach" }), [{ code: "ebay", label: "eBay" }]);
    const legacy = paymentMethodChoices({
      ebay: false,
      current: "wire_ach",
      known: [{ code: "wire_ach", label: "Wire / ACH" }],
    });
    assert.equal(legacy.at(-1)?.label, "Wire / ACH");
    assert.equal(legacy.some((row) => row.code === "ebay"), false);
  });
});
