import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the PayPal fee migration is applied by hand and keeps the fee line distinct", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261029010000_sales_order_paypal_fee.sql", import.meta.url), "utf8");
  assert.match(sql, /Apply by hand on project fxsbpreasbdalwthyzvk/);
  assert.match(sql, /Deploying does not run this file/);
  assert.match(sql, /paypal_fee_domestic_sku/);
  assert.match(sql, /paypal_fee_international_sku/);
  assert.match(sql, /'102475'/);
  assert.match(sql, /'102476'/);
  assert.match(sql, /managed_fee/);
  assert.match(sql, /contact_name/);
  assert.match(sql, /contact_email/);
  assert.match(sql, /contact_phone/);
  assert.match(sql, /\('ach', 'ACH'/);
  assert.match(sql, /\('wire', 'Wire'/);
  assert.match(sql, /\('zelle', 'Zelle'/);
  assert.match(sql, /eBay is only for an eBay order/);
  assert.equal(sql.includes("create policy"), false);
  assert.equal(sql.includes("to anon"), false);
  assert.equal(sql.includes("to authenticated"), false);
});
