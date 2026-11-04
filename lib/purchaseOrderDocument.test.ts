import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyAddress } from "./salesOrderDraft.ts";
import {
  buildPurchaseOrderDocument,
  purchaseOrderShipToLines,
  PURCHASE_ORDER_DOCUMENT_TITLE,
} from "./purchaseOrderDocument.ts";

function sample() {
  return buildPurchaseOrderDocument({
    number: "PO6304",
    documentDate: "2026-11-04",
    orderDate: "2026-11-04",
    expectedOn: "2026-11-18",
    terms: "Net30",
    fulfillment: "warehouse",
    vendorName: "Acme Memory (V)",
    vendorAddress: { ...emptyAddress(), line1: "1 Vendor Way", city: "Reno", countrySubDivisionCode: "NV", postalCode: "89501", country: "US" },
    vendorPhone: "775-555-0100",
    vendorEmail: "ap@acme.example",
    shipTo: emptyAddress(),
    tracking: "1Z999",
    vendorNotes: "Ship on pallets.\nCall the dock.",
    currency: "USD",
    freight: 25,
    lines: [
      {
        sku: "DDR4-32",
        description: "32GB DDR4",
        condition: "Used",
        qty: "2",
        unitPrice: 40.5,
        extPrice: 81,
      },
      {
        sku: "SSD-1",
        description: "Split price",
        condition: "",
        qty: "3",
        unitPrice: 1.2345,
        extPrice: 3.7,
      },
    ],
  });
}

test("a purchase order print is titled PURCHASE ORDER and keeps vendor-facing lines", () => {
  const document = sample();
  assert.ok(document);
  assert.equal(document.title, PURCHASE_ORDER_DOCUMENT_TITLE);
  assert.equal(document.title, "PURCHASE ORDER");
  assert.equal(document.number, "PO6304");
  assert.equal(document.barcode, "PO6304");
  assert.equal(document.orderDate, "11/04/26");
  assert.equal(document.expectedOn, "11/18/26");
  assert.equal(document.terms, "Net30");
  assert.equal(document.fulfillment, "Warehouse");
  assert.equal(document.vendorLines[0], "Acme Memory");
  assert.equal(document.vendorLines[1], "1 Vendor Way");
  assert.ok(document.vendorLines.includes("775-555-0100"));
  assert.deepEqual(document.notes, ["Ship on pallets.", "Call the dock."]);
  assert.equal(document.lines[0].sku, "DDR4-32");
  assert.equal(document.lines[0].qty, "2.00");
  assert.equal(document.lines[0].unitPrice, "$40.50");
  assert.equal(document.lines[0].extPrice, "$81.00");
  assert.deepEqual(document.lines[0].extra, ["Condition: Used"]);
  assert.equal(document.lines[1].unitPrice, "$1.2345");
  assert.equal(document.subtotal, "$84.70");
  assert.equal(document.freight, "$25.00");
  assert.equal(document.total, "$109.70");
  assert.equal(JSON.stringify(document).includes("internal"), false);
});

test("warehouse with no ship-to prints the company address, and a stored ship-to wins", () => {
  const warehouse = purchaseOrderShipToLines({ fulfillment: "warehouse", shipTo: emptyAddress() });
  assert.match(warehouse[0], /Deep Discount Servers/);
  assert.match(warehouse[1], /Henderson/);
  const drop = purchaseOrderShipToLines({ fulfillment: "drop_ship", shipTo: emptyAddress() });
  assert.deepEqual(drop, ["Drop ship"]);
  const stored = purchaseOrderShipToLines({
    fulfillment: "warehouse",
    shipTo: { ...emptyAddress(), company: "Equinix DC", line1: "1 Datacenter Way", city: "Ashburn", countrySubDivisionCode: "VA", postalCode: "20147", country: "US" },
  });
  assert.equal(stored[0], "Equinix DC");
  assert.equal(stored[1], "1 Datacenter Way");
});

test("an unnumbered draft does not build a print", () => {
  const document = buildPurchaseOrderDocument({
    ...{
      number: "",
      documentDate: "",
      orderDate: "",
      expectedOn: "",
      terms: "",
      fulfillment: "warehouse",
      vendorName: "Acme",
      vendorAddress: emptyAddress(),
      vendorPhone: "",
      vendorEmail: "",
      shipTo: emptyAddress(),
      tracking: "",
      vendorNotes: "secret internal should not matter",
      currency: "USD",
      freight: 0,
      lines: [],
    },
  });
  assert.equal(document, null);
});

test("the print view reuses the letter sheet and leaves out sales wording and terms", () => {
  const view = readFileSync(new URL("../components/PurchaseOrderDocument.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/purchasing/orders/[id]/print/page.tsx", import.meta.url), "utf8");
  assert.match(view, /LetterPrint/);
  assert.match(view, /PrintDocumentButton/);
  assert.match(view, /CUSTOMER_DOCUMENT_PRINT/);
  assert.match(view, /document\.title/);
  assert.equal(view.includes("OrderConfirmationTerms"), false);
  assert.equal(view.includes("SALES ORDER"), false);
  assert.equal(view.includes("ORDER CONFIRMATION"), false);
  assert.equal(page.includes("OrderConfirmationTerms"), false);
});
