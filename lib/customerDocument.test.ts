import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerDocument,
  confirmationDescription,
  CUSTOMER_DOCUMENT_LOGO,
  customerDocumentBarcode,
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
    assert.equal(CUSTOMER_DOCUMENT_LOGO, "/brand/dds-logo.png");
    assert.equal(invoice.title, "INVOICE");
    assert.equal(confirmation.title, "ORDER CONFIRMATION");
    assert.equal(customerDocumentTitle("confirmation"), "ORDER CONFIRMATION");
    assert.equal(customerDocumentTitle("invoice"), "INVOICE");
    assert.equal(invoice.barcode, "INV27773");
    assert.equal(confirmation.barcode, "SO27773");
    assert.equal(customerDocumentBarcode("confirmation", 27773), "SO27773");
    assert.equal(customerDocumentBarcode("invoice", 27773), "INV27773");
    assert.equal(invoice.salesOrderRef, "SO27773");
    assert.equal(confirmation.kind, "confirmation");
    assert.equal(invoice.kind, "invoice");
    assert.equal(confirmation.salesOrderRef, invoice.salesOrderRef);
    assert.equal(confirmation.subtotal, invoice.subtotal);
    assert.deepEqual(
      confirmation.lines.map((line) => line.sku),
      invoice.lines.map((line) => line.sku),
    );
    assert.equal(invoice.lines[0].description, "Samsung PM9A3");
    assert.equal(confirmation.lines[0].description, "106699");
    assert.deepEqual(confirmation.lines[0].extra, []);
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

  it("does not copy customer PO wording onto a confirmation line", () => {
    const lines = customerDocumentLines(
      [
        {
          customerPartNumber: "CUST-9",
          customerDescription: "Samsung PM9A3\ncondition per PO: Great",
          qty: "8",
          unitPrice: "1150",
          extPrice: "9200",
          htsCode: "",
          eccn: "",
          condition: "New",
          lineNote: "Ship in original tray",
          allocations: [
            {
              sku: "106699",
              name: "Samsung PM9A3 7.68TB",
              description: "7.68TB NVMe U.2 mixed use",
              condition: "Used",
              conditionNote: "pulled from a working server",
              qty: "8",
              unitPrice: "1150",
              extPrice: "9200",
              htsCode: "8523.51.0000",
              eccn: "5A992.c",
            },
          ],
        },
      ],
      "USD",
      "confirmation",
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].sku, "106699");
    assert.equal(lines[0].description, "7.68TB NVMe U.2 mixed use");
    assert.deepEqual(lines[0].extra, ["Condition: Used", "Condition note: pulled from a working server"]);
    assert.equal(lines[0].compliance, "HTS: 8523.51.0000   ECCN: 5A992.c");
    assert.equal(lines[0].lineNote, "Ship in original tray");
    const printed = [lines[0].description, ...lines[0].extra, lines[0].compliance, lines[0].lineNote].join("\n");
    assert.equal(printed.includes("condition per PO"), false);
    assert.equal(printed.includes("Great"), false);
    assert.equal(printed.includes("Samsung"), false);
    assert.equal(printed.includes("CUST-9"), false);

    const blanks = customerDocumentLines(
      [
        {
          customerPartNumber: "",
          customerDescription: "condition per PO: Great",
          qty: "1",
          unitPrice: "10",
          extPrice: "10",
          htsCode: "",
          eccn: "5A992.c",
          allocations: [
            {
              sku: "106699",
              name: "Samsung",
              description: "",
              condition: "   ",
              conditionNote: "",
              qty: "1",
              unitPrice: "10",
              extPrice: "10",
              htsCode: "",
              eccn: "",
            },
          ],
        },
      ],
      "USD",
      "confirmation",
    );
    assert.equal(blanks[0].description, "106699");
    assert.deepEqual(blanks[0].extra, []);
    assert.equal(blanks[0].compliance, "ECCN: 5A992.c");
    assert.equal([blanks[0].description, ...blanks[0].extra, blanks[0].compliance].join("\n").includes("Great"), false);

    const fromLine = customerDocumentLines(
      [
        {
          customerPartNumber: "CUST-9",
          customerDescription: "condition per PO: Great",
          qty: "1",
          unitPrice: "10",
          extPrice: "10",
          htsCode: "8471.70.0000",
          eccn: "",
          condition: "New",
          allocations: [
            {
              sku: "106700",
              name: "Drive",
              description: "960GB SATA",
              qty: "1",
              unitPrice: "10",
              extPrice: "10",
            },
          ],
        },
      ],
      "USD",
      "confirmation",
    );
    assert.equal(fromLine[0].description, "960GB SATA");
    assert.deepEqual(fromLine[0].extra, ["Condition: New"]);
    assert.equal(fromLine[0].compliance, "HTS: 8471.70.0000");
    assert.equal(fromLine[0].extra.some((line) => line.includes("per PO")), false);

    const noteOnly = confirmationDescription({
      sku: "106699",
      itemDescription: "7.68TB NVMe",
      condition: "",
      conditionNote: "Factory Sealed",
    });
    assert.equal(noteOnly.description, "7.68TB NVMe");
    assert.deepEqual(noteOnly.extra, ["Condition note: Factory Sealed"]);
  });

  it("prints the item description, not the item name, when the customer left no description", () => {
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
            {
              sku: "106699",
              name: "Samsung PM9A3 7.68TB",
              description: "7.68TB NVMe U.2 mixed use",
              qty: "8",
              unitPrice: "1150",
              extPrice: "9200.00",
              serials: ["A", "B"],
            },
          ],
        },
      ],
      "USD",
    );
    assert.equal(lines[0].sku, "106699");
    assert.equal(lines[0].description, "7.68TB NVMe U.2 mixed use");
    assert.notEqual(lines[0].description, "Samsung PM9A3 7.68TB");
    assert.equal(lines[0].qty, "8.00");
    assert.equal(lines[0].extPrice, "$9,200.00");
    assert.equal(lines[0].compliance, "HTS: 8523.51.0000   ECCN: 5A992.c");
    assert.equal(lines[0].lineNote, "");
    assert.deepEqual(serialLines(["A", "B", "C", "D", "E"]), ["A, B, C, D", "E"]);
  });

  it("prints item HTS and ECCN when the line is blank, then the line note", () => {
    const lines = customerDocumentLines(
      [
        {
          customerPartNumber: "",
          customerDescription: "Drive",
          qty: "1",
          unitPrice: "10",
          extPrice: "10",
          htsCode: "",
          eccn: "",
          lineNote: "Ship in original tray",
          allocations: [
            {
              sku: "106699",
              name: "Samsung",
              description: "7.68TB NVMe",
              qty: "1",
              unitPrice: "10",
              extPrice: "10",
              htsCode: "8523.51.0000",
              eccn: "5A992.c",
            },
          ],
        },
      ],
      "USD",
    );
    assert.equal(lines[0].description, "7.68TB NVMe");
    assert.equal(lines[0].compliance, "HTS: 8523.51.0000   ECCN: 5A992.c");
    assert.equal(lines[0].lineNote, "Ship in original tray");

    const overridden = customerDocumentLines(
      [
        {
          customerPartNumber: "",
          customerDescription: "Drive",
          qty: "1",
          unitPrice: "10",
          extPrice: "10",
          htsCode: "8471.70.0000",
          eccn: "",
          lineNote: "   ",
          allocations: [
            {
              sku: "106699",
              name: "Samsung",
              description: "7.68TB NVMe",
              qty: "1",
              unitPrice: "10",
              extPrice: "10",
              htsCode: "8523.51.0000",
              eccn: "5A992.c",
            },
          ],
        },
      ],
      "USD",
    );
    assert.equal(overridden[0].compliance, "HTS: 8471.70.0000   ECCN: 5A992.c");
    assert.equal(overridden[0].lineNote, "");

    const htsOnly = customerDocumentLines(
      [
        {
          customerPartNumber: "MZQL",
          customerDescription: "",
          qty: "1",
          unitPrice: "10",
          extPrice: "10",
          htsCode: "8471.70.0000",
          eccn: "",
          allocations: [],
        },
      ],
      "USD",
    );
    assert.equal(htsOnly[0].compliance, "HTS: 8471.70.0000");
  });

  it("drops a trailing QuickBooks mark from the printed company name", () => {
    const document = buildCustomerDocument({ ...sample("invoice"), customerName: "Decker IT Lösungen (C)" });
    assert.ok(document);
    assert.equal(document.billTo[0], "Decker IT Lösungen");
    assert.equal(document.shipTo[0], "Decker IT Lösungen");
    const vendor = buildCustomerDocument({ ...sample("confirmation"), customerName: "King Server (V)" });
    assert.equal(vendor?.billTo[0], "King Server");
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
