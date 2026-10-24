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

export type KitSqlFiles = {
  applySql: string;
  rollbackSql: string;
  verifySql: string;
};

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function fromRows(rows: string[], empty: string): string {
  if (rows.length === 0) return `(${empty})`;
  return `(values ${rows.join(", ")})`;
}

/** SQL a person can paste into Supabase. The database looks up every SKU itself. */
export function emitKitSql(input: {
  kits: KitCsvRow[];
  recipes: RecipeCsvRow[];
  generics: string[];
}): KitSqlFiles {
  const kitRows = input.kits.map(
    (kit) => `(${sqlLiteral(kit.sku)}, ${sqlLiteral(kit.name)}, ${sqlLiteral(kit.taxonomyCode)}, ${sqlLiteral(kit.action)})`,
  );
  const recipeRows = input.recipes.map(
    (recipe, index) => `(${sqlLiteral(recipe.kitSku)}, ${sqlLiteral(recipe.componentSku)}, ${recipe.qtyPerKit}, ${index + 1})`,
  );
  for (const recipe of input.recipes) {
    if (!Number.isInteger(recipe.qtyPerKit) || recipe.qtyPerKit < 1) {
      throw new Error(`Quantity for ${recipe.componentSku} must be a whole number greater than zero.`);
    }
  }
  const genericRows = input.generics.map((sku) => `(${sqlLiteral(sku)})`);
  const createSkus = input.kits.filter((kit) => kit.action === "create").map((kit) => sqlLiteral(kit.sku));
  const convertSkus = input.kits.filter((kit) => kit.action === "convert").map((kit) => sqlLiteral(kit.sku));
  const bundleSkus = input.kits.filter((kit) => kit.taxonomyCode === "KIT/BDL").map((kit) => sqlLiteral(kit.sku));
  const kitSkus = input.kits.map((kit) => sqlLiteral(kit.sku));
  const inList = (values: string[]) => (values.length ? values.join(", ") : "select null::text where false");
  const kitsFrom = fromRows(kitRows, "select null::text, null::text, null::text, null::text where false");
  const recipesFrom = fromRows(recipeRows, "select null::text, null::text, null::integer, null::integer where false");
  const genericsFrom = fromRows(genericRows, "select null::text where false");

  const applySql = `begin;

-- Paste into the SQL editor. One transaction. A failed guard rolls the whole file back.
-- Kit names are copied as given. A backslash in a name stays a backslash.

do $kit_apply_guard$
declare
  v_bad integer;
  v_sku text;
begin
  select count(*) into v_bad
  from ${kitsFrom} as kit(sku, name, taxonomy_code, action)
  where kit.action = 'create'
    and exists (select 1 from public.items where items.sku = kit.sku);
  if v_bad > 0 then
    raise exception 'Create aborted because a SKU already exists.';
  end if;

  select kit.sku into v_sku
  from ${kitsFrom} as kit(sku, name, taxonomy_code, action)
  where kit.action = 'convert'
    and not exists (select 1 from public.items where items.sku = kit.sku)
  limit 1;
  if v_sku is not null then
    raise exception 'Convert needs an existing SKU: %.', v_sku;
  end if;

  select kit.sku into v_sku
  from ${kitsFrom} as kit(sku, name, taxonomy_code, action)
  join public.items as item on item.sku = kit.sku
  where kit.action = 'convert'
    and public.item_has_stock_history(item.id)
  limit 1;
  if v_sku is not null then
    raise exception 'Convert aborted because SKU % has inventory, purchase, quote, or sales history.', v_sku;
  end if;

  select recipe.component_sku into v_sku
  from ${recipesFrom} as recipe(kit_sku, component_sku, qty_per_kit, ord)
  where not exists (select 1 from public.items where items.sku = recipe.component_sku)
  limit 1;
  if v_sku is not null then
    raise exception 'Component SKU % does not exist.', v_sku;
  end if;

  select recipe.component_sku into v_sku
  from ${recipesFrom} as recipe(kit_sku, component_sku, qty_per_kit, ord)
  join public.items as item on item.sku = recipe.component_sku
  where item.item_type = 'Kit/Package'
  limit 1;
  if v_sku is not null then
    raise exception 'Component % cannot be a Kit/Package.', v_sku;
  end if;

  select recipe.component_sku into v_sku
  from ${recipesFrom} as recipe(kit_sku, component_sku, qty_per_kit, ord)
  where recipe.qty_per_kit < 1
  limit 1;
  if v_sku is not null then
    raise exception 'Quantity for % must be greater than zero.', v_sku;
  end if;

  select kit.sku into v_sku
  from ${kitsFrom} as kit(sku, name, taxonomy_code, action)
  where kit.taxonomy_code = 'KIT/BDL'
    and (
      select count(distinct recipe.component_sku)
      from ${recipesFrom} as recipe(kit_sku, component_sku, qty_per_kit, ord)
      where recipe.kit_sku = kit.sku
    ) <> 1
  limit 1;
  if v_sku is not null then
    raise exception 'A kit bundle must have exactly one distinct component: %.', v_sku;
  end if;

  select generic.sku into v_sku
  from ${genericsFrom} as generic(sku)
  where not exists (select 1 from public.items where items.sku = generic.sku)
  limit 1;
  if v_sku is not null then
    raise exception 'Generic SKU % does not exist.', v_sku;
  end if;

  select kit.sku into v_sku
  from ${kitsFrom} as kit(sku, name, taxonomy_code, action)
  where kit.action = 'create'
    and (
      select defaults.condition is null or defaults.eccn is null
      from public.kit_field_defaults(
        kit.taxonomy_code,
        array(
          select item.id
          from ${recipesFrom} as recipe(kit_sku, component_sku, qty_per_kit, ord)
          join public.items as item on item.sku = recipe.component_sku
          where recipe.kit_sku = kit.sku
          order by recipe.ord
        )
      ) as defaults
    )
  limit 1;
  if v_sku is not null then
    raise exception 'Choose a condition and ECCN for kit %.', v_sku;
  end if;
  select recipe.kit_sku into v_sku
  from ${recipesFrom} as recipe(kit_sku, component_sku, qty_per_kit, ord)
  where not exists (
    select 1
    from ${kitsFrom} as kit(sku, name, taxonomy_code, action)
    where kit.sku = recipe.kit_sku
  )
  limit 1;
  if v_sku is not null then
    raise exception 'Recipe row has no matching kit: %.', v_sku;
  end if;
end
$kit_apply_guard$;

select public.import_kit_create(kit.sku, kit.name, kit.taxonomy_code, defaults.condition, defaults.eccn)
from ${kitsFrom} as kit(sku, name, taxonomy_code, action)
cross join lateral public.kit_field_defaults(
  kit.taxonomy_code,
  array(
    select item.id
    from ${recipesFrom} as recipe(kit_sku, component_sku, qty_per_kit, ord)
    join public.items as item on item.sku = recipe.component_sku
    where recipe.kit_sku = kit.sku
    order by recipe.ord
  )
) as defaults
where kit.action = 'create';

select public.convert_item_to_kit(item.id, kit.taxonomy_code, null)
from ${kitsFrom} as kit(sku, name, taxonomy_code, action)
join public.items as item on item.sku = kit.sku
where kit.action = 'convert';

select public.save_kit_components(
  kit_item.id,
  (
    select coalesce(jsonb_agg(jsonb_build_object(
      'component_item_id', component.id,
      'qty_per_kit', recipe.qty_per_kit,
      'notes', ''
    ) order by recipe.ord), '[]'::jsonb)
    from ${recipesFrom} as recipe(kit_sku, component_sku, qty_per_kit, ord)
    join public.items as component on component.sku = recipe.component_sku
    where recipe.kit_sku = kit_item.sku
  ),
  null
)
from public.items as kit_item
where kit_item.sku in (${inList(kitSkus)});

update public.items
set is_generic = true
where sku in (${inList(input.generics.map(sqlLiteral))});

commit;
`;

  const rollbackParts = ["begin;", "-- Undo the kit import. Created kits are deleted. Converts are restored from the conversion audit."];
  if (createSkus.length > 0) {
    rollbackParts.push(`delete from public.items where sku in (${createSkus.join(", ")});`);
  }
  if (convertSkus.length > 0) {
    rollbackParts.push(`do $rollback$
declare
  r record;
  v_type text;
  v_tax text;
  v_generic text;
begin
  alter table public.kit_events disable trigger kit_events_append_only;
  for r in
    select event_row.id, event_row.item_id, event_row.detail
    from public.kit_events as event_row
    join public.items as item on item.id = event_row.item_id
    where event_row.event = 'conversion'
      and item.sku in (${convertSkus.join(", ")})
      and event_row.detail like 'prior_type=%'
  loop
    v_type := substring(r.detail from 'prior_type=([^;]*)');
    v_tax := substring(r.detail from 'prior_taxonomy=([^;]*)');
    v_generic := substring(r.detail from 'prior_generic=([^;]*)');
    if v_type is null or v_tax is null or v_generic is null then
      raise exception 'Conversion audit cannot be read, so rollback stopped.';
    end if;
    update public.items
    set item_type = v_type,
        taxonomy_id = case when v_tax = 'null' then null else v_tax::uuid end,
        is_generic = (v_generic = 'true')
    where id = r.item_id;
    delete from public.kit_components where kit_item_id = r.item_id;
    delete from public.kit_events where id = r.id;
  end loop;
  alter table public.kit_events enable trigger kit_events_append_only;
end
$rollback$;`);
  }
  const genericOnly = input.generics.filter((sku) => !input.kits.some((kit) => kit.action === "convert" && kit.sku === sku));
  if (genericOnly.length > 0) {
    rollbackParts.push(
      `-- Clears the generic flag this import set. A SKU that was already generic is cleared too.`,
      `update public.items set is_generic = false where sku in (${genericOnly.map(sqlLiteral).join(", ")});`,
    );
  }
  rollbackParts.push("commit;", "");

  const verifySql = `select check_name, expected, actual
from (
  select 'kits'::text as check_name,
    ${input.kits.length}::integer as expected,
    (select count(*)::integer from public.items where sku in (${inList(kitSkus)}) and item_type = 'Kit/Package') as actual
  union all
  select 'recipes',
    ${input.recipes.length},
    (select count(*)::integer
     from public.kit_components as component
     join public.items as kit on kit.id = component.kit_item_id
     where kit.sku in (${inList(kitSkus)}))
  union all
  select 'generics',
    ${input.generics.length},
    (select count(*)::integer from public.items where sku in (${inList(input.generics.map(sqlLiteral))}) and is_generic)
  union all
  select 'bad_bundles',
    0,
    (select count(*)::integer
     from public.items as item
     where item.sku in (${inList(bundleSkus)})
       and (
         select count(distinct component.component_item_id)
         from public.kit_components as component
         where component.kit_item_id = item.id
       ) <> 1)
) checks
order by check_name;
`;

  return {
    applySql,
    rollbackSql: `${rollbackParts.join("\n")}\n`,
    verifySql,
  };
}
