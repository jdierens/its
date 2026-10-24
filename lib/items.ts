"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ebayPresenceForItems, itemIdsMatchingEbayItemId } from "@/lib/ebay/listings";
import { errorText } from "@/lib/errors";
import { ITEM_IMAGE_BUCKET } from "@/lib/imageFiles";
import { primaryStoragePath } from "@/lib/imageOrder";
import { signedImageUrls } from "@/lib/images";
import {
  DEFAULT_CONDITION,
  DEFAULT_ECCN,
  isItemCondition,
  isItemType,
  itemTypeOrDefault,
  unitOrDefault,
  type ItemType,
} from "@/lib/itemFields";
import { ITEM_PAGE_SIZE, itemSortRequest, parseItemPage, parseItemSort } from "@/lib/itemSort";
import { getSupabase } from "@/lib/supabase";
import type {
  Attribute,
  AttributeDefinition,
  DataType,
  ItemDetail,
  ItemList,
  ItemListColumn,
  ItemListRow,
  LabelItem,
  Taxonomy,
  TaxonomyChoice,
} from "@/lib/types";

type AttributeValueRow = {
  id: string;
  value: string;
  sort_order: number;
};

type AttributeRow = {
  id: string;
  name: string;
  label: string | null;
  data_type: string;
  unit: string | null;
  uses_list: boolean | null;
  attribute_values: AttributeValueRow[] | null;
};

type AttributeLinkRow = {
  sort_order: number;
  required: boolean | null;
  attributes: AttributeRow | AttributeRow[] | null;
};

type TaxonomyRow = {
  id: string;
  name: string;
  long_code: string | null;
  short_code: string | null;
  sort_order: number;
  taxonomy_attributes: AttributeLinkRow[] | null;
};

type EmbeddedAttribute = { name: string } | { name: string }[] | null;

type ItemAttributeRow = {
  value: string;
  attribute_id: string;
  attributes: EmbeddedAttribute;
};

type ItemRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  notes: string | null;
  quantity: number | null;
  taxonomy_id: string | null;
  manufacturer_id: string | null;
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
  item_type: string | null;
  is_generic?: boolean | null;
  manufacturers: EmbeddedAttribute;
  item_attributes: ItemAttributeRow[] | null;
};

type SummaryImage = {
  storage_path: string;
  sort_order: number;
};

type ListTaxonomy = { name: string; short_code: string | null };

type ListField = {
  value: string;
  attributes: { name: string } | { name: string }[] | null;
};

type ListRow = {
  id: string;
  sku: string;
  name: string;
  quantity: number | null;
  manufacturer_id: string | null;
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
  item_type: string | null;
  is_generic?: boolean | null;
  updated_at: string | null;
  ecommerce_price?: unknown;
  market_price?: unknown;
  msrp?: unknown;
  manufacturers: EmbeddedAttribute;
  taxonomies: ListTaxonomy | ListTaxonomy[] | null;
  item_images: SummaryImage[] | null;
  item_attributes: ListField[] | null;
};

const LIST_DETAIL =
  "id, sku, name, item_type, is_generic, quantity, manufacturer_id, model, part_number, oem_name, oem_part_number, product_url, unit, condition, condition_note, eccn, us_hts, ccats, coo, updated_at, manufacturers(name), taxonomies(name, short_code), item_images(storage_path, sort_order), item_attributes(value, attributes(name))";

const PRICE_COLUMNS = ["ecommerce_price", "market_price", "msrp"] as const;

const DATA_TYPES = new Set<DataType>(["integer", "text", "decimal"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asDataType(value: string): DataType {
  return DATA_TYPES.has(value as DataType) ? (value as DataType) : "text";
}

function embeddedName(
  value: { name: string } | { name: string }[] | null,
): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0]?.name ?? null;
  return value.name;
}

