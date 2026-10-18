import { errorText } from "@/lib/errors";
import { ITEM_IMAGE_BUCKET, signedImageUrls } from "@/lib/images";
import { getSupabase } from "@/lib/supabase";
import type {
  Attribute,
  AttributeDefinition,
  DataType,
  ItemDetail,
  ItemList,
  ItemListColumn,
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
  data_type: string;
  unit: string | null;
  uses_list: boolean | null;
  attribute_values: AttributeValueRow[] | null;
};

type TaxonomyRow = {
  id: string;
  name: string;
  long_code: string | null;
  short_code: string | null;
  sort_order: number;
  attributes: AttributeRow[] | null;
};

type EmbeddedAttribute = { name: string } | { name: string }[] | null;

type ItemAttributeRow = {
  value: string;
  attributes: EmbeddedAttribute;
};

type ItemRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  quantity: number | null;
  taxonomy_id: string | null;
  item_attributes: ItemAttributeRow[] | null;
};

type SummaryImage = {
  storage_path: string;
  is_primary: boolean;
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
  taxonomies: ListTaxonomy | ListTaxonomy[] | null;
  item_images: SummaryImage[] | null;
  item_attributes: ListField[] | null;
};

const LIST_COLUMNS =
  "id, sku, name, quantity, taxonomies(name, short_code), item_images(storage_path, is_primary), item_attributes(value, attributes(name))";

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
    data_type: asDataType(attribute.data_type),
    unit: attribute.unit,
    uses_list: attribute.uses_list !== false,
    allowedValues: values.map((row) => row.value),
    values,
  };
}

const TAXONOMY_COLUMNS =
  "id, name, long_code, short_code, sort_order, attributes(id, name, data_type, unit, uses_list, attribute_values(id, value, sort_order))";

