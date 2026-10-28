import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("item documents are a private service-role bucket", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261028210000_item_attachments.sql", import.meta.url), "utf8");
  assert.match(sql, /item-documents/);
  assert.match(sql, /product_brief', 'data_sheet', 'manual', 'other'/);
  assert.match(sql, /references public\.items \(id\) on delete cascade/);
  assert.match(sql, /storage_path = item_id::text \|\| '\/' \|\| id::text \|\| '\.pdf'/);
  assert.match(sql, /application\/pdf/);
  assert.match(sql, /public = false/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.item_attachments from public, anon, authenticated/);
  assert.match(sql, /grant all on table public\.item_attachments to service_role/);
  assert.equal(sql.includes("create policy"), false);
  assert.equal(sql.includes("to anon"), false);
  assert.equal(sql.includes("to authenticated"), false);
});