function mapAttribute(attribute: AttributeRow): Attribute {
  const values = (attribute.attribute_values ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.value.localeCompare(b.value, undefined, { numeric: true }))
    .map((row) => ({
      id: row.id,
      value: row.value,
      sortOrder: row.sort_order,
    }));

  return {
    id: attribute.id,
    name: attribute.name,
    label: attribute.label,
    data_type: asDataType(attribute.data_type),
    unit: attribute.unit,
    uses_list: attribute.uses_list !== false,
    required: false,
    sortOrder: 0,
    allowedValues: values.map((row) => row.value),
    values,
  };
}

const TAXONOMY_COLUMNS =
  "id, name, long_code, short_code, sort_order, taxonomy_attributes(sort_order, required, attributes(id, name, label, data_type, unit, uses_list, attribute_values(id, value, sort_order)))";

function linkedAttribute(value: AttributeRow | AttributeRow[] | null): AttributeRow | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function toTaxonomy(taxonomy: TaxonomyRow): Taxonomy {
  const attributes = (taxonomy.taxonomy_attributes ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((link) => {
      const attribute = linkedAttribute(link.attributes);
      if (!attribute) return [];
      return [{ ...mapAttribute(attribute), sortOrder: link.sort_order, required: link.required === true }];
    });

  return {
    id: taxonomy.id,
    name: taxonomy.name,
    longCode: taxonomy.long_code,
    shortCode: taxonomy.short_code,
    sortOrder: taxonomy.sort_order,
    attributes,
  };
}

export async function fetchTaxonomy(id: string): Promise<Taxonomy | null> {
  const { data, error } = await (await getSupabase())
    .from("taxonomies")
    .select(TAXONOMY_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(errorText(error));
  if (!data) return null;
  return toTaxonomy(data as TaxonomyRow);
}

export async function fetchTaxonomies(): Promise<Taxonomy[]> {
  const { data, error } = await (await getSupabase())
    .from("taxonomies")
    .select(TAXONOMY_COLUMNS)
    .order("sort_order")
    .order("name");

  if (error) throw new Error(errorText(error));

  return ((data ?? []) as TaxonomyRow[]).map(toTaxonomy);
}

function embeddedTaxonomy(value: ListRow["taxonomies"]): ListTaxonomy | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function likePattern(raw: string): string {
  return `%${raw.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&")}%`;
}

export async function fetchTaxonomyChoices(): Promise<TaxonomyChoice[]> {
  const { data, error } = await (await getSupabase())
    .from("taxonomies")
    .select("name, short_code")
    .order("sort_order")
    .order("name");

  if (error) throw new Error(errorText(error));

  return (data ?? [])
    .map((row) => ({
      name: String(row.name ?? ""),
      shortCode: String(row.short_code ?? "").trim().toUpperCase(),
    }))
    .filter((row) => row.shortCode.length > 0);
}

export type ResolvedItemQuery = {
  taxonomyId: string | null;
  columns: ItemListColumn[];
  ids: string[] | null;
  condition: "" | "New" | "Used";
  manufacturerId: string | null;
  itemType: "" | ItemType;
  unknownTax: boolean;
  empty: boolean;
};

export async function resolveItemQuery(input: {
  tax?: string | null;
  q?: string | null;
  condition?: string | null;
  manufacturerId?: string | null;
  itemType?: string | null;
  generic?: string | null;
}): Promise<ResolvedItemQuery> {
  const supabase = await getSupabase();
  const tax = input.tax?.trim().toUpperCase() ?? "";
  const q = input.q?.trim() ?? "";
  const condition = input.condition === "New" || input.condition === "Used" ? input.condition : "";
  const manufacturerId = input.manufacturerId?.trim() ?? "";
  const rawItemType = input.itemType?.trim() ?? "";
  const itemType = isItemType(rawItemType) ? rawItemType : "";

  let taxonomyId: string | null = null;
  let columns: ItemListColumn[] = [];
  if (tax) {
    const found = await supabase
      .from("taxonomies")
      .select(
        "id, taxonomy_attributes(sort_order, attributes(name, unit, data_type, uses_list, attribute_values(value, sort_order)))",
      )
      .eq("short_code", tax)
      .maybeSingle();
    if (found.error) throw new Error(errorText(found.error));
    if (!found.data) {
      return {
        taxonomyId: null,
        columns: [],
        ids: null,
        condition,
        manufacturerId: null,
        itemType,
        unknownTax: true,
        empty: true,
      };
    }
    taxonomyId = found.data.id as string;
    const links = (found.data.taxonomy_attributes ?? []) as {
      sort_order: number;
      attributes:
        | {
            name: string;
            unit: string | null;
            data_type: string;
            uses_list: boolean | null;
            attribute_values: { value: string; sort_order: number }[] | null;
          }
        | {
            name: string;
            unit: string | null;
            data_type: string;
            uses_list: boolean | null;
            attribute_values: { value: string; sort_order: number }[] | null;
          }[]
        | null;
    }[];
    columns = links
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .flatMap((link) => {
        const attribute = Array.isArray(link.attributes) ? link.attributes[0] : link.attributes;
        if (!attribute) return [];
        const dataType = asDataType(attribute.data_type);
        const allowed = (attribute.attribute_values ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order || a.value.localeCompare(b.value, undefined, { numeric: true }))
          .map((entry) => entry.value);
        return [
          {
            name: attribute.name,
            unit: attribute.unit,
            dataType,
            usesList: attribute.uses_list !== false,
            allowedValues: allowed,
          },
        ];
      });
  }

  if (manufacturerId && !UUID_PATTERN.test(manufacturerId)) {
    return {
      taxonomyId,
      columns,
      ids: null,
      condition,
      manufacturerId: null,
      itemType,
      unknownTax: false,
      empty: true,
    };
  }

  let ids: string[] | null = null;
  if (q) {
    const pattern = likePattern(q);
    const textQueries = (["sku", "name", "description", "model", "part_number", "oem_name", "oem_part_number", "product_url"] as const).map((column) => {
      let query = supabase.from("items").select("id").ilike(column, pattern);
      if (taxonomyId) query = query.eq("taxonomy_id", taxonomyId);
      return query;
    });
    const [textResults, attributeResult, nameResult, aliasResult, ebayItemIds] = await Promise.all([
      Promise.all(textQueries),
      supabase.from("item_attributes").select("item_id").ilike("value", pattern),
      supabase.from("manufacturers").select("id").ilike("name", pattern),
      supabase.from("manufacturer_aliases").select("manufacturer_id").ilike("alias", pattern),
      itemIdsMatchingEbayItemId(supabase, pattern),
    ]);
    const failed = textResults.find((result) => result.error);
    if (failed?.error) throw new Error(errorText(failed.error));
    if (attributeResult.error) throw new Error(errorText(attributeResult.error));
    if (nameResult.error) throw new Error(errorText(nameResult.error));
    if (aliasResult.error) throw new Error(errorText(aliasResult.error));

    const matched = new Set<string>();
    for (const result of textResults) {
      for (const row of result.data ?? []) {
        if (typeof row.id === "string") matched.add(row.id);
      }
    }
    for (const row of attributeResult.data ?? []) {
      if (typeof row.item_id === "string") matched.add(row.item_id);
    }
    for (const id of ebayItemIds) matched.add(id);

    const makerIds = new Set<string>();
    for (const row of nameResult.data ?? []) {
      if (typeof row.id === "string") makerIds.add(row.id);
    }
    for (const row of aliasResult.data ?? []) {
      if (typeof row.manufacturer_id === "string") makerIds.add(row.manufacturer_id);
    }
    if (makerIds.size > 0) {
      let makerItems = supabase.from("items").select("id").in("manufacturer_id", [...makerIds]);
      if (taxonomyId) makerItems = makerItems.eq("taxonomy_id", taxonomyId);
      const made = await makerItems;
      if (made.error) throw new Error(errorText(made.error));
      for (const row of made.data ?? []) {
        if (typeof row.id === "string") matched.add(row.id);
      }
    }

    ids = [...matched];
    if (ids.length === 0) {
      return {
        taxonomyId,
        columns,
        ids,
        condition,
        manufacturerId: manufacturerId || null,
        itemType,
        unknownTax: false,
        empty: true,
      };
    }
  }

  if (input.generic === "1") {
    let genericQuery = supabase.from("items").select("id").eq("is_generic", true);
    if (taxonomyId) genericQuery = genericQuery.eq("taxonomy_id", taxonomyId);
    const genericRows = await genericQuery;
    if (genericRows.error) throw new Error(errorText(genericRows.error));
    const genericIds = new Set((genericRows.data ?? []).map((row) => String(row.id)));
    const next = ids ? ids.filter((id) => genericIds.has(id)) : [...genericIds];
    if (next.length === 0) {
      return {
        taxonomyId,
        columns,
        ids: [],
        condition,
        manufacturerId: manufacturerId || null,
        itemType,
        unknownTax: false,
        empty: true,
      };
    }
    ids = next;
  }

  return {
    taxonomyId,
    columns,
    ids,
    condition,
    manufacturerId: manufacturerId || null,
    itemType,
    unknownTax: false,
    empty: false,
  };
}

export async function fetchItemList(input: {
  tax?: string | null;
  q?: string | null;
  condition?: string | null;
  manufacturerId?: string | null;
  itemType?: string | null;
  generic?: string | null;
  sort?: string | null;
  dir?: string | null;
  page?: number | null;
}): Promise<ItemList> {
  const supabase = await getSupabase();
  const counted = await supabase.from("items").select("id", { count: "exact", head: true });
  if (counted.error) throw new Error(errorText(counted.error));
  const total = counted.count ?? 0;

  const resolved = await resolveItemQuery({ ...input, generic: input.generic });
  if (resolved.unknownTax) return { rows: [], total, matched: 0, page: 1, columns: [], pricing: false, unknownTax: true };
  if (resolved.empty) return { rows: [], total, matched: 0, page: 1, columns: resolved.columns, pricing: false, unknownTax: false };

  const pricing = await pricingAvailable(supabase);
  const sort = parseItemSort(input.sort ?? null, input.dir ?? null);
  const attribute = sort.column.startsWith("attr:")
    ? resolved.columns.find((column) => column.name === sort.column.slice(5))
    : undefined;
  const request = itemSortRequest(sort, attribute?.dataType ?? null);
  const requestedPage = parseItemPage(input.page == null ? null : String(input.page));
  const listed = await listItemPage(supabase, {
    ids: resolved.ids,
    taxonomyId: resolved.taxonomyId,
    condition: resolved.condition || null,
    manufacturerId: resolved.manufacturerId,
    itemType: resolved.itemType || null,
    sort: request.sort,
    ascending: request.ascending,
    attribute: request.attribute,
    attributeNumeric: request.numeric,
    page: requestedPage,
  });

  if (listed.ids.length === 0) {
    return {
      rows: [],
      total,
      matched: listed.count,
      page: listed.page,
      columns: resolved.columns,
      pricing,
      unknownTax: false,
    };
  }

  const fetched = await supabase.from("items").select(listColumns(pricing)).in("id", listed.ids);
  if (fetched.error) throw new Error(errorText(fetched.error));
  const byId = new Map(((fetched.data ?? []) as unknown as ListRow[]).map((item) => [item.id, item]));
  const records = listed.ids.map((id) => byId.get(id)).filter((item): item is ListRow => Boolean(item));
  const paths = records.map((item) => primaryPath(item.item_images));
  const [urls, ebayViews] = await Promise.all([
    signedImageUrls(paths.filter((path): path is string => Boolean(path))),
    ebayPresenceForItems(supabase, records.map((item) => item.id)),
  ]);

  return {
    rows: records.map((item, index) => ({
      ...toListRow(item, paths[index] ? urls.get(paths[index] as string) ?? null : null),
      ebayListings: ebayViews.get(item.id)?.direct ?? [],
      ebayKitListings: ebayViews.get(item.id)?.kits ?? [],
    })),
    total,
    matched: listed.count,
    page: listed.page,
    columns: resolved.columns,
    pricing,
    unknownTax: false,
  };
}

async function listItemPage(
  supabase: SupabaseClient,
  input: {
    ids: string[] | null;
    taxonomyId: string | null;
    condition: string | null;
    manufacturerId: string | null;
    itemType: string | null;
    sort: string;
    ascending: boolean;
    attribute: string | null;
    attributeNumeric: boolean;
    page: number;
  },
): Promise<{ ids: string[]; count: number; page: number }> {
  const load = (page: number) =>
    supabase.rpc("item_list_page", {
      p_ids: input.ids,
      p_taxonomy_id: input.taxonomyId,
      p_condition: input.condition,
      p_manufacturer_id: input.manufacturerId,
      p_item_type: input.itemType,
      p_sort: input.sort,
      p_ascending: input.ascending,
      p_attribute: input.attribute,
      p_attribute_numeric: input.attributeNumeric,
      p_limit: ITEM_PAGE_SIZE,
      p_offset: (page - 1) * ITEM_PAGE_SIZE,
    });

  const first = await load(input.page);
  if (first.error) throw new Error(errorText(first.error));
  const parsed = parseItemPageResult(first.data);
  if (parsed.count === 0 || (input.page - 1) * ITEM_PAGE_SIZE < parsed.count) {
    return { ...parsed, page: parsed.count === 0 ? 1 : input.page };
  }
  const lastPage = Math.max(1, Math.ceil(parsed.count / ITEM_PAGE_SIZE));
  const second = await load(lastPage);
  if (second.error) throw new Error(errorText(second.error));
  return { ...parseItemPageResult(second.data), page: lastPage };
}

function parseItemPageResult(data: unknown): { ids: string[]; count: number } {
  const body = data && typeof data === "object" ? (data as { count?: unknown; ids?: unknown }) : {};
  const count = typeof body.count === "number" ? body.count : Number(body.count ?? 0);
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  return { ids, count: Number.isFinite(count) ? count : 0 };
}

function listColumns(pricing: boolean): string {
  if (!pricing) return LIST_DETAIL;
  return `${LIST_DETAIL}, ${PRICE_COLUMNS.join(", ")}`;
}

async function pricingAvailable(supabase: SupabaseClient): Promise<boolean> {
  const probe = await supabase.from("items").select(PRICE_COLUMNS.join(",")).limit(1);
  return !probe.error;
}

function moneyText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toFixed(2);
}

function toListRow(item: ListRow, imageUrl: string | null): ItemListRow {
  const taxonomy = embeddedTaxonomy(item.taxonomies);
  const fields: Record<string, string> = {};
  for (const field of item.item_attributes ?? []) {
    const name = embeddedName(field.attributes);
    if (name) fields[name] = field.value;
  }
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    taxonomyName: taxonomy?.name ?? null,
    shortCode: taxonomy?.short_code?.trim().toUpperCase() || null,
    imageUrl,
    manufacturerId: item.manufacturer_id,
    manufacturerName: embeddedName(item.manufacturers),
    model: item.model ?? "",
    partNumber: item.part_number ?? "",
    oemName: item.oem_name ?? "",
    oemPartNumber: item.oem_part_number ?? "",
    productUrl: item.product_url ?? "",
    unit: unitOrDefault(item.unit),
    itemType: itemTypeOrDefault(item.item_type),
    condition: item.condition ?? DEFAULT_CONDITION,
    conditionNote: item.condition_note ?? "",
    eccn: item.eccn ?? DEFAULT_ECCN,
    usHts: item.us_hts ?? "",
    ccats: item.ccats ?? "",
    coo: item.coo ?? "",
    ecommercePrice: moneyText(item.ecommerce_price),
    marketPrice: moneyText(item.market_price),
    msrp: moneyText(item.msrp),
    updatedAt: item.updated_at ?? "",
    fields,
    isGeneric: Boolean(item.is_generic),
    ebayListings: [],
    ebayKitListings: [],
  };
}

