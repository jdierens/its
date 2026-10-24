import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  planKitImport,
  readGenericsCsv,
  readKitsCsv,
  readRecipesCsv,
  type ImportPlan,
  type KnownItem,
} from "../lib/kitImportPlan";

type Args = {
  kits: string;
  recipes: string;
  generics: string;
  out: string;
  apply: boolean;
  db: string;
};

type StoredItem = KnownItem & {
  id: string;
  taxonomyId: string | null;
  generic: boolean;
};

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function readArgs(): Args {
  const kits = arg("--kits");
  const recipes = arg("--recipes");
  const generics = arg("--generics");
  const out = arg("--out") ?? "tmp/kit-import";
  const db = arg("--db") ?? process.env.KITS_DATABASE_URL ?? "";
  if (!kits || !recipes || !generics) {
    throw new Error(
      "Usage: node --experimental-strip-types --import ./test/register.mjs scripts/import-kits.ts --kits kits.csv --recipes recipes.csv --generics generics.csv [--out dir] [--db conninfo] [--apply]",
    );
  }
  return { kits, recipes, generics, out, apply: process.argv.includes("--apply"), db };
}

function psql(db: string, sql: string): string {
  const result = spawnSync("psql", [db, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "psql failed");
  return result.stdout.trim();
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function loadKnown(db: string, skus: string[]): Map<string, StoredItem> {
  const known = new Map<string, StoredItem>();
  if (skus.length === 0) return known;
  const list = skus.map(sqlLiteral).join(",");
  const text = psql(
    db,
    `select sku, id::text, coalesce(item_type, ''), taxonomy_id::text, is_generic, public.item_has_stock_history(id)
     from public.items where sku in (${list})`,
  );
  for (const line of text.split("\n").filter(Boolean)) {
    const [sku, id, itemType, taxonomyId, generic, history] = line.split("|");
    known.set(sku, {
      sku,
      id,
      itemType,
      taxonomyId: taxonomyId || null,
      generic: generic === "t" || generic === "true",
      hasHistory: history === "t" || history === "true",
    });
  }
  return known;
}

function componentIdSql(sku: string): string {
  return `(select id from public.items where sku = ${sqlLiteral(sku)})`;
}

function defaultsSql(plan: ImportPlan, sku: string, column: "condition" | "eccn"): string {
  const kit = plan.creates.find((row) => row.sku === sku) ?? plan.converts.find((row) => row.sku === sku);
  const components = plan.recipes.filter((row) => row.kitSku === sku);
  const ids = components.map((row) => componentIdSql(row.componentSku)).join(", ");
  return `(select ${column} from public.kit_field_defaults(${sqlLiteral(kit?.taxonomyCode ?? "")}, array[${ids}]::uuid[]))`;
}

function buildApplySql(plan: ImportPlan): string {
  const lines: string[] = ["begin;"];
  for (const kit of plan.creates) {
    lines.push(
      `select public.import_kit_create(${sqlLiteral(kit.sku)}, ${sqlLiteral(kit.name)}, ${sqlLiteral(kit.taxonomyCode)}, ${defaultsSql(plan, kit.sku, "condition")}, ${defaultsSql(plan, kit.sku, "eccn")});`,
    );
  }
  for (const kit of plan.converts) {
    lines.push(
      `select public.convert_item_to_kit(${componentIdSql(kit.sku)}, ${sqlLiteral(kit.taxonomyCode)}, null);`,
    );
  }
  const byKit = new Map<string, ImportPlan["recipes"]>();
  for (const recipe of plan.recipes) {
    const list = byKit.get(recipe.kitSku) ?? [];
    list.push(recipe);
    byKit.set(recipe.kitSku, list);
  }
  for (const [sku, rows] of byKit) {
    const payload = JSON.stringify(rows.map((row) => ({ sku: row.componentSku, qty: row.qtyPerKit }))).replace(/'/g, "''");
    lines.push(`select public.save_kit_components(${componentIdSql(sku)}, (
      select coalesce(jsonb_agg(jsonb_build_object('component_item_id', item.id, 'qty_per_kit', entry.qty, 'notes', '')), '[]'::jsonb)
      from jsonb_to_recordset('${payload}'::jsonb) as entry(sku text, qty integer)
      join public.items as item on item.sku = entry.sku
    ), null);`);
  }
  for (const sku of plan.generics) {
    lines.push(`update public.items set is_generic = true where sku = ${sqlLiteral(sku)};`);
  }
  const kitSkus = [...plan.creates, ...plan.converts].map((kit) => sqlLiteral(kit.sku)).join(", ") || "''";
  const bundleSkus = [...plan.creates, ...plan.converts].filter((kit) => kit.taxonomyCode === "KIT/BDL").map((kit) => sqlLiteral(kit.sku));
  const genericSkus = plan.generics.map(sqlLiteral);
  lines.push(`do $verify$
declare
  v_kits integer;
  v_recipes integer;
  v_generics integer;
  v_bad_bundles integer;
begin
  select count(*) into v_kits from public.items where sku in (${kitSkus}) and item_type = 'Kit/Package';
  if v_kits <> ${plan.creates.length + plan.converts.length} then
    raise exception 'Expected % kits, found %.', ${plan.creates.length + plan.converts.length}, v_kits;
  end if;
  select count(*) into v_recipes
  from public.kit_components as component
  join public.items as kit on kit.id = component.kit_item_id
  where kit.sku in (${kitSkus});
  if v_recipes <> ${plan.recipes.length} then
    raise exception 'Expected % recipe rows, found %.', ${plan.recipes.length}, v_recipes;
  end if;
  select count(*) into v_generics from public.items
  where sku in (${genericSkus.length ? genericSkus.join(", ") : "''"}) and is_generic;
  if v_generics <> ${plan.generics.length} then
    raise exception 'Expected % generic items, found %.', ${plan.generics.length}, v_generics;
  end if;
  select count(*) into v_bad_bundles
  from public.items as item
  where item.sku in (${bundleSkus.length ? bundleSkus.join(", ") : "''"})
    and (
      select count(distinct component.component_item_id)
      from public.kit_components as component
      where component.kit_item_id = item.id
    ) <> 1;
  if v_bad_bundles > 0 then
    raise exception 'A kit bundle does not have exactly one component.';
  end if;
end
$verify$;`);
  lines.push("commit;");
  return `${lines.join("\n")}\n`;
}

function buildRollback(plan: ImportPlan, known: Map<string, StoredItem>): string {
  const lines = ["begin;"];
  for (const kit of plan.creates) {
    lines.push(`delete from public.items where sku = ${sqlLiteral(kit.sku)};`);
  }
  for (const kit of plan.converts) {
    const previous = known.get(kit.sku);
    if (!previous) continue;
    const taxonomy = previous.taxonomyId ? `${sqlLiteral(previous.taxonomyId)}::uuid` : "null";
    lines.push(
      `update public.items set item_type = ${sqlLiteral(previous.itemType)}, taxonomy_id = ${taxonomy} where sku = ${sqlLiteral(kit.sku)};`,
    );
    lines.push(`delete from public.kit_components where kit_item_id = ${sqlLiteral(previous.id)}::uuid;`);
    lines.push("alter table public.kit_events disable trigger kit_events_append_only;");
    lines.push(`delete from public.kit_events where item_id = ${sqlLiteral(previous.id)}::uuid and event = 'conversion';`);
    lines.push("alter table public.kit_events enable trigger kit_events_append_only;");
  }
  for (const sku of plan.generics) {
    const previous = known.get(sku);
    lines.push(`update public.items set is_generic = ${previous?.generic ? "true" : "false"} where sku = ${sqlLiteral(sku)};`);
  }
  lines.push("commit;");
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = readArgs();
  if (!args.db) throw new Error("Pass --db with a local conninfo. This script does not pick a remote database.");
  if (/supabase\.co|amazonaws\.com/i.test(args.db)) {
    throw new Error("Refusing a remote database.");
  }
  const kits = readKitsCsv(readFileSync(args.kits, "utf8"));
  const recipes = readRecipesCsv(readFileSync(args.recipes, "utf8"));
  const generics = readGenericsCsv(readFileSync(args.generics, "utf8"));
  const skus = [...new Set([
    ...kits.rows.map((row) => row.sku),
    ...recipes.rows.map((row) => row.componentSku),
    ...recipes.rows.map((row) => row.kitSku),
    ...generics,
  ])];
  const known = loadKnown(args.db, skus);
  const plan = planKitImport({
    kits: kits.rows,
    recipes: recipes.rows,
    generics,
    known,
  });
  const issues = [...kits.issues, ...recipes.issues, ...plan.issues];
  mkdirSync(args.out, { recursive: true });
  const before = Number(psql(args.db, "select next_number from public.sku_counter where id = 1"));
  writeFileSync(resolve(args.out, "snapshot.json"), `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    skuCounter: before,
    items: [...known.values()],
  }, null, 2)}\n`);
  writeFileSync(resolve(args.out, "rollback.sql"), buildRollback(plan, known));
  if (issues.length > 0) {
    writeFileSync(resolve(args.out, "issues.json"), `${JSON.stringify(issues, null, 2)}\n`);
    throw new Error(`Import stopped with ${issues.length} problem${issues.length === 1 ? "" : "s"}. See ${args.out}/issues.json`);
  }
  const sql = buildApplySql(plan);
  writeFileSync(resolve(args.out, "plan.sql"), sql);
  if (!args.apply) {
    console.log(`Dry run only. Wrote ${args.out}/snapshot.json, rollback.sql, and plan.sql.`);
    return;
  }
  const applied = spawnSync("psql", [args.db, "-v", "ON_ERROR_STOP=1", "-f", resolve(args.out, "plan.sql")], { encoding: "utf8" });
  if (applied.status !== 0) {
    throw new Error(applied.stderr || applied.stdout || "Apply failed.");
  }
  const after = Number(psql(args.db, "select next_number from public.sku_counter where id = 1"));
  if (after < before) throw new Error(`SKU counter moved backwards from ${before} to ${after}.`);
  writeFileSync(resolve(args.out, "verify.json"), `${JSON.stringify({
    skuCounterBefore: before,
    skuCounterAfter: after,
    kits: plan.creates.length + plan.converts.length,
    recipes: plan.recipes.length,
    generics: plan.generics.length,
  }, null, 2)}\n`);
  console.log(applied.stdout);
}

main();
