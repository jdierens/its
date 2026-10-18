import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import type {
  Attribute,
  DataType,
  ItemDetail,
  ItemSummary,
  Taxonomy,
} from "@/lib/types";

type AttributeRow = {
  id: string;
  name: string;
  data_type: string;
  unit: string | null;
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

type SummaryRow = {
  id: string;
  sku: string;
  name: string;
  quantity: number | null;
  taxonomies: { name: string } | { name: string }[] | null;
};

const DATA_TYPES = new Set<DataType>(["integer", "text", "decimal"]);

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

export async function fetchTaxonomies(): Promise<Taxonomy[]> {
  const { data, error } = await getSupabase()
    .from("taxonomies")
    .select("id, name, attributes(id, name, data_type, unit)")
    .order("name");

  if (error) throw new Error(errorText(error));

  return ((data ?? []) as TaxonomyRow[]).map((taxonomy) => ({
    id: taxonomy.id,
    name: taxonomy.name,
    attributes: (taxonomy.attributes ?? [])
      .map(
        (attribute): Attribute => ({
          id: attribute.id,
          name: attribute.name,
          data_type: asDataType(attribute.data_type),
          unit: attribute.unit,
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export async function fetchItems(): Promise<ItemSummary[]> {
  const { data, error } = await getSupabase()
    .from("items")
    .select("id, sku, name, quantity, taxonomies(name)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(errorText(error));

  return ((data ?? []) as SummaryRow[]).map((item) => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    taxonomyName: embeddedName(item.taxonomies),
  }));
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

export type ItemInput = {
  name: string;
  sku: string;
  description: string;
  quantity: number | null;
  taxonomyName: string | null;
  attributes: Record<string, string>;
};

export async function createItem(input: ItemInput): Promise<string> {
  if (!input.taxonomyName) {
    throw new Error("Choose a taxonomy.");
  }

  const { data, error } = await getSupabase().rpc("create_item", {
    p_name: input.name,
    p_taxonomy: input.taxonomyName,
    p_attributes: input.attributes,
    p_sku: input.sku,
    p_description: input.description,
    p_quantity: input.quantity,
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
  });

  if (error) throw new Error(errorText(error));
}
