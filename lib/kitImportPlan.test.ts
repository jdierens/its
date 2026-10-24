import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { counterMovedBackward, emitKitSql, planKitImport, readKitsCsv, readRecipesCsv } from "./kitImportPlan.ts";

const kitName = "DL360G10-S8/CSRF90_2/S240_2/M32R4_16/R408/P80_2/_K";

test("kit csv keeps slashes in the name", () => {
  const parsed = readKitsCsv(`sku,name,taxonomy_code,action\n107100,${kitName},KIT/SRV,create\n`);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.rows[0].name, kitName);
});

test("import guards reject an existing create, a missing component, a nested kit, and a bad quantity", () => {
  const kits = readKitsCsv(
    ["sku,name,taxonomy_code,action", "107100,Kit A,KIT/SRV,create", "107101,Kit B,KIT/BDL,convert", "107102,Pair,KIT/BDL,create"].join("\n"),
  );
  const recipes = readRecipesCsv(
    ["kit_sku,component_sku,qty_per_kit", "107100,90001,2", "107100,90002,0", "107101,90003,1", "107102,90001,1", "107102,90004,1"].join("\n"),
  );
  const known = new Map([
    ["107100", { sku: "107100", itemType: "Product", hasHistory: false }],
    ["107101", { sku: "107101", itemType: "Product", hasHistory: true }],
    ["90001", { sku: "90001", itemType: "Product", hasHistory: false }],
    ["90003", { sku: "90003", itemType: "Kit/Package", hasHistory: false }],
    ["90004", { sku: "90004", itemType: "Product", hasHistory: false }],
  ]);
  const plan = planKitImport({ kits: kits.rows, recipes: recipes.rows, generics: ["missing"], known });
  const messages = [...kits.issues, ...recipes.issues, ...plan.issues].map((issue) => issue.message).join("\n");
  assert.match(messages, /already exists/);
  assert.match(messages, /cannot be converted|has inventory/);
  assert.match(messages, /does not exist/);
  assert.match(messages, /cannot be a Kit\/Package/);
  assert.match(messages, /greater than zero/);
  assert.match(messages, /exactly one/);
  assert.match(messages, /Generic SKU does not exist/);
});

test("emitted SQL keeps kit slashes and product backslashes", () => {
  const product = "MEM\\PC4-2400T-R\\32G\\2Rx4";
  const kitName = "DL360G10-S8/CSRF90_2/S240_2/M32R4_16/R408/P80_2/_K";
  const files = emitKitSql({
    kits: [{ sku: "107110", name: kitName, taxonomyCode: "KIT/SRV", action: "create" }],
    recipes: [{ kitSku: "107110", componentSku: "90103", qtyPerKit: 4 }],
    generics: ["90103"],
  });
  assert.match(files.applySql, /begin;/);
  assert.match(files.applySql, /commit;/);
  assert.equal(files.applySql.includes(kitName), true);
  assert.equal(files.applySql.includes(kitName.replaceAll("/", "\\")), false);
  assert.equal(files.verifySql.includes("expected"), true);
  const withProduct = emitKitSql({
    kits: [{ sku: "107111", name: product, taxonomyCode: "KIT/BDL", action: "convert" }],
    recipes: [{ kitSku: "107111", componentSku: "90102", qtyPerKit: 2 }],
    generics: [],
  });
  assert.equal(withProduct.applySql.includes(product), true);
  assert.equal(withProduct.applySql.includes(product.replaceAll("\\", "/")), false);
  assert.match(files.applySql, /Recipe row has no matching kit/);
  assert.throws(
    () => emitKitSql({ kits: [], recipes: [{ kitSku: "1", componentSku: "2", qtyPerKit: 1.5 }], generics: [] }),
    /whole number/,
  );
  const release = readFileSync(new URL("../supabase/migrations/20261024100100_kit_sales_lines.sql", import.meta.url), "utf8");
  assert.match(release, /coalesce\(actual\.is_generic, false\)/);
  assert.match(release, /A generic part cannot be the actual part/);
  assert.match(release, /cannot fill a generic component/);
});

test("the SKU counter is not allowed to move backwards", () => {
  assert.equal(counterMovedBackward(107188, 107188), false);
  assert.equal(counterMovedBackward(107188, 107189), false);
  assert.equal(counterMovedBackward(107188, 107124), true);
});
