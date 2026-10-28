import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

function migrationSql(): string {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");
}

function lastFunction(sql: string, name: string): string {
  const marker = `create or replace function public.${name}`;
  const start = sql.lastIndexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const open = sql.indexOf("$$", start);
  assert.ok(open > start, `missing body for ${name}`);
  const close = sql.indexOf("$$", open + 2);
  assert.ok(close > open, `unclosed body for ${name}`);
  return sql.slice(start, close + 2);
}

test("attribute identity is not globally unique", () => {
  const sql = migrationSql();
  const created = sql.lastIndexOf("create unique index attributes_identity_uidx");
  const dropped = sql.lastIndexOf("drop index if exists public.attributes_identity_uidx");
  assert.ok(created >= 0);
  assert.ok(dropped > created);
});

test("create_field inserts a new attribute and links only that taxonomy", () => {
  const body = lastFunction(migrationSql(), "create_field");
  assert.match(body, /insert into public\.attributes \(name, data_type, unit, uses_list, label\)/);
  assert.match(body, /perform public\.link_taxonomy_attributes\(p_taxonomy_id, array\[v_id\]\)/);
  assert.doesNotMatch(body, /from public\.attributes/);
});

test("a new attribute definition does not reuse a field from another taxonomy", () => {
  const body = lastFunction(migrationSql(), "prepare_item_attributes");
  assert.match(body, /Attribute % already exists on this taxonomy/);
  assert.match(body, /insert into public\.attributes \(name, data_type, unit, uses_list\)/);
  assert.doesNotMatch(body, /already exists as a separate definition/);
  assert.doesNotMatch(body, /coalesce\(fields\.label, ''\) = ''/);
});

test("linking still refuses a second field of the same name on one taxonomy", () => {
  const body = lastFunction(migrationSql(), "link_taxonomy_attributes");
  assert.match(body, /This taxonomy already has a field named %/);
});
