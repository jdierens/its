import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/20261031060000_damaged_inventory.sql", import.meta.url), "utf8");

describe("damaged inventory", () => {
  it("splits for-sale qty from damaged qty and keeps the row while either remains", () => {
    assert.match(sql, /add column if not exists damaged_qty integer not null default 0/);
    assert.match(sql, /qty > 0 or damaged_qty > 0/);
    assert.match(sql, /A later write-down of residual value references bin_contents\.id/);
    assert.match(sql, /v_qty = 0 and v_damaged = 0 then/);
    assert.match(sql, /function public\.adjust_bin_cycle_damaged_qty/);
    assert.match(sql, /function public\.bin_occupied_qty\(p_bin uuid\)/);
    assert.match(sql, /function public\.item_for_sale_qty\(p_item uuid\)/);
    assert.match(sql, /coalesce\(sum\(bc\.qty\), 0\)/);
    assert.doesNotMatch(
      sql.slice(sql.indexOf("function public.item_for_sale_qty"), sql.indexOf("comment on function public.item_for_sale_qty")),
      /damaged_qty/,
    );
  });

  it("marks the receipt and the unit, and keeps damaged units off a pick", () => {
    assert.match(sql, /add column if not exists damaged boolean not null default false/);
    assert.match(sql, /stock_status in \('available', 'damaged', 'quarantine', 'hold'\)/);
    assert.match(sql, /new\.stock_status := 'damaged'/);
    assert.match(sql, /That piece is not available to pick/);
    assert.match(sql, /and status = ''in_stock'' and stock_status = ''available''/);
    assert.match(sql, /Available units cannot exceed for-sale qty/);
  });

  it("receives and edits the flag without granting it to the browser roles", () => {
    assert.match(sql, /p_damaged boolean,/);
    assert.match(sql, /its\.receipt_damaged/);
    assert.match(sql, /function public\.set_receipt_damaged\(uuid, boolean, text\)/);
    assert.match(sql, /p_damaged => coalesce\(\(v_write ->> ''damaged''\)::boolean, false\)/);
    assert.match(
      sql,
      /grant execute on function public\.receive_into_bin\(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, boolean, jsonb, uuid, uuid\) to service_role/,
    );
    assert.match(
      sql,
      /revoke all on function public\.set_receipt_damaged\(uuid, boolean, text\) from public, anon, authenticated/,
    );
    assert.doesNotMatch(sql, /grant execute on function public\.set_receipt_damaged\([\s\S]*\) to anon/);
    assert.doesNotMatch(sql, /grant execute on function public\.receive_into_bin\([\s\S]*\) to authenticated/);
  });
});
