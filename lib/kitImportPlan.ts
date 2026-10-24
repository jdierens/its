import { keepKitName } from "./kitRules";

export type KitCsvRow = {
  sku: string;
  name: string;
  taxonomyCode: "KIT/SRV" | "KIT/BDL";
  action: "create" | "convert";
};

export type RecipeCsvRow = {
  kitSku: string;
  componentSku: string;
  qtyPerKit: number;
};

export type KnownItem = {
  sku: string;
  itemType: string;
  hasHistory: boolean;
};

export type ImportIssue = { sku: string; message: string };

export type ImportPlan = {
  creates: KitCsvRow[];
  converts: KitCsvRow[];
  generics: string[];
  recipes: RecipeCsvRow[];
  issues: ImportIssue[];
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  return rows;
}

function headerIndex(header: string[], names: string[]): number {
  const normalized = header.map((value) => value.trim().toLowerCase());
  for (const name of names) {
    const index = normalized.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

export function readKitsCsv(text: string): { rows: KitCsvRow[]; issues: ImportIssue[] } {
  const table = parseCsv(text);
  const issues: ImportIssue[] = [];
  if (table.length === 0) return { rows: [], issues: [{ sku: "", message: "kits.csv is empty." }] };
  const header = table[0];
  const skuAt = headerIndex(header, ["sku"]);
  const nameAt = headerIndex(header, ["name"]);
  const taxAt = headerIndex(header, ["taxonomy_code", "taxonomy"]);
  const actionAt = headerIndex(header, ["action"]);
  if (skuAt < 0 || nameAt < 0 || taxAt < 0 || actionAt < 0) {
    return { rows: [], issues: [{ sku: "", message: "kits.csv needs sku, name, taxonomy_code, and action." }] };
  }
  const rows: KitCsvRow[] = [];
  for (const record of table.slice(1)) {
    const sku = (record[skuAt] ?? "").trim();
    const name = keepKitName(record[nameAt] ?? "");
    const taxonomyCode = (record[taxAt] ?? "").trim().toUpperCase();
    const action = (record[actionAt] ?? "").trim().toLowerCase();
    if (!sku) {
      issues.push({ sku: "", message: "A kit row is missing a SKU." });
      continue;
    }
    if (taxonomyCode !== "KIT/SRV" && taxonomyCode !== "KIT/BDL") {
      issues.push({ sku, message: "taxonomy_code must be KIT/SRV or KIT/BDL." });
      continue;
    }
    if (action !== "create" && action !== "convert") {
      issues.push({ sku, message: "action must be create or convert." });
      continue;
    }
    if (!name) issues.push({ sku, message: "A kit needs a name." });
    rows.push({ sku, name, taxonomyCode, action });
  }
  return { rows, issues };
}

export function readRecipesCsv(text: string): { rows: RecipeCsvRow[]; issues: ImportIssue[] } {
  const table = parseCsv(text);
  const issues: ImportIssue[] = [];
  if (table.length === 0) return { rows: [], issues: [{ sku: "", message: "recipes.csv is empty." }] };
  const header = table[0];
  const kitAt = headerIndex(header, ["kit_sku"]);
  const componentAt = headerIndex(header, ["component_sku"]);
  const qtyAt = headerIndex(header, ["qty_per_kit", "qty"]);
  if (kitAt < 0 || componentAt < 0 || qtyAt < 0) {
    return { rows: [], issues: [{ sku: "", message: "recipes.csv needs kit_sku, component_sku, and qty_per_kit." }] };
  }
  const rows: RecipeCsvRow[] = [];
  for (const record of table.slice(1)) {
    const kitSku = (record[kitAt] ?? "").trim();
    const componentSku = (record[componentAt] ?? "").trim();
    const qty = Number((record[qtyAt] ?? "").trim());
    if (!kitSku || !componentSku) {
      issues.push({ sku: kitSku, message: "A recipe row needs a kit SKU and a component SKU." });
      continue;
    }
    if (!Number.isInteger(qty) || qty < 1) {
      issues.push({ sku: kitSku, message: `Quantity for ${componentSku} must be a whole number greater than zero.` });
      continue;
    }
    rows.push({ kitSku, componentSku, qtyPerKit: qty });
  }
  return { rows, issues };
}

export function readGenericsCsv(text: string): string[] {
  const table = parseCsv(text);
  if (table.length === 0) return [];
  const skuAt = headerIndex(table[0], ["sku"]);
  const start = skuAt >= 0 ? 1 : 0;
  const column = skuAt >= 0 ? skuAt : 0;
  return table.slice(start).map((row) => (row[column] ?? "").trim()).filter(Boolean);
}

export function planKitImport(input: {
  kits: KitCsvRow[];
  recipes: RecipeCsvRow[];
  generics: string[];
  known: Map<string, KnownItem>;
}): ImportPlan {
  const issues: ImportIssue[] = [];
  const creates: KitCsvRow[] = [];
  const converts: KitCsvRow[] = [];
  const seen = new Set<string>();
  for (const kit of input.kits) {
    if (seen.has(kit.sku)) issues.push({ sku: kit.sku, message: "That kit SKU is listed twice." });
    seen.add(kit.sku);
    const existing = input.known.get(kit.sku);
    if (kit.action === "create") {
      if (existing) issues.push({ sku: kit.sku, message: "Create aborted because that SKU already exists." });
      else creates.push(kit);
    } else {
      if (!existing) issues.push({ sku: kit.sku, message: "Convert needs an existing SKU." });
      else if (existing.hasHistory) issues.push({ sku: kit.sku, message: "Convert aborted because that SKU has inventory, purchase, quote, or sales history." });
      else converts.push(kit);
    }
  }
  const kitSkus = new Set(input.kits.map((kit) => kit.sku));
  const componentCounts = new Map<string, Set<string>>();
  for (const recipe of input.recipes) {
    if (!kitSkus.has(recipe.kitSku)) {
      issues.push({ sku: recipe.kitSku, message: "Recipe row has no matching kit." });
      continue;
    }
    const component = input.known.get(recipe.componentSku);
    if (!component) issues.push({ sku: recipe.componentSku, message: "That component SKU does not exist." });
    else if (component.itemType === "Kit/Package") issues.push({ sku: recipe.componentSku, message: "A component cannot be a Kit/Package." });
    const set = componentCounts.get(recipe.kitSku) ?? new Set<string>();
    set.add(recipe.componentSku);
    componentCounts.set(recipe.kitSku, set);
  }
  for (const kit of input.kits) {
    if (kit.taxonomyCode !== "KIT/BDL") continue;
    const count = componentCounts.get(kit.sku)?.size ?? 0;
    if (count !== 1) issues.push({ sku: kit.sku, message: "A kit bundle must have exactly one distinct component." });
  }
  for (const sku of input.generics) {
    if (!input.known.get(sku)) issues.push({ sku, message: "Generic SKU does not exist." });
  }
  return {
    creates,
    converts,
    generics: input.generics,
    recipes: input.recipes,
    issues,
  };
}

export function counterMovedBackward(before: number, after: number): boolean {
  return after < before;
}
