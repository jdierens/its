import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseSoAttachmentKind, soAttachmentKindLabel, SO_ATTACHMENT_KINDS } from "./soAttachmentKinds.ts";

test("sales order files include a customer shipping label", () => {
  assert.deepEqual(
    SO_ATTACHMENT_KINDS.map((kind) => kind.id),
    ["customer_po", "shipping_label", "proforma", "packing_list", "commercial_invoice", "invoice", "other"],
  );
  assert.equal(parseSoAttachmentKind("shipping_label"), "shipping_label");
  assert.equal(parseSoAttachmentKind("customer_po"), "customer_po");
  assert.equal(parseSoAttachmentKind("vendor_invoice"), null);
  assert.equal(soAttachmentKindLabel("shipping_label"), "Shipping label");
  assert.equal(soAttachmentKindLabel("customer_po"), "Customer PO");
  assert.equal(soAttachmentKindLabel("nope"), "File");
});

test("the sales order file control offers every kind", () => {
  const source = readFileSync(new URL("../components/SalesOrderAttachments.tsx", import.meta.url), "utf8");
  assert.match(source, /SO_ATTACHMENT_KINDS\.map/);
  assert.match(source, /parseSoAttachmentKind/);
  assert.equal(source.includes('uploadSoAttachments(orderId, "customer_po"'), false);
});