export async function fetchListedItem(id: string): Promise<ItemListRow | null> {
  const supabase = await getSupabase();
  const pricing = await pricingAvailable(supabase);
  const listed = await supabase.from("items").select(listColumns(pricing)).eq("id", id).maybeSingle();
  if (listed.error) throw new Error(errorText(listed.error));
  if (!listed.data) return null;
  const item = listed.data as unknown as ListRow;
  const path = primaryPath(item.item_images);
  const [urls, ebayViews] = await Promise.all([
    path ? signedImageUrls([path]) : Promise.resolve(new Map<string, string>()),
    ebayPresenceForItems(supabase, [item.id]),
  ]);
  const ebay = ebayViews.get(item.id);
  return {
    ...toListRow(item, path ? urls.get(path) ?? null : null),
    ebayListings: ebay?.direct ?? [],
    ebayKitListings: ebay?.kits ?? [],
  };
}

export type CellSave = {
  updatedAt: string;
  value: string;
  conditionNote: string;
  manufacturerId: string | null;
  manufacturerName: string | null;
};

export async function saveItemCell(input: {
  id: string;
  field: string;
  value: string;
  expectedUpdatedAt: string;
}): Promise<CellSave> {
  const { data, error } = await (await getSupabase()).rpc("update_item_cell", {
    p_id: input.id,
    p_field: input.field,
    p_value: input.value,
    p_expected_updated_at: input.expectedUpdatedAt,
  });
  if (error) throw new Error(errorText(error));
  const record = (data ?? {}) as {
    updated_at?: string;
    value?: string;
    condition_note?: string;
    manufacturer_id?: string | null;
    manufacturer_name?: string | null;
  };
  return {
    updatedAt: record.updated_at ?? "",
    value: record.value ?? "",
    conditionNote: record.condition_note ?? "",
    manufacturerId: record.manufacturer_id ?? null,
    manufacturerName: record.manufacturer_name ?? null,
  };
}