function toTaxonomy(taxonomy: TaxonomyRow): Taxonomy {
  return {
    id: taxonomy.id,
    name: taxonomy.name,
    longCode: taxonomy.long_code,
    shortCode: taxonomy.short_code,
    sortOrder: taxonomy.sort_order,
    attributes: (taxonomy.attributes ?? [])
      .map(mapAttribute)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function fetchTaxonomy(id: string): Promise<Taxonomy | null> {
  const { data, error } = await getSupabase()
    .from("taxonomies")
    .select(TAXONOMY_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(errorText(error));
  if (!data) return null;
  return toTaxonomy(data as TaxonomyRow);
}

export async function fetchTaxonomies(): Promise<Taxonomy[]> {
  const { data, error } = await getSupabase()
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
  const { data, error } = await getSupabase()
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

export async function fetchItemList(input: { tax?: string | null; q?: string | null }): Promise<ItemList> {
  const supabase = getSupabase();
  const tax = input.tax?.trim().toUpperCase() ?? "";
  const q = input.q?.trim() ?? "";

  const counted = await supabase.from("items").select("id", { count: "exact", head: true });
  if (counted.error) throw new Error(errorText(counted.error));
  const total = counted.count ?? 0;

  let taxonomyId: string | null = null;
  let columns: ItemListColumn[] = [];
  if (tax) {
    const found = await supabase
      .from("taxonomies")
      .select("id, attributes(name, unit)")
      .eq("short_code", tax)
      .maybeSingle();
    if (found.error) throw new Error(errorText(found.error));
    if (!found.data) return { rows: [], total, columns: [], unknownTax: true };
    taxonomyId = found.data.id as string;
    const attributes = (found.data.attributes ?? []) as { name: string; unit: string | null }[];
    columns = attributes
      .map((attribute) => ({ name: attribute.name, unit: attribute.unit }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  let ids: string[] | null = null;
  if (q) {
    const pattern = likePattern(q);
    const textQueries = (["sku", "name", "description"] as const).map((column) => {
      let query = supabase.from("items").select("id").ilike(column, pattern);
      if (taxonomyId) query = query.eq("taxonomy_id", taxonomyId);
      return query;
    });
    const [textResults, attributeResult] = await Promise.all([
      Promise.all(textQueries),
      supabase.from("item_attributes").select("item_id").ilike("value", pattern),
    ]);
    const failed = textResults.find((result) => result.error);
    if (failed?.error) throw new Error(errorText(failed.error));
    if (attributeResult.error) throw new Error(errorText(attributeResult.error));

    const matched = new Set<string>();
    for (const result of textResults) {
      for (const row of result.data ?? []) {
        if (typeof row.id === "string") matched.add(row.id);
      }
    }
    for (const row of attributeResult.data ?? []) {
      if (typeof row.item_id === "string") matched.add(row.item_id);
    }
    ids = [...matched];
    if (ids.length === 0) return { rows: [], total, columns, unknownTax: false };
  }

  let query = supabase.from("items").select(LIST_COLUMNS).order("sku", { ascending: true });
  if (taxonomyId) query = query.eq("taxonomy_id", taxonomyId);
  if (ids) query = query.in("id", ids);

  const listed = await query;
  if (listed.error) throw new Error(errorText(listed.error));

  const records = (listed.data ?? []) as ListRow[];
  const paths = records.map((item) => primaryPath(item.item_images));
  const urls = await signedImageUrls(paths.filter((path): path is string => Boolean(path)));

  return {
    rows: records.map((item, index) => {
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
        imageUrl: paths[index] ? urls.get(paths[index] as string) ?? null : null,
        fields,
      };
    }),
    total,
    columns,
    unknownTax: false,
  };
}

function primaryPath(images: SummaryImage[] | null): string | null {
  if (!images || images.length === 0) return null;
  return (images.find((image) => image.is_primary) ?? images[0]).storage_path;
}

export async function fetchItem(id: string): Promise<ItemDetail | null> {
  const { data, error } = await getSupabase()
    .from("items")
    .select(
      "id, sku, name, description, quantity, taxonomy_id, item_attributes(value, attributes(name))",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(errorText(error));
  if (!data) return null;

  const item = data as ItemRow;
  const attributes: Record<string, string> = {};
  for (const row of item.item_attributes ?? []) {
    const name = embeddedName(row.attributes);
    if (name) attributes[name] = row.value;
  }

  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    description: item.description ?? "",
    quantity: item.quantity,
    taxonomyId: item.taxonomy_id,
    attributes,
  };
}

export async function findItemForLabel(identifier: string): Promise<LabelItem | null> {
  const query = identifier.trim();
  if (!query) return null;

  const supabase = getSupabase();
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
  quantity: number | null;
  taxonomyName: string | null;
  attributes: Record<string, string>;
  attributeDefs: AttributeDefinition[];
  longCode?: string | null;
  shortCode?: string | null;
};

export type TaxonomyInput = {
  name: string;
  longCode: string | null;
  shortCode: string | null;
};

export async function createItem(input: ItemInput): Promise<string> {
  const { data, error } = await getSupabase().rpc("create_item", {
    p_name: input.name,
    p_taxonomy: input.taxonomyName,
    p_attributes: input.attributes,
    p_sku: input.sku,
    p_description: input.description,
    p_quantity: input.quantity,
    p_attribute_defs: input.attributeDefs,
    p_long_code: input.longCode ?? null,
    p_short_code: input.shortCode ?? null,
  });

  if (error) throw new Error(errorText(error));
  if (typeof data !== "string") throw new Error("Create did not return an item id.");
  return data;
}

export async function deleteItem(id: string): Promise<void> {
  const supabase = getSupabase();
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
  const { error } = await getSupabase().rpc("update_item", {
    p_id: id,
    p_name: input.name,
    p_taxonomy: input.taxonomyName,
    p_attributes: input.taxonomyName ? input.attributes : {},
    p_sku: input.sku,
    p_description: input.description,
    p_quantity: input.quantity,
    p_attribute_defs: input.taxonomyName ? input.attributeDefs : [],
    p_long_code: input.longCode ?? null,
    p_short_code: input.shortCode ?? null,
  });

  if (error) throw new Error(errorText(error));
}

export async function updateTaxonomy(id: string, input: TaxonomyInput): Promise<void> {
  const { error } = await getSupabase()
    .from("taxonomies")
    .update({
      name: input.name,
      long_code: input.longCode,
      short_code: input.shortCode,
    })
    .eq("id", id);

  if (error) throw new Error(errorText(error));
}

export async function saveTaxonomyOrder(ids: string[]): Promise<void> {
  const supabase = getSupabase();
  const results = await Promise.all(
    ids.map((id, index) =>
      supabase.from("taxonomies").update({ sort_order: index + 1 }).eq("id", id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(errorText(failed.error));
}
