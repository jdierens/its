import { errorText } from "@/lib/errors";
import { signedImageUrls } from "@/lib/images";
import { getSupabase } from "@/lib/supabase";
import type {
  Attribute,
  AttributeDefinition,
  DataType,
  ItemDetail,
  ItemSummary,
  LabelItem,
  Taxonomy,
} from "@/lib/types";

type AttributeValueRow = {
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

type SummaryRow = {
  id: string;
  sku: string;
  name: string;
  quantity: number | null;
  taxonomies: { name: string } | { name: string }[] | null;
  item_images: SummaryImage[] | null;
};

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
  const allowedValues = (attribute.attribute_values ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.value.localeCompare(b.value, undefined, { numeric: true }))
    .map((row) => row.value);

  return {
    id: attribute.id,
    name: attribute.name,
    data_type: asDataType(attribute.data_type),
    unit: attribute.unit,
    uses_list: attribute.uses_list !== false,
    allowedValues,
  };
}

export async function fetchTaxonomies(): Promise<Taxonomy[]> {
  const { data, error } = await getSupabase()
    .from("taxonomies")
    .select("id, name, attributes(id, name, data_type, unit, uses_list, attribute_values(value, sort_order))")
    .order("name");

  if (error) throw new Error(errorText(error));

  return ((data ?? []) as TaxonomyRow[]).map((taxonomy) => ({
    id: taxonomy.id,
    name: taxonomy.name,
    attributes: (taxonomy.attributes ?? [])
      .map(mapAttribute)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export async function fetchItems(): Promise<ItemSummary[]> {
  const { data, error } = await getSupabase()
    .from("items")
    .select("id, sku, name, quantity, taxonomies(name), item_images(storage_path, is_primary)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(errorText(error));

  const rows = (data ?? []) as SummaryRow[];
  const primaryPaths = rows.map((item) => primaryPath(item.item_images));
  const urls = await signedImageUrls(primaryPaths.filter((path): path is string => Boolean(path)));

  return rows.map((item, index) => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    taxonomyName: embeddedName(item.taxonomies),
    imageUrl: primaryPaths[index] ? urls.get(primaryPaths[index] as string) ?? null : null,
  }));
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
  const columns = "id, sku, name, description";

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

type LabelRow = {
  id: string;
  sku: string | null;
  name: string | null;
  description: string | null;
};

function toLabelItem(row: LabelRow): LabelItem {
  return {
    id: row.id,
    sku: row.sku ?? "",
    name: row.name ?? "",
    description: row.description ?? "",
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
  });

  if (error) throw new Error(errorText(error));
  if (typeof data !== "string") throw new Error("Create did not return an item id.");
  return data;
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
  });

  if (error) throw new Error(errorText(error));
}
