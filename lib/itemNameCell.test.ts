import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../supabase/migrations/20261028223000_item_name_cell.sql", import.meta.url),
  "utf8",
);

test("update_item_cell accepts a name and refuses a blank one", () => {
  assert.match(sql, /p_field = 'name'/);
  assert.match(sql, /v_text := btrim\(coalesce\(p_value, ''\)\)/);
  assert.match(sql, /raise exception 'Name is required'/);
  assert.match(sql, /set name = v_text/);
  assert.match(sql, /v_row\.updated_at is distinct from p_expected_updated_at/);
  assert.match(sql, /grant execute on function public\.update_item_cell\(uuid, text, text, timestamptz\) to service_role/);
  assert.equal(sql.includes("to anon"), false);
  assert.equal(sql.includes("to authenticated"), false);
  assert.equal(/create unique|unique index|unique \(name\)/i.test(sql), false);
});
