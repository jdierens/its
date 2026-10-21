import { errorText } from "@/lib/errors";
import { moneyCell, timestampCell, type ExportAttribute, type ExportItem, type MoneyField } from "@/lib/export/table";
import { itemSortRequest, parseItemSort } from "@/lib/itemSort";
import { resolveItemQuery } from "@/lib/items";
import { getSupabase } from "@/lib/supabase";

const ID_CHUNK = 150;
const LIST_PAGE = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DETAIL_COLUMNS = [
  "id",
  "sku",
  "name",
  "description",
  "item_type",
  "quantity",
  "model",
  "part_number",
  "oem_name",
  "oem_part_number",
  "product_url",
  "unit",
  "condition",
  "condition_note",
  "eccn",
  "us_hts",
  "ccats",
  "coo",
  "updated_at",
  "manufacturers(name)",
  "taxonomies(short_code, name, sort_order, taxonomy_attributes(sort_order, attributes(name)))",
  "item_attributes(value, attributes(name))",
].join(", ");

const PRICE_COLUMNS = ["ecommerce_price", "market_price", "msrp"] as const;

type Named = { name: string | null };
type TaxLink = {
  sort_order: number | null;
  attributes: Named | Named[] | null;
};
type TaxRow = {
  short_code: string | null;
  name: string | null;
  sort_order: number | null;
  taxonomy_attributes: TaxLink[] | null;
};
type FieldRow = {
  value: string | null;
  attributes: Named | Named[] | null;
};
type ExportRow = {
  id: string;
  sku: string | null;
  name: string | null;
  description: string | null;
  item_type: string | null;
  quantity: number | null;
  model: string | null;
  part_number: string | null;
  oem_name: string | null;
  oem_part_number: string | null;
  product_url: string | null;
  unit: string | null;
  condition: string | null;
  condition_note: string | null;
  eccn: string | null;
  us_hts: string | null;
  ccats: string | null;
  coo: string | null;
  updated_at: string | null;
  ecommerce_price?: unknown;
  market_price?: unknown;
  msrp?: unknown;
  manufacturers: Named | Named[] | null;
  taxonomies: TaxRow | TaxRow[] | null;
  item_attributes: FieldRow[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function parsePage(data: unknown): { ids: string[]; count: number } {
  const body = data && typeof data === "object" ? (data as { count?: unknown; ids?: unknown }) : {};
  const count = typeof body.count === "number" ? body.count : Number(body.count ?? 0);
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  return { ids, count: Number.isFinite(count) ? count : 0 };
}

async function listAllIds(input: {
  ids: string[] | null;
  taxonomyId: string | null;
  condition: string | null;
  manufacturerId: string | null;
  itemType: string | null;
  sort: string;
  ascending: boolean;
  attribute: string | null;
  attributeNumeric: boolean;
}): Promise<string[]> {
  const supabase = await getSupabase();
  const ordered: string[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let count = 0;
  for (;;) {
    const listed = await supabase.rpc("item_list_page", {
      p_ids: input.ids,
      p_taxonomy_id: input.taxonomyId,
      p_condition: input.condition,
      p_manufacturer_id: input.manufacturerId,
      p_item_type: input.itemType,
      p_sort: input.sort,
      p_ascending: input.ascending,
      p_attribute: input.attribute,
      p_attribute_numeric: input.attributeNumeric,
      p_limit: LIST_PAGE,
      p_offset: offset,
    });
    if (listed.error) throw new Error(errorText(listed.error));
    const page = parsePage(listed.data);
    count = page.count;
    let added = 0;
    for (const id of page.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
      added += 1;
    }
    if (page.ids.length === 0 || added === 0 || ordered.length >= count) break;
    offset += LIST_PAGE;
  }
  return ordered;
}

async function selectDetails(ids: string[], columns: string): Promise<Map<string, ExportRow>> {
  const supabase = await getSupabase();
  const byId = new Map<string, ExportRow>();
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const chunk = ids.slice(index, index + ID_CHUNK);
    const listed = await supabase.from("items").select(columns).in("id", chunk);
    if (listed.error) throw new Error(errorText(listed.error));
    for (const row of (listed.data ?? []) as unknown as ExportRow[]) byId.set(row.id, row);
  }
  return byId;
}

function toExportItem(row: ExportRow, includeMoney: boolean): ExportItem {
  const taxonomy = one(row.taxonomies);
  const shortCode = text(taxonomy?.short_code).toUpperCase();
  const links = taxonomy?.taxonomy_attributes ?? [];
  const taxonomySort = taxonomy?.sort_order ?? Number.MAX_SAFE_INTEGER;
  const attributeOrder: ExportAttribute[] = links.flatMap((link) => {
    const attribute = one(link.attributes);
    const name = text(attribute?.name);
    if (!name) return [];
    return [{ name, taxonomySort, sort: link.sort_order ?? 0 }];
  });

  const attributes: Record<string, string> = {};
  for (const field of row.item_attributes ?? []) {
    const name = text(one(field.attributes)?.name);
    if (!name || attributes[name]) continue;
    attributes[name] = field.value ?? "";
  }

  const prices: ExportItem["prices"] = {};
  if (includeMoney) {
    prices.ecommerce_price = moneyCell(row.ecommerce_price);
    prices.market_price = moneyCell(row.market_price);
    prices.msrp = moneyCell(row.msrp);
  }

  return {
    sku: text(row.sku),
    name: text(row.name),
    description: text(row.description),
    taxonomy: shortCode || text(taxonomy?.name),
    itemType: text(row.item_type) || "Product",
    manufacturer: text(one(row.manufacturers)?.name),
    model: text(row.model),
    partNumber: text(row.part_number),
    oemName: text(row.oem_name),
    oemPartNumber: text(row.oem_part_number),
    productUrl: text(row.product_url),
    unit: text(row.unit) || "Piece",
    condition: text(row.condition),
    conditionNote: text(row.condition_note),
    eccn: text(row.eccn),
    usHts: text(row.us_hts),
    ccats: text(row.ccats),
    coo: text(row.coo),
    quantity: row.quantity === null || row.quantity === undefined ? "" : String(row.quantity),
    prices,
    updatedAt: timestampCell(row.updated_at),
    attributes,
    attributeOrder,
  };
}

export function selectedExportIds(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const id = value.trim();
    if (!UUID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export async function loadExportItems(input: {
  tax?: string;
  q?: string;
  condition?: string;
  manufacturerId?: string;
  itemType?: string;
  sort?: string;
  dir?: string;
  selectedIds?: string[];
  includeMoney: boolean;
}): Promise<{ items: ExportItem[]; unknownTax: boolean }> {
  const askedForSelection = (input.selectedIds?.length ?? 0) > 0;
  const picked = selectedExportIds(input.selectedIds);
  if (askedForSelection && picked.length === 0) return { items: [], unknownTax: false };
  const resolved = picked.length > 0
    ? {
        taxonomyId: null,
        columns: [],
        ids: picked,
        condition: "" as const,
        manufacturerId: null,
        itemType: "" as const,
        unknownTax: false,
        empty: false,
      }
    : await resolveItemQuery(input);

  if (resolved.unknownTax || resolved.empty) {
    return { items: [], unknownTax: resolved.unknownTax };
  }

  const sort = parseItemSort(input.sort ?? null, input.dir ?? null);
  const attributeName = sort.column.startsWith("attr:") ? sort.column.slice(5) : null;
  let attributeNumeric = false;
  if (attributeName) {
    const fromColumns = resolved.columns.find((column) => column.name === attributeName);
    if (fromColumns) {
      attributeNumeric = fromColumns.dataType === "integer" || fromColumns.dataType === "decimal";
    } else {
      const found = await (await getSupabase())
        .from("attributes")
        .select("data_type")
        .eq("name", attributeName)
        .maybeSingle();
      if (found.error) throw new Error(errorText(found.error));
      const dataType = found.data?.data_type;
      attributeNumeric = dataType === "integer" || dataType === "decimal";
    }
  }
  const request = itemSortRequest(sort, attributeNumeric ? "decimal" : null);
  const ids = await listAllIds({
    ids: resolved.ids,
    taxonomyId: resolved.taxonomyId,
    condition: resolved.condition || null,
    manufacturerId: resolved.manufacturerId,
    itemType: resolved.itemType || null,
    sort: request.sort,
    ascending: request.ascending,
    attribute: request.attribute,
    attributeNumeric: request.numeric,
  });
  if (ids.length === 0) return { items: [], unknownTax: false };

  const columns = input.includeMoney ? `${DETAIL_COLUMNS}, ${PRICE_COLUMNS.join(", ")}` : DETAIL_COLUMNS;
  const byId = await selectDetails(ids, columns);
  const items = ids
    .map((id) => byId.get(id))
    .filter((row): row is ExportRow => Boolean(row))
    .map((row) => toExportItem(row, input.includeMoney));
  return { items, unknownTax: false };
}

export type { MoneyField };
