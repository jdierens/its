import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/20261026201500_receipt_putaway_bin.sql", import.meta.url), "utf8");

describe("posted putaway bin migration", () => {
  it("moves the receipt quantity onto the new bin and leaves the receive row in place", () => {
    assert.match(sql, /Not applied here/);
    assert.match(sql, /20261026021000_receipt_pending_item\.sql/);
    assert.match(sql, /security invoker/);
    assert.match(sql, /set search_path = ''/);
    assert.doesNotMatch(sql, /security definer/i);
    assert.doesNotMatch(sql, /putaway bin stays as stored/);
    assert.match(
      sql,
      /grant execute on function public\.edit_receipt\(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text\) to service_role/,
    );
    assert.match(
      sql,
      /revoke all on function public\.edit_receipt\(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text\) from public, anon, authenticated/,
    );
    assert.doesNotMatch(sql, /grant execute on function public\.edit_receipt\([\s\S]*\) to anon/);
    assert.doesNotMatch(sql, /grant execute on function public\.edit_receipt\([\s\S]*\) to authenticated/);

    const edit = sql.slice(
      sql.indexOf("create or replace function public.edit_receipt("),
      sql.indexOf("comment on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text)"),
    );
    assert.match(edit, /No bin with that code\. Use New bin\./);
    const move = edit.slice(edit.indexOf("elsif v_move then"), edit.indexOf("elsif v_inventory then"));
    const outAt = move.indexOf("-v_old_qty");
    const inAt = move.indexOf("v_cycle_id, v_bin.id, p_item_id, p_qty");
    assert.ok(outAt > 0 && inAt > outAt);
    assert.match(move, /post_receipt_adjustment/);
    assert.match(move, /insert into public\.bin_cycles/);
    assert.match(move, /This bin has quantity and no open cycle/);
    assert.doesNotMatch(move, /update public\.stock_events/);

    const adjust = edit.slice(edit.indexOf("elsif v_inventory then"), edit.indexOf("if coalesce(v_cycle_id, v_stock_cycle)"));
    assert.match(adjust, /v_stock_cycle/);
    assert.match(adjust, /v_stock_bin/);
    assert.doesNotMatch(adjust, /v_event\.cycle_id/);
    assert.match(edit, /jsonb_build_object\('cycle_id', coalesce\(v_cycle_id, v_stock_cycle\)\)/);
  });
});
