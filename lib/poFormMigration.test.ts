import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("purchase order files are a private service-role bucket without a customer type", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261021094500_po_form_lines_attachments.sql", import.meta.url), "utf8");
  assert.match(sql, /internal_notes/);
  assert.match(sql, /vendor_notes/);
  assert.match(sql, /numeric\(12, 4\)/);
  assert.match(sql, /ext_price numeric\(12, 2\)/);
  assert.match(sql, /po-documents/);
  assert.equal(sql.includes("customer_po"), false);
  assert.match(sql, /'vendor_invoice', 'quote', 'order_confirmation', 'other'/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.po_attachments from public, anon, authenticated/);
  assert.match(sql, /grant all on table public\.po_attachments to service_role/);
  assert.equal(sql.includes("create policy"), false);
  assert.equal(sql.includes("to anon"), false);
});