function primaryPath(images: SummaryImage[] | null): string | null {
  return primaryStoragePath(images);
}

export async function fetchItem(id: string): Promise<ItemDetail | null> {
  const { data, error } = await (await getSupabase())
    .from("items")
    .select(
      "id, sku, name, description, notes, item_type, is_generic, quantity, taxonomy_id, manufacturer_id, model, part_number, oem_name, oem_part_number, product_url, unit, condition, condition_note, eccn, us_hts, ccats, coo, manufacturers(name), item_attributes(value, attribute_id, attributes(name))",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(errorText(error));
  if (!data) return null;

  const item = data as ItemRow;
  const attributes: Record<string, string> = {};
  const attributeLinks: { id: string; name: string; value: string }[] = [];
  for (const row of item.item_attributes ?? []) {
    const name = embeddedName(row.attributes);
    if (!name) continue;
    attributes[name] = row.value;
    attributeLinks.push({ id: row.attribute_id, name, value: row.value });
  }

  const rawCondition = item.condition ?? "";
  const condition = isItemCondition(rawCondition) ? rawCondition : DEFAULT_CONDITION;

  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    description: item.description ?? "",
    itemType: itemTypeOrDefault(item.item_type),
    quantity: item.quantity,
    taxonomyId: item.taxonomy_id,
    manufacturerId: item.manufacturer_id,
    manufacturerName: embeddedName(item.manufacturers) ?? "",
    model: item.model ?? "",
    partNumber: item.part_number ?? "",
    oemName: item.oem_name ?? "",
    oemPartNumber: item.oem_part_number ?? "",
    productUrl: item.product_url ?? "",
    unit: unitOrDefault(item.unit),
    condition,
    conditionNote: item.condition_note ?? "",
    eccn: item.eccn ?? DEFAULT_ECCN,
    usHts: item.us_hts ?? "",
    ccats: item.ccats ?? "",
    coo: item.coo ?? "",
    notes: item.notes ?? "",
    isGeneric: Boolean(item.is_generic),
    attributes,
    attributeLinks,
  };
}

