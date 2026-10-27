import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerDocument,
  customerDocumentLines,
  customerDocumentTitle,
  documentDate,
  documentPartyLines,
  formatDocumentLocality,
  packageNotes,
  serialLines,
  shippingColumns,
  type CustomerDocumentInput,
} from "./customerDocument.ts";
import { emptyAddress, type SoAddress } from "./salesOrderDraft.ts";

describe("customer document", () => {
  it("uses one layout and changes only the title", () => {
    const invoice = buildCustomerDocument(sample("invoice"));
    const confirmation = buildCustomerDocument(sample("confirmation"));
    assert.ok(invoice && confirmation);
    assert.equal(invoice.title, "INVOICE");
    assert.equal(confirmation.title, "Sales Order Confirmation");
    assert.equal(customerDocumentTitle("confirmation"), "Sales Order Confirmation");
    assert.equal(invoice.barcode, "INV27773");
    assert.equal(confirmation.barcode, "INV27773");
    assert.equal(invoice.salesOrderRef, "SO#27773");
    assert.equal(confirmation.salesOrderRef, invoice.salesOrderRef);
    assert.equal(confirmation.subtotal, invoice.subtotal);
    assert.deepEqual(
      confirmation.lines.map((line) => line.sku),
      invoice.lines.map((line) => line.sku),
    );
  });

  it("keeps the same SKU on separate rows at different prices", () => {
    const lines = customerDocumentLines(
      [
        {
          customerPartNumber: "",
          customerDescription: "Shipping & Handling Charge\nEXPRESS 12:00",
          qty: "1",
          unitPrice: "74.88",
          extPrice: "74.88",
          htsCode: "",
          eccn: "",
          allocations: [{ sku: "4343", name: "SERVICE\\FREIGHT-OUT", qty: "1", unitPrice: "74.88", extPrice: "74.88" }],
        },
        {
          customerPartNumber: "",
          customerDescription: "Shipping & Handling Charge\nDHL Protection value $30,400",
          qty: "1",
          unitPrice: "501.60",
          extPrice: "501.60",
          htsCode: "",
          eccn: "",
          allocations: [{ sku: "4343", name: "SERVICE\\FREIGHT-OUT", qty: "1", unitPrice: "501.60", extPrice: "501.60" }],
        },
      ],
      "USD",
    );
    assert.equal(lines.length, 2);
    assert.equal(lines[0].sku, "4343");
    assert.equal(lines[1].sku, "4343");
    assert.equal(lines[0].unitPrice, "$74.88");
    assert.equal(lines[1].unitPrice, "$501.60");
    assert.deepEqual(lines[0].extra, ["EXPRESS 12:00"]);
    assert.equal(lines[1].description, "Shipping & Handling Charge");
  });

  it("prints a verbal line from the mapped SKU when the customer left no description", () => {
    const lines = customerDocumentLines(
      [
        {
          customerPartNumber: "",
          customerDescription: "",
          qty: "",
          unitPrice: "",
          extPrice: "",
          htsCode: "8523.51.0000",
          eccn: "5A992.c",
          allocations: [
            { sku: "106699", name: "Samsung PM9A3 7.68TB", qty: "8", unitPrice: "1150", extPrice: "9200.00", serials: ["A", "B"] },
          ],
        },
      ],
      "USD",
    );
    assert.equal(lines[0].sku, "106699");
    assert.equal(lines[0].description, "Samsung PM9A3 7.68TB");
    assert.equal(lines[0].qty, "8.00");
    assert.equal(lines[0].extPrice, "$9,200.00");
    assert.equal(lines[0].compliance, "HTS: 8523.51.0000   ECCN: 5A992.c");
    assert.deepEqual(serialLines(["A", "B", "C", "D", "E"]), ["A, B, C, D", "E"]);
  });

  it("formats the address block and the box note the way the invoice does", () => {
    const ship: SoAddress = {
      ...emptyAddress(),
      line1: "Zum Gutshof 2",
      city: "Herborn",
      postalCode: "35745",
      country: "Deutschland",
    };
    assert.equal(formatDocumentLocality(ship), "35745 Herborn");
    assert.deepEqual(documentPartyLines("Decker IT Lösungen", ship, ["+49 272 571398", "info@it-decker.de"]), [
      "Decker IT Lösungen",
      "Zum Gutshof 2",
      "35745 Herborn",
      "Deutschland",
      "+49 272 571398",
      "info@it-decker.de",
    ]);
    assert.equal(documentDate("2026-10-26"), "10/26/26");
    assert.deepEqual(shippingColumns({ method: "WPX", carrier: "DHL", carrierAccount: "" }), { method: "WPX", account: "DHL" });
    assert.deepEqual(packageNotes([{ boxNumber: 1, weightLb: 7.25, lengthIn: 10, widthIn: 10, heightIn: 10 }]), [
      "BOX1/1 7.25 LBS - 10x10x10 INCHES",
    ]);
  });
});

function sample(kind: "invoice" | "confirmation"): CustomerDocumentInput {
  return {
    kind,
    soNumber: 27773,
    documentDate: "2026-10-27",
    orderDate: "2026-10-26",
    salesRep: "JD",
    paymentTerms: "Payment In Advance",
    incoterms: "FOB",
    shipMethod: "WPX",
    shipAccount: "DHL",
    orderRef: "WhatsApp Oct16",
    tracking: "2234860154",
    customerName: "Decker IT Lösungen",
    billTo: { ...emptyAddress(), line1: "Zum Gutshof 2", city: "Herborn", postalCode: "35745", country: "Deutschland" },
    shipTo: { ...emptyAddress(), line1: "Zum Gutshof 2", city: "Herborn", postalCode: "35745", country: "Deutschland" },
    shipTail: [],
    currency: "USD",
    exportNotes: "",
    packages: [{ boxNumber: 1, weightLb: 7.25, lengthIn: 10, widthIn: 10, heightIn: 10 }],
    lines: [
      {
        customerPartNumber: "MZQL",
        customerDescription: "Samsung PM9A3",
        qty: "8",
        unitPrice: "1150",
        extPrice: "9200",
        htsCode: "",
        eccn: "",
        allocations: [{ sku: "106699", name: "Samsung PM9A3", qty: "8", unitPrice: "1150", extPrice: "9200" }],
      },
    ],
  };
}
