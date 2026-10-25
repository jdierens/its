import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocationsCover,
  compareSalesOrderList,
  formatSalesOrderNumber,
  hideSalesMoney,
  invoiceNumber,
  lineExtension,
  lineRequiresItem,
  salesOrderListReference,
  salesOrderListScope,
  syncSalesLineMoney,
  parseSalesOrderNumber,
  partMatches,
  partPrefix,
  salesOrderTotal,
  sellerNet,
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

  it("keeps quantity, unit price, and extension consistent", () => {
    const fromUnit = syncSalesLineMoney({ qty: "2", unitPrice: "10.125", extPrice: "", edited: "unit" });
    assert.equal(fromUnit.unitPrice, "10.125");
    assert.equal(fromUnit.extPrice, "20.25");

    const fromExt = syncSalesLineMoney({ qty: "3", unitPrice: "", extPrice: "10.00", edited: "ext" });
    assert.equal(fromExt.unitPrice, "3.3333");
    assert.equal(fromExt.extPrice, "10.00");
    assert.equal(lineExtension("3", fromExt.unitPrice), "10.00");

    const fromQty = syncSalesLineMoney({ qty: "2", unitPrice: "6338", extPrice: "6338.00", edited: "qty" });
    assert.equal(fromQty.extPrice, "6338.00");
    assert.equal(fromQty.unitPrice, "3169.00");
    assert.equal(lineExtension("2", fromQty.unitPrice), "6338.00");
  });

  it("lists an eBay order id or a customer PO and skips the internal reference", () => {
    assert.equal(salesOrderListReference({ ebayOrderId: "12-03456-78901", customerPo: "PO-1" }), "12-03456-78901");
    assert.equal(salesOrderListReference({ customerPo: "PO-1" }), "PO-1");
    assert.equal(salesOrderListReference({ customerPo: "" }), "");
    assert.equal(salesOrderListScope(undefined), "drafts");
    assert.equal(salesOrderListScope("all"), "all");
    assert.equal(
      compareSalesOrderList(
        { orderDate: "2026-10-01", createdAt: "2026-10-01T00:00:00Z" },
        { orderDate: "2026-10-02", createdAt: "2026-09-01T00:00:00Z" },
      ),
      1,
    );
    assert.ok(
      compareSalesOrderList({ orderDate: null, createdAt: "2026-10-03T00:00:00Z" }, { orderDate: "2026-10-01", createdAt: "2026-01-01T00:00:00Z" }) > 0,
    );
  });

  it("requires allocations to add up to the line", () => {
    assert.equal(allocationsCover("10", [{ itemId: "a", qty: "7" }, { itemId: "b", qty: "3" }]), true);
    assert.equal(allocationsCover("10", [{ itemId: "a", qty: "7" }]), false);
    assert.equal(allocationsCover("10", [{ itemId: "", qty: "10" }]), false);
  });

  it("requires an item only for a product line", () => {
    assert.equal(lineRequiresItem("product"), true);
    assert.equal(lineRequiresItem(""), true);
    assert.equal(lineRequiresItem("freight"), false);
    assert.equal(lineRequiresItem("kit"), false);
    assert.equal(lineRequiresItem("fee"), false);
  });

  it("strips prices when the viewer cannot see money", () => {
    const hidden = hideSalesMoney(
      {
        unitPrice: "12.50",
        extPrice: "25.00",
        total: 25,
        internalNotes: "margin",
        ebayTransactionFee: "1.25",
        ebayLabelFee: "0.50",
        ebayAdFee: "0.20",
        ebayOrderEarnings: "10.00",
        paymentAmount: "25.00",
      },
      false,
    );
    assert.deepEqual(hidden, {
      unitPrice: "",
      extPrice: "",
      total: null,
      internalNotes: "",
      ebayTransactionFee: "",
      ebayLabelFee: "",
      ebayAdFee: "",
      ebayOrderEarnings: "",
      paymentAmount: "",
    });
    assert.equal(salesOrderTotal([{ extPrice: "10.00" }, { extPrice: "2.50" }]), 12.5);
    assert.equal(salesOrderTotal([{ extPrice: "" }]), null);
    assert.equal(sellerNet("5631.59", ""), 5631.59);
    assert.equal(sellerNet("5631.59", "9.42"), 5622.17);
    assert.equal(sellerNet("", "9.42"), null);
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
    const lines = payload.lines as { line_kind: string; allocations: { item_id: string }[] }[];
    assert.equal(payload.channel, "direct");
    assert.equal(payload.payment_method, "wire_ach");
    assert.equal(payload.ebay_transaction_fee, "1.25");
    assert.equal(payload.payment_amount, "20.00");
    assert.equal(lines[0].line_kind, "product");
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
    channel: "direct",
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
    paymentMethod: "wire_ach",
    paymentDate: "2026-10-24",
    paymentRef: "WIRE-1",
    paymentAmount: "20.00",
    ebayTransactionFee: "1.25",
    ebayLabelFee: "",
    ebayAdFee: "",
    ebayOrderEarnings: "",
    lines: [
      {
        lineKind: "product",
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