export async function findItemForLabel(identifier: string): Promise<LabelItem | null> {
  const query = identifier.trim();
  if (!query) return null;

  const supabase = await getSupabase();
  const columns = "id, sku, name, description, taxonomies(short_code)";

  if (UUID_PATTERN.test(query)) {
    const byId = await supabase.from("items").select(columns).eq("id", query).maybeSingle();
    if (byId.error) throw new Error(errorText(byId.error));
    if (byId.data) return toLabelItem(byId.data as LabelRow);
  }

  const bySku = await supabase.from("items").select(columns).eq("sku", query).maybeSingle();
  if (bySku.error) throw new Error(errorText(bySku.error));
  if (!bySku.data) return null;
  return toLabelItem(bySku.data as LabelRow);
}

type LabelTaxonomy = { short_code: string | null };

type LabelRow = {
  id: string;
  sku: string | null;
  name: string | null;
  description: string | null;
  taxonomies: LabelTaxonomy | LabelTaxonomy[] | null;
};

function embeddedShortCode(value: LabelRow["taxonomies"]): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  const code = row?.short_code?.trim().toUpperCase() ?? "";
  return code || null;
}

function toLabelItem(row: LabelRow): LabelItem {
  return {
    id: row.id,
    sku: row.sku ?? "",
    name: row.name ?? "",
    description: row.description ?? "",
    shortCode: embeddedShortCode(row.taxonomies),
  };
}

