import assert from "node:assert/strict";
import test from "node:test";
import { parseAttachmentKind, pdfDisplayName, pdfFileError, PO_ATTACHMENT_KINDS } from "./poAttachmentKinds.ts";

test("purchase order files are vendor documents only", () => {
  assert.deepEqual(
    PO_ATTACHMENT_KINDS.map((kind) => kind.id),
    ["vendor_invoice", "quote", "order_confirmation", "other"],
  );
  assert.equal(parseAttachmentKind("customer_po"), null);
  assert.equal(parseAttachmentKind("quote"), "quote");
});

test("an attachment has to be a PDF", () => {
  assert.equal(pdfFileError({ name: "quote.pdf", type: "application/pdf", size: 20 }), null);
  assert.equal(pdfFileError({ name: "quote.png", type: "image/png", size: 20 }), "Attachments are PDF files.");
  assert.equal(pdfDisplayName("../Invoice 1.pdf"), "Invoice 1.pdf");
});
