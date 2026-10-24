import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocationsCover,
  formatSalesOrderNumber,
  hideSalesMoney,
  invoiceNumber,
  lineExtension,
  parseSalesOrderNumber,
  partMatches,
  partPrefix,
  salesOrderTotal,
  toSalesOrderPayload,
  type SoDraftInput,
} from "./salesOrderDraft.ts";

describe("sales order draft", () => {
  it("matches a part number by normalized prefix", () => {
    assert.equal(partPrefix("m393a4k40db3-cwe"), "M393A4K40DB3CWE");
    assert.equal(partMatches("M393A4K40DB3-CWE", "M393A4K40DB3-CWEC0"), true);
    assert.equal(partMatches("M393A4K40DB3-CWE", "OTHER-PART"), false);
    assert.equal(partMatches("AB", "AB100"), false);
  });

  it("extends a line from quantity and unit price", () => {
    assert.equal(lineExtension("10", "12.5"), "125.00");
    assert.equal(lineExtension("0", "12.5"), null);
  });

  it("requires allocations to add up to the line", () => {
    assert.equal(allocationsCover("10", [{ itemId: "a", qty: "7" }, { itemId: "b", qty: "3" }]), true);
    assert.equal(allocationsCover("10", [{ itemId: "a", qty: "7" }]), false);
    assert.equal(allocationsCover("10", [{ itemId: "", qty: "10" }]), false);
  });

  it("strips prices when the viewer cannot see money", () => {
    const hidden = hideSalesMoney({ unitPrice: "12.50", extPrice: "25.00", total: 25, internalNotes: "margin" }, false);
    assert.deepEqual(hidden, { unitPrice: "", extPrice: "", total: null, internalNotes: "" });
    assert.equal(salesOrderTotal([{ extPrice: "10.00" }, { extPrice: "2.50" }]), 12.5);
    assert.equal(salesOrderTotal([{ extPrice: "" }]), null);
  });

  it("shows an integer sales-order number as SO plus the digits", () => {
    assert.equal(formatSalesOrderNumber(27766), "SO27766");
    assert.equal(formatSalesOrderNumber("27766"), "SO27766");
    assert.equal(formatSalesOrderNumber(null), null);
    assert.equal(parseSalesOrderNumber("SO27770"), 27770);
    assert.equal(parseSalesOrderNumber("27770"), 27770);
    assert.equal(parseSalesOrderNumber("SO"), null);
    assert.equal(invoiceNumber(27766, 1), "INV27766");
    assert.equal(invoiceNumber(27766, 2), "INV27766-2");
    assert.equal(invoiceNumber(27766, 3), "INV27766-3");
  });

  it("sends a draft payload without a sales-order number", () => {
    const payload = toSalesOrderPayload(sampleDraft());
    assert.equal("so_number" in payload, false);
    assert.equal(payload.customer_po, "PO-100");
    const lines = payload.lines as { allocations: { item_id: string }[] }[];
    assert.equal(lines[0].allocations[0].item_id, "item-1");
    assert.equal(lines[0].allocations.length, 1);
  });
});

function sampleDraft(): SoDraftInput {
  return {
    id: null,
    customerId: "customer-1",
    customerPo: "PO-100",
    reference: "desk",
    orderDate: "2026-10-24",
    shipDate: "",
    billTo: {
      line1: "1 Demo St",
      line2: "",
      city: "Springfield",
      countrySubDivisionCode: "IL",
      postalCode: "62701",
      country: "US",
      attention: "",
      phone: "",
    },
    shipTo: {
      line1: "1 Demo St",
      line2: "",
      city: "Springfield",
      countrySubDivisionCode: "IL",
      postalCode: "62701",
      country: "US",
      attention: "",
      phone: "",
    },
    terms: "Net30",
    incoterms: "EXW",
    shipMethod: "UPS Ground",
    carrierAccount: "",
    currency: "USD",
    salesRep: "OP",
    exportNotes: "",
    internalNotes: "",
    paymentRequirement: "terms",
    lines: [
      {
        customerPartNumber: "M393A4K40DB3-CWE",
        customerDescription: "Memory",
        qty: "2",
        unitPrice: "10",
        condition: "New",
        allocations: [
          { itemId: "item-1", qty: "2" },
          { itemId: "", qty: "1" },
        ],
      },
    ],
    notes: [],
    saveAddressToCustomer: false,
  };
}
