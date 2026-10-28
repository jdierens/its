import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const KINDS = "'customer_po', 'shipping_label', 'proforma', 'packing_list', 'commercial_invoice', 'invoice', 'other'";

test("shipping_label is added to the sales-order attachment check", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261028222000_so_shipping_label.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.so_attachments drop constraint so_attachments_kind_check/);
  assert.match(sql, /add constraint so_attachments_kind_check check/);
  assert.match(sql, new RegExp(KINDS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(sql, /Deploying this repository does not run this file/);
  assert.match(sql, /Apply it by hand/);
  assert.equal(sql.includes("create policy"), false);
  assert.equal(sql.includes("to anon"), false);
  assert.equal(sql.includes("to authenticated"), false);
});

test("the original sales-order migration keeps the kind list from before shipping labels", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261024070800_sales_orders.sql", import.meta.url), "utf8");
  assert.match(sql, /'customer_po', 'proforma', 'packing_list', 'commercial_invoice', 'invoice', 'other'/);
  assert.equal(sql.includes("shipping_label"), false);
});