export type ItemInput = {
  name: string;
  sku: string;
  description: string;
  taxonomyName: string | null;
  attributes: Record<string, string>;
  attributeDefs: AttributeDefinition[];
  longCode?: string | null;
  shortCode?: string | null;
  manufacturerId: string | null;
  model: string;
  partNumber: string;
  oemName: string;
  oemPartNumber: string;
  productUrl: string;
  unit: string;
  condition: "New" | "Used";
  conditionNote: string;
  eccn: string;
  usHts: string;
  ccats: string;
  coo: string;
  itemType: ItemType;
};

export type TaxonomyInput = {
  name: string;
  longCode: string | null;
  shortCode: string | null;
};

function coreArgs(input: ItemInput) {
  return {
    p_manufacturer_id: input.manufacturerId,
    p_model: input.model.trim() || null,
    p_part_number: input.partNumber.trim() || null,
    p_condition: input.condition,
    p_condition_note: input.conditionNote.trim() || null,
    p_eccn: input.eccn.trim() || DEFAULT_ECCN,
    p_us_hts: input.usHts.trim() || null,
    p_ccats: input.ccats.trim() || null,
    p_coo: input.coo.trim() || null,
    p_item_type: input.itemType,
    p_oem_name: input.oemName.trim(),
    p_oem_part_number: input.oemPartNumber.trim(),
    p_unit: input.unit.trim(),
    p_product_url: input.productUrl.trim(),
  };
}

