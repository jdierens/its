import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("recent moves follow one bin or location", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261102203000_scoped_recent_moves.sql", import.meta.url), "utf8");
  assert.match(sql, /list_recent_moves\(p_code text, p_limit integer\)/);
  assert.match(sql, /if v_code = '' then/);
  assert.match(sql, /return '\[\]'::jsonb/);
  assert.match(sql, /upper\(bin\.reference\) = v_code/);
  assert.match(sql, /upper\(coalesce\(from_parent\.reference, ''\)\) = v_code/);
  assert.match(sql, /upper\(coalesce\(to_parent\.reference, ''\)\) = v_code/);
  assert.match(sql, /upper\(coalesce\(from_location\.code, ''\)\) = v_code/);
  assert.match(sql, /upper\(coalesce\(to_location\.code, ''\)\) = v_code/);
  assert.match(sql, /upper\(from_bin\.reference\) = v_code/);
  assert.match(sql, /upper\(to_bin\.reference\) = v_code/);
  assert.match(sql, /event\.event_type = 'moved'/);
  assert.match(sql, /out_row\.ref_type = 'bin_transfer'/);
  assert.match(sql, /revoke all on function public\.list_recent_moves\(text, integer\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.list_recent_moves\(text, integer\) to service_role/);
  assert.equal(sql.includes("drop function"), false);
  assert.equal(sql.includes("create policy"), false);
  assert.equal(sql.includes("to anon"), false);
  assert.equal(sql.includes("to authenticated"), false);
});
