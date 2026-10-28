import assert from "node:assert/strict";
import test from "node:test";
import {
  ITEM_ATTACHMENT_KINDS,
  itemAttachmentKindLabel,
  itemAttachmentsUnavailable,
  itemPdfDisplayName,
  itemPdfFileError,
  parseItemAttachmentKind,
} from "./itemAttachmentKinds.ts";

test("item files are product documents", () => {
  assert.deepEqual(
    ITEM_ATTACHMENT_KINDS.map((kind) => kind.id),
    ["product_brief", "data_sheet", "manual", "other"],
  );
  assert.equal(parseItemAttachmentKind("customer_po"), null);
  assert.equal(parseItemAttachmentKind("manual"), "manual");
  assert.equal(itemAttachmentKindLabel("data_sheet"), "Data sheet");
  assert.equal(itemAttachmentKindLabel("product_brief"), "Product brief");
});

test("an item attachment has to be a PDF", () => {
  assert.equal(itemPdfFileError({ name: "brief.pdf", type: "application/pdf", size: 20 }), null);
  assert.equal(itemPdfFileError({ name: "brief.pdf", type: "", size: 20 }), null);
  assert.equal(itemPdfFileError({ name: "brief.png", type: "image/png", size: 20 }), "Attachments are PDF files.");
  assert.equal(itemPdfFileError({ name: "brief.pdf", type: "application/pdf", size: 0 }), "Choose a PDF.");
  assert.equal(itemPdfDisplayName("../Brief 1.pdf"), "Brief 1.pdf");
  assert.equal(itemPdfDisplayName("notes"), "notes.pdf");
});

test("a missing item_attachments table is not a different database error", () => {
  assert.equal(
    itemAttachmentsUnavailable({
      code: "PGRST205",
      message: "Could not find the table 'public.item_attachments' in the schema cache",
    }),
    true,
  );
  assert.equal(
    itemAttachmentsUnavailable({ code: "42P01", message: 'relation "public.item_attachments" does not exist' }),
    true,
  );
  assert.equal(itemAttachmentsUnavailable({ code: "42703", message: 'column "kind" does not exist' }), false);
  assert.equal(
    itemAttachmentsUnavailable({ code: "PGRST205", message: "Could not find the table 'public.items' in the schema cache" }),
    false,
  );
});
