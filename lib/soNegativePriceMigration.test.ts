import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("negative sales-order prices are limited to discount, fee, service, and the other non-stock kinds", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261030153000_so_negative_unit_price.sql", import.meta.url), "utf8");
  assert.match(sql, /Apply by hand on project fxsbpreasbdalwthyzvk/);
  assert.match(sql, /Deploying does not run this file/);
  assert.match(sql, /drop constraint if exists so_lines_price_nonnegative/);
  assert.match(sql, /so_lines_unit_price_sign/);
  assert.match(sql, /line_kind in \('freight', 'fee', 'service', 'discount', 'other'\)/);
  assert.match(sql, /drop constraint if exists so_line_allocations_price_nonnegative/);
  assert.match(sql, /A product line cannot have a negative unit price/);
  assert.match(sql, /so_price_line_kind/);
  assert.match(sql, /round\(v_qty \* v_price, 2\)/);
  assert.match(sql, /round\(v_alloc_qty \* v_alloc_price, 2\)/);
  assert.equal(sql.includes("v_alloc_price < 0"), false);
  assert.equal(sql.includes("create policy"), false);
  assert.equal(sql.includes("to anon"), false);
  assert.equal(sql.includes("to authenticated"), false);
});
