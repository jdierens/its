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
};

function friendlyAttributeError(error: unknown): string {
  const text = errorText(error);
  if (
    text.includes("attributes_taxonomy_name_lower") ||
    text.includes("attributes_taxonomy_id_name")
  ) {
    return "A field with that name already exists on this taxonomy.";
  }
  if (text.includes("attribute_values_attribute_value_lower")) {
    return "That value is already on the list.";
  }
  if (text.includes("item_attributes_attribute_id_fkey")) {
    return "This field is still used on items, so it was not deleted.";
  }
  return text;
}

export async function fetchAttributeUsage(
  attributeIds: string[],
): Promise<Record<string, AttributeUsage>> {
  const usage: Record<string, AttributeUsage> = {};
  if (attributeIds.length === 0) return usage;

  const { data, error } = await getSupabase()
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

export async function createAttribute(taxonomyId: string, input: AttributeInput): Promise<void> {
  const { error } = await getSupabase().from("attributes").insert({
    taxonomy_id: taxonomyId,
    name: input.name.trim(),
    data_type: input.dataType,
    unit: input.unit,
    uses_list: input.usesList,
  });
  if (error) throw new Error(friendlyAttributeError(error));
}

export async function updateAttribute(id: string, input: AttributeInput): Promise<void> {
  const { error } = await getSupabase()
    .from("attributes")
    .update({
      name: input.name.trim(),
      data_type: input.dataType,
      unit: input.unit,
      uses_list: input.usesList,
    })
    .eq("id", id);
  if (error) throw new Error(friendlyAttributeError(error));
}

export async function deleteAttribute(id: string): Promise<void> {
  const usage = await fetchAttributeUsage([id]);
  const count = usage[id]?.itemCount ?? 0;
  if (count > 0) {
    throw new Error(
      `This field is used on ${count} ${count === 1 ? "item" : "items"}. Clear it on those items before deleting it.`,
    );
  }
  const { error } = await getSupabase().from("attributes").delete().eq("id", id);
  if (error) throw new Error(friendlyAttributeError(error));
}

export async function addAttributeValue(attributeId: string, value: string): Promise<void> {
  const supabase = getSupabase();
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
  const supabase = getSupabase();
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
  const supabase = getSupabase();
  const results = await Promise.all(
    ids.map((id, index) =>
      supabase.from("attribute_values").update({ sort_order: index + 1 }).eq("id", id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(errorText(failed.error));
}
