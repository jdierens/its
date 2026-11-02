import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("target bin entries list what is there now", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261102210000_bin_entries.sql", import.meta.url), "utf8");
  assert.match(sql, /list_bin_entries\(p_code text, p_limit integer\)/);
  assert.match(sql, /if v_code = '' then/);
  assert.match(sql, /return '\[\]'::jsonb/);
  assert.match(sql, /upper\(bin\.reference\) = v_code/);
  assert.match(sql, /contents\.qty > 0/);
  assert.match(sql, /cycle\.status = 'open'/);
  assert.match(sql, /event\.event_type = 'receive_into_bin'/);
  assert.match(sql, /event\.event_type = 'receipt_adjustment'/);
  assert.match(sql, /in_row\.ref_type = 'bin_transfer'/);
  assert.match(sql, /in_row\.direction = 'in'/);
  assert.match(sql, /child\.parent_bin_id/);
  assert.match(sql, /event\.to_parent_bin_id = target\.id/);
  assert.match(sql, /order by entries\.occurred_at desc nulls last/);
  assert.match(sql, /revoke all on function public\.list_bin_entries\(text, integer\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.list_bin_entries\(text, integer\) to service_role/);
  assert.equal(sql.includes("drop function"), false);
  assert.equal(sql.includes("create policy"), false);
  assert.equal(sql.includes("damaged_qty"), false);
  assert.equal(sql.includes("to anon"), false);
  assert.equal(sql.includes("to authenticated"), false);
});
