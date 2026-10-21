"use server";

import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import type { DataType } from "@/lib/types";

function storedValueMatches(dataType: DataType, listed: string, stored: string): boolean {
  if (dataType === "text") return listed.trim().toLowerCase() === stored.trim().toLowerCase();
  if (listed.trim() === "" || stored.trim() === "") return false;
  const left = Number(listed);
  const right = Number(stored);
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

export type AttributeUsage = {
  itemCount: number;
  values: string[];
};

export type AttributeInput = {
  name: string;
  dataType: DataType;
  unit: string | null;
  usesList: boolean;
  label?: string | null;
};

export type FieldTaxonomyRef = {
  id: string;
  name: string;
  shortCode: string | null;
};

export type FieldCatalogEntry = {
  id: string;
  name: string;
  label: string | null;
  dataType: DataType;
  unit: string | null;
  usesList: boolean;
  taxonomies: FieldTaxonomyRef[];
};

const DATA_TYPES = new Set<DataType>(["integer", "text", "decimal"]);

function asDataType(value: string): DataType {
  return DATA_TYPES.has(value as DataType) ? (value as DataType) : "text";
}

function friendlyAttributeError(error: unknown): string {
  const text = errorText(error);
  if (
    text.includes("attributes_taxonomy_name_lower") ||
    text.includes("attributes_taxonomy_id_name") ||
    text.includes("already exists on this taxonomy") ||
    text.includes("already has a field named")
  ) {
    return "A field with that name already exists on this taxonomy.";
  }
  if (text.includes("attributes_identity_uidx")) {
    return "A field with that name, type, unit, and label already exists.";
  }
  if (text.includes("attribute_values_attribute_value_lower")) {
    return "That value is already on the list.";
  }
  if (text.includes("item_attributes_attribute_id_fkey")) {
    return "This field is still used on items, so it was not deleted.";
  }
  if (text.includes("Can't remove this field") || text.includes("Can''t remove this field")) {
    return text.replace(/Can''t/g, "Can't");
  }
  return text;
}

export async function fetchAttributeUsage(
  attributeIds: string[],
): Promise<Record<string, AttributeUsage>> {
  const usage: Record<string, AttributeUsage> = {};
  if (attributeIds.length === 0) return usage;

  const { data, error } = await (await getSupabase())
    .from("item_attributes")
    .select("attribute_id, value")
    .in("attribute_id", attributeIds);

  if (error) throw new Error(errorText(error));

  for (const row of data ?? []) {
    const id = row.attribute_id as string;
    const current = usage[id] ?? { itemCount: 0, values: [] };
    current.itemCount += 1;
    current.values.push(String(row.value ?? ""));
    usage[id] = current;
  }
  return usage;
}

type CatalogTaxonomy = {
  id: string;
  name: string;
  short_code: string | null;
};

type CatalogLink = {
  taxonomies: CatalogTaxonomy | CatalogTaxonomy[] | null;
};

type CatalogRow = {
  id: string;
  name: string;
  label: string | null;
  data_type: string;
  unit: string | null;
  uses_list: boolean | null;
  taxonomy_attributes: CatalogLink[] | null;
};

function oneTaxonomy(value: CatalogTaxonomy | CatalogTaxonomy[] | null): CatalogTaxonomy | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function fetchFieldCatalog(): Promise<FieldCatalogEntry[]> {
  const { data, error } = await (await getSupabase())
    .from("attributes")
    .select(
      "id, name, label, data_type, unit, uses_list, taxonomy_attributes(taxonomies(id, name, short_code))",
    )
    .order("name");

  if (error) throw new Error(errorText(error));

  return ((data ?? []) as CatalogRow[])
    .map((row) => ({
      id: row.id,
      name: row.name,
      label: row.label,
      dataType: asDataType(row.data_type),
      unit: row.unit,
      usesList: row.uses_list !== false,
      taxonomies: (row.taxonomy_attributes ?? []).flatMap((link) => {
        const taxonomy = oneTaxonomy(link.taxonomies);
        if (!taxonomy) return [];
        return [
          {
            id: taxonomy.id,
            name: taxonomy.name,
            shortCode: taxonomy.short_code,
          },
        ];
      }),
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        (a.label ?? "").localeCompare(b.label ?? ""),
    );
}

export async function fetchTaxonomyAttributeUsage(
  taxonomyId: string,
  attributeIds: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (attributeIds.length === 0) return counts;

  const supabase = await getSupabase();
  const items = await supabase.from("items").select("id").eq("taxonomy_id", taxonomyId);
  if (items.error) throw new Error(errorText(items.error));
  const itemIds = (items.data ?? []).map((row) => row.id as string);
  if (itemIds.length === 0) return counts;

  const values = await supabase
    .from("item_attributes")
    .select("attribute_id")
    .in("item_id", itemIds)
    .in("attribute_id", attributeIds);
  if (values.error) throw new Error(errorText(values.error));

  for (const row of values.data ?? []) {
    const id = row.attribute_id as string;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

export async function createAttribute(taxonomyId: string, input: AttributeInput): Promise<void> {
  const { error } = await (await getSupabase()).rpc("create_field", {
    p_taxonomy_id: taxonomyId,
    p_name: input.name.trim(),
    p_data_type: input.dataType,
    p_unit: input.unit,
    p_uses_list: input.usesList,
    p_label: input.label?.trim() || null,
  });
  if (error) throw new Error(friendlyAttributeError(error));
}

export async function updateAttribute(id: string, input: AttributeInput): Promise<void> {
  const patch: {
    name: string;
    data_type: DataType;
    unit: string | null;
    uses_list: boolean;
    label?: string | null;
  } = {
    name: input.name.trim(),
    data_type: input.dataType,
    unit: input.unit,
    uses_list: input.usesList,
  };
  if (input.label !== undefined) patch.label = input.label?.trim() || null;

  const { error } = await (await getSupabase()).from("attributes").update(patch).eq("id", id);
  if (error) throw new Error(friendlyAttributeError(error));
}

export async function linkAttributes(taxonomyId: string, attributeIds: string[]): Promise<number> {
  const { data, error } = await (await getSupabase()).rpc("link_taxonomy_attributes", {
    p_taxonomy_id: taxonomyId,
    p_attribute_ids: attributeIds,
  });
  if (error) throw new Error(friendlyAttributeError(error));
  return typeof data === "number" ? data : 0;
}

export async function unlinkAttribute(taxonomyId: string, attributeId: string): Promise<void> {
  const { error } = await (await getSupabase()).rpc("unlink_taxonomy_attribute", {
    p_taxonomy_id: taxonomyId,
    p_attribute_id: attributeId,
  });
  if (error) throw new Error(friendlyAttributeError(error));
}

export async function deleteField(id: string): Promise<void> {
  const { error } = await (await getSupabase()).rpc("delete_field", { p_attribute_id: id });
  if (error) throw new Error(friendlyAttributeError(error));
}

export async function mergeFields(keepId: string, dropId: string): Promise<void> {
  const { error } = await (await getSupabase()).rpc("merge_attributes", {
    p_keep: keepId,
    p_drop: dropId,
  });
  if (error) throw new Error(friendlyAttributeError(error));
}

export async function setFieldRequired(taxonomyId: string, attributeId: string, required: boolean): Promise<void> {
  const { error } = await (await getSupabase())
    .from("taxonomy_attributes")
    .update({ required })
    .eq("taxonomy_id", taxonomyId)
    .eq("attribute_id", attributeId);
  if (error) throw new Error(errorText(error));
}

export async function saveFieldOrder(taxonomyId: string, attributeIds: string[]): Promise<void> {
  const supabase = await getSupabase();
  const results = await Promise.all(
    attributeIds.map((attributeId, index) =>
      supabase
        .from("taxonomy_attributes")
        .update({ sort_order: index + 1 })
        .eq("taxonomy_id", taxonomyId)
        .eq("attribute_id", attributeId),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(errorText(failed.error));
}

export async function addAttributeValue(attributeId: string, value: string): Promise<void> {
  const supabase = await getSupabase();
  const existing = await supabase
    .from("attribute_values")
    .select("sort_order")
    .eq("attribute_id", attributeId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (existing.error) throw new Error(errorText(existing.error));
  const sortOrder = ((existing.data?.[0]?.sort_order as number | undefined) ?? 0) + 1;

  const inserted = await supabase.from("attribute_values").insert({
    attribute_id: attributeId,
    value: value.trim(),
    sort_order: sortOrder,
  });
  if (inserted.error) throw new Error(friendlyAttributeError(inserted.error));
}

export async function deleteAttributeValue(id: string): Promise<void> {
  const supabase = await getSupabase();
  const row = await supabase
    .from("attribute_values")
    .select("id, attribute_id, value")
    .eq("id", id)
    .maybeSingle();
  if (row.error) throw new Error(errorText(row.error));
  const listed = row.data;
  if (!listed) return;

  const attribute = await supabase
    .from("attributes")
    .select("data_type")
    .eq("id", listed.attribute_id)
    .maybeSingle();
  if (attribute.error) throw new Error(errorText(attribute.error));
  const dataType = (attribute.data?.data_type ?? "text") as DataType;
  const usage = await fetchAttributeUsage([listed.attribute_id as string]);
  const count = (usage[listed.attribute_id as string]?.values ?? []).filter((stored) =>
    storedValueMatches(dataType, String(listed.value), stored),
  ).length;
  if (count > 0) {
    throw new Error(
      `This value is used on ${count} ${count === 1 ? "item" : "items"}. Change those items before removing it.`,
    );
  }

  const { error } = await supabase.from("attribute_values").delete().eq("id", id);
  if (error) throw new Error(friendlyAttributeError(error));
}

export async function saveAttributeValueOrder(ids: string[]): Promise<void> {
  const supabase = await getSupabase();
  const results = await Promise.all(
    ids.map((id, index) =>
      supabase.from("attribute_values").update({ sort_order: index + 1 }).eq("id", id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(errorText(failed.error));
}