export async function createItem(input: ItemInput): Promise<string> {
  const { data, error } = await (await getSupabase()).rpc("create_item", {
    p_name: input.name,
    p_taxonomy: input.taxonomyName,
    p_attributes: input.attributes,
    p_sku: input.sku,
    p_description: input.description,
    p_quantity: null,
    p_attribute_defs: input.attributeDefs,
    p_long_code: input.longCode ?? null,
    p_short_code: input.shortCode ?? null,
    ...coreArgs(input),
  });

  if (error) throw new Error(errorText(error));
  if (typeof data !== "string") throw new Error("Create did not return an item id.");
  return data;
}

export async function deleteItem(id: string): Promise<void> {
  const supabase = await getSupabase();
  const images = await supabase.from("item_images").select("storage_path").eq("item_id", id);
  if (images.error) throw new Error(errorText(images.error));

  const paths = (images.data ?? [])
    .map((row) => row.storage_path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);
  if (paths.length > 0) {
    const removed = await supabase.storage.from(ITEM_IMAGE_BUCKET).remove(paths);
    if (removed.error) throw new Error(errorText(removed.error));
  }

  const deleted = await supabase.from("items").delete().eq("id", id).select("id");
  if (deleted.error) throw new Error(errorText(deleted.error));
  if (!deleted.data || deleted.data.length === 0) {
    throw new Error("That item is already gone.");
  }
}

