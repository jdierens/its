import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { receiptFromJson } from "@/lib/stockReceive";

const sql = readFileSync(new URL("../supabase/migrations/20261026021000_receipt_pending_item.sql", import.meta.url), "utf8");

describe("pending receipt migration", () => {
  it("stays additive and posts stock only when an item is linked", () => {
    assert.match(sql, /Not applied here/);
    assert.match(sql, /20261025195000_receipt_search_query\.sql/);
    assert.match(sql, /grant execute on function public\.receive_into_bin\(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text\) to service_role/);
    assert.match(sql, /revoke all on function public\.receive_into_bin\(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text\) from public, anon, authenticated/);
    assert.match(sql, /grant execute on function public\.edit_receipt\(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text\) to service_role/);
    assert.match(sql, /revoke all on table public\.receipt_lines from public, anon, authenticated/);
    assert.match(sql, /grant select on table public\.receipt_lines to service_role/);
    assert.match(sql, /with \(security_invoker = true\)/);
    assert.match(sql, /item_id is null\s+and cycle_id is null/);
    assert.doesNotMatch(sql, /insert into public\.items/i);

    const receive = sql.slice(
      sql.indexOf("create or replace function public.receive_into_bin("),
      sql.indexOf("comment on function public.receive_into_bin(text, uuid"),
    );
    const pending = receive.slice(receive.indexOf("if p_item_id is null then\n    if v_on_hand > 0"), receive.indexOf("if v_on_hand <= 0 then"));
    assert.match(pending, /'pending', true/);
    assert.doesNotMatch(pending, /adjust_bin_cycle_qty/);
    assert.match(receive, /v_qty := public\.adjust_bin_cycle_qty/);

    const edit = sql.slice(
      sql.indexOf("create or replace function public.edit_receipt("),
      sql.indexOf("comment on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text)"),
    );
    const link = edit.slice(edit.indexOf("if v_link then"), edit.indexOf("elsif v_inventory then"));
    assert.match(link, /adjust_bin_cycle_qty/);
    assert.doesNotMatch(link, /post_receipt_adjustment/);
    const adjust = edit.slice(edit.indexOf("elsif v_inventory then"), edit.indexOf("insert into public.stock_event_edits"));
    assert.match(adjust, /post_receipt_adjustment/);
    assert.match(adjust, /-v_old_qty/);
  });
});

describe("pending receipt payload", () => {
  it("does not turn a missing cycle into the text null", () => {
    const row = receiptFromJson({
      bin_id: "bin-1",
      reference: "10059-C",
      type: "C",
      cycle_id: null,
      cycle_opened: false,
      location_code: "HWS.00.00.00",
      qty: 4,
      pending: true,
    });
    assert.equal(row.pending, true);
    assert.equal(row.cycleId, "");
    assert.equal(row.cycleOpened, false);
    assert.equal(row.qty, 4);
    assert.equal(
      receiptFromJson({
        bin_id: "bin-1",
        reference: "10059-C",
        type: "C",
        cycle_id: "cycle-1",
        cycle_opened: true,
        qty: 9,
      }).pending,
      false,
    );
  });
});
