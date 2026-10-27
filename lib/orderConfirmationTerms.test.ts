import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ORDER_CONFIRMATION_TERMS, orderConfirmationShowsTerms } from "./orderConfirmationTerms.ts";

const REQUIRED = [
  "Acceptance of order",
  "Pricing and taxes",
  "Payment",
  "Title and risk of loss",
  "Shipping and FOB",
  "Inspection and returns",
  "Refurbished and as-is goods",
  "Warranty",
  "Limitation of liability",
  "Export",
  "Force majeure",
  "No assignment",
  "Entire agreement",
  "Nevada law and venue",
];

describe("order confirmation terms", () => {
  it("names Deep Discount Servers LLC in Henderson and stays off the invoice", () => {
    assert.equal(
      ORDER_CONFIRMATION_TERMS.seller,
      'Deep Discount Servers LLC, 3730 E Dale Ave, Henderson, NV 89044 ("DDS")',
    );
    assert.match(ORDER_CONFIRMATION_TERMS.draftLabel, /DRAFT FOR REVIEW/);
    assert.equal(orderConfirmationShowsTerms("confirmation"), true);
    assert.equal(orderConfirmationShowsTerms("invoice"), false);
    const text = [ORDER_CONFIRMATION_TERMS.seller, ...ORDER_CONFIRMATION_TERMS.sections.map((section) => section.body)].join(" ");
    assert.equal(text.includes("DI2"), false);
    assert.match(text, /Nevada/);
    assert.deepEqual(
      ORDER_CONFIRMATION_TERMS.sections.map((section) => section.heading),
      REQUIRED,
    );
  });
});