export async function updateItem(id: string, input: ItemInput): Promise<void> {
  const { error } = await (await getSupabase()).rpc("update_item", {
    p_id: id,
    p_name: input.name,
    p_taxonomy: input.taxonomyName,
    p_attributes: input.taxonomyName ? input.attributes : {},
    p_sku: input.sku,
    p_description: input.description,
    p_attribute_defs: input.taxonomyName ? input.attributeDefs : [],
    p_long_code: input.longCode ?? null,
    p_short_code: input.shortCode ?? null,
    ...coreArgs(input),
  });

  if (error) throw new Error(errorText(error));
}

export async function saveItemNotes(id: string, notes: string): Promise<void> {
  const { error } = await (await getSupabase()).from("items").update({ notes: notes.trim() || null }).eq("id", id);
  if (error) throw new Error(errorText(error));
}

export type TaxonomyChangeResult = {
  taxonomyId: string;
  sku: string;
  notes: string;
};

export async function changeItemTaxonomy(input: {
  id: string;
  taxonomyId: string;
  copyNotes: boolean;
  regenerateSku: boolean;
}): Promise<TaxonomyChangeResult> {
  const { data, error } = await (await getSupabase()).rpc("change_item_taxonomy", {
    p_id: input.id,
    p_taxonomy_id: input.taxonomyId,
    p_copy_notes: input.copyNotes,
    p_regenerate_sku: input.regenerateSku,
  });
  if (error) throw new Error(errorText(error));
  const record = (data ?? {}) as { taxonomy_id?: string; sku?: string; notes?: string };
  return {
    taxonomyId: record.taxonomy_id ?? input.taxonomyId,
    sku: record.sku ?? "",
    notes: record.notes ?? "",
  };
}

function friendlyTaxonomyError(error: unknown): string {
  const text = errorText(error);
  if (text.includes("taxonomies_name_lower") || text.includes("taxonomies_name_key")) {
    return "A taxonomy with that name already exists.";
  }
  if (text.includes("taxonomies_long_code") || text.includes("Long code")) {
    return text.includes("already") ? "That long code is already used." : text;
  }
  if (text.includes("taxonomies_short_code") || text.includes("Short code")) {
    return text.includes("already") ? "That short code is already used." : text;
  }
  return text;
}

export async function createTaxonomy(input: TaxonomyInput): Promise<string> {
  const { data, error } = await (await getSupabase())
    .from("taxonomies")
    .insert({
      name: input.name.trim(),
      long_code: input.longCode,
      short_code: input.shortCode,
    })
    .select("id")
    .single();
  if (error) throw new Error(friendlyTaxonomyError(error));
  return data.id as string;
}

export async function countTaxonomyItems(id: string): Promise<number> {
  const { count, error } = await (await getSupabase())
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("taxonomy_id", id);
  if (error) throw new Error(errorText(error));
  return count ?? 0;
}

export async function deleteTaxonomy(id: string): Promise<void> {
  const count = await countTaxonomyItems(id);
  if (count > 0) {
    throw new Error(
      count === 1
        ? "Can't delete this taxonomy. 1 item uses it."
        : `Can't delete this taxonomy. ${count} items use it.`,
    );
  }
  const deleted = await (await getSupabase()).from("taxonomies").delete().eq("id", id).select("id");
  if (deleted.error) throw new Error(friendlyTaxonomyError(deleted.error));
  if (!deleted.data || deleted.data.length === 0) throw new Error("That taxonomy is already gone.");
}

export async function updateTaxonomy(id: string, input: TaxonomyInput): Promise<void> {
  const { error } = await (await getSupabase())
    .from("taxonomies")
    .update({
      name: input.name,
      long_code: input.longCode,
      short_code: input.shortCode,
    })
    .eq("id", id);

  if (error) throw new Error(friendlyTaxonomyError(error));
}

export async function saveTaxonomyOrder(ids: string[]): Promise<void> {
  const supabase = await getSupabase();
  const results = await Promise.all(
    ids.map((id, index) =>
      supabase.from("taxonomies").update({ sort_order: index + 1 }).eq("id", id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(errorText(failed.error));
}
