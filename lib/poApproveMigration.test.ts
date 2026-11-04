import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/20261104210000_po_approve_and_number.sql", import.meta.url), "utf8");

function body(name: string): string {
  const start = sql.indexOf(`function public.${name}`);
  assert.ok(start > 0, name);
  const next = sql.indexOf("comment on function", start);
  assert.ok(next > start, name);
  return sql.slice(start, next);
}

test("the suggestion is one past the highest stored PO number and does not read the counter", () => {
  const suggest = body("suggest_purchase_order_number");
  assert.match(suggest, /max\(\(substring\(number from '\^PO\(\[0-9\]\+\)\$'\)\)::bigint\)/);
  assert.match(suggest, /coalesce\(/);
  assert.equal(suggest.includes("next_number"), false);
  assert.match(suggest, /for update/);
  assert.match(sql, /A drifted counter does not change the suggestion/);
});

test("approve claims an unused number and moves the counter forward only", () => {
  const approve = body("approve_purchase_order");
  assert.match(approve, /status <> 'draft'/);
  assert.match(approve, /Only a draft can be approved/);
  assert.match(approve, /Add a line before approving/);
  assert.match(approve, /number = 'PO' \|\| p_number::text/);
  assert.match(approve, /id is distinct from p_order/);
  assert.match(approve, /Purchase order number PO% is already used/);
  assert.match(approve, /next_number = greatest\(next_number, v_number \+ 1\)/);
  assert.match(approve, /status = 'open'/);
  assert.match(approve, /sent_at = coalesce\(sent_at, now\(\)\)/);
  assert.equal(approve.includes("next_number = v_number"), false);
});

test("saving a draft does not assign a number", () => {
  const write = body("write_known_purchase_order");
  assert.match(sql, /alter column number drop not null/);
  assert.match(write, /null, p_vendor_id, 'purchase', 'draft'/);
  assert.equal(write.includes("reserve_purchase_order_number"), false);
  assert.match(sql, /revoke all on function public\.suggest_purchase_order_number\(\) from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.approve_purchase_order\(uuid, uuid, bigint\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.suggest_purchase_order_number\(\) to service_role/);
  assert.match(sql, /grant execute on function public\.approve_purchase_order\(uuid, uuid, bigint\) to service_role/);
  assert.equal(sql.includes("grant execute on function public.suggest_purchase_order_number() to anon"), false);
  assert.equal(sql.includes("grant execute on function public.approve_purchase_order(uuid, uuid, bigint) to anon"), false);
});
