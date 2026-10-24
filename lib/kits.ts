"use server";

import { errorText } from "@/lib/errors";
import { salesTableMissing } from "@/lib/kitRules";
import { purchaseOperatorId } from "@/lib/purchaseSession";
import { getSupabase } from "@/lib/supabase";

export type KitComponentView = {
  id: string;
  componentItemId: string;
  sku: string;
  name: string;
  generic: boolean;
  qtyPerKit: number;
  notes: string;
  longCode: string | null;
  condition: string | null;
  eccn: string | null;
};

export type UsedInKit = {
  kitItemId: string;
  sku: string;
  name: string;
  qtyPerKit: number;
};

export type PartChoice = {
  id: string;
  sku: string;
  name: string;
  generic: boolean;
  suggested: boolean;
  longCode: string | null;
  condition: string | null;
  eccn: string | null;
};

export type SoComponentView = {
  id: string;
  plannedItemId: string;
  plannedSku: string;
  plannedName: string;
  plannedGeneric: boolean;
  actualItemId: string | null;
  actualSku: string;
  actualName: string;
  actualGeneric: boolean;
  qty: string;
  swapReason: string;
  swapped: boolean;
};

export type SoKitLineView = {
  lineId: string;
  lineNo: number;
  description: string;
  qty: string;
  kitSku: string;
  kitName: string;
  components: SoComponentView[];
};

function operatorId(): Promise<string | null> {
  return purchaseOperatorId().catch(() => null);
}

export async function loadKitRecipe(itemId: string): Promise<KitComponentView[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("kit_components")
    .select("id, qty_per_kit, notes, component_item_id, items!kit_components_component_item_id_fkey(sku, name, is_generic, condition, eccn, taxonomies(long_code))")
    .eq("kit_item_id", itemId)
    .order("sort_order");
  if (error) throw new Error(errorText(error));
  return (data ?? []).map((row) => {
    const item = Array.isArray(row.items) ? row.items[0] : row.items;
    const taxonomy = item && "taxonomies" in item ? (Array.isArray(item.taxonomies) ? item.taxonomies[0] : item.taxonomies) : null;
    return {
      id: String(row.id),
      componentItemId: String(row.component_item_id),
      sku: String(item?.sku ?? ""),
      name: String(item?.name ?? ""),
      generic: Boolean(item?.is_generic),
      qtyPerKit: Number(row.qty_per_kit),
      notes: String(row.notes ?? ""),
      longCode: taxonomy?.long_code ? String(taxonomy.long_code) : null,
      condition: item?.condition ? String(item.condition) : null,
      eccn: item?.eccn ? String(item.eccn) : null,
    };
  });
}

export async function saveKitRecipe(
  itemId: string,
  rows: { componentItemId: string; qtyPerKit: number; notes: string }[],
): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("save_kit_components", {
    p_kit_id: itemId,
    p_components: rows.map((row) => ({
      component_item_id: row.componentItemId,
      qty_per_kit: row.qtyPerKit,
      notes: row.notes,
    })),
    p_updated_by: await operatorId(),
  });
  if (error) throw new Error(errorText(error));
}

export async function loadUsedInKits(itemId: string): Promise<UsedInKit[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("kit_components")
    .select("qty_per_kit, items!kit_components_kit_item_id_fkey(id, sku, name)")
    .eq("component_item_id", itemId);
  if (error) throw new Error(errorText(error));
  return (data ?? []).flatMap((row) => {
    const kit = Array.isArray(row.items) ? row.items[0] : row.items;
    if (!kit?.id) return [];
    return [{
      kitItemId: String(kit.id),
      sku: String(kit.sku ?? ""),
      name: String(kit.name ?? ""),
      qtyPerKit: Number(row.qty_per_kit),
    }];
  });
}

const PART_FIELDS = "id, sku, name, is_generic, item_type, condition, eccn, taxonomies(long_code)";

function toPartChoice(row: {
  id?: string;
  sku?: string | null;
  name?: string | null;
  is_generic?: boolean | null;
  condition?: string | null;
  eccn?: string | null;
  taxonomies?: { long_code?: string | null } | { long_code?: string | null }[] | null;
}, suggested: boolean): PartChoice {
  const taxonomy = Array.isArray(row.taxonomies) ? row.taxonomies[0] : row.taxonomies;
  return {
    id: String(row.id),
    sku: String(row.sku ?? ""),
    name: String(row.name ?? ""),
    generic: Boolean(row.is_generic),
    suggested,
    longCode: taxonomy?.long_code ? String(taxonomy.long_code) : null,
    condition: row.condition ? String(row.condition) : null,
    eccn: row.eccn ? String(row.eccn) : null,
  };
}

function partMatches(choice: PartChoice, query: string): boolean {
  const needle = query.toLowerCase();
  return choice.sku.toLowerCase().includes(needle) || choice.name.toLowerCase().includes(needle);
}

export async function searchParts(
  query: string,
  plannedItemId: string | null,
  options?: { excludeGeneric?: boolean },
): Promise<PartChoice[]> {
  const supabase = await getSupabase();
  const trimmed = query.trim();
  const excludeGeneric = options?.excludeGeneric === true;
  const byId = new Map<string, PartChoice>();
  if (plannedItemId) {
    const subs = await supabase
      .from("item_substitutes")
      .select(`substitute_item_id, items!item_substitutes_substitute_item_id_fkey(${PART_FIELDS})`)
      .eq("item_id", plannedItemId);
    if (subs.error) throw new Error(errorText(subs.error));
    for (const row of subs.data ?? []) {
      const item = Array.isArray(row.items) ? row.items[0] : row.items;
      if (!item || item.item_type === "Kit/Package") continue;
      if (excludeGeneric && item.is_generic) continue;
      const choice = toPartChoice(item, true);
      if (trimmed && !partMatches(choice, trimmed)) continue;
      byId.set(choice.id, choice);
    }
  }
  let request = supabase.from("items").select(PART_FIELDS).neq("item_type", "Kit/Package").limit(30);
  if (excludeGeneric) request = request.eq("is_generic", false);
  if (trimmed) {
    const pattern = `%${trimmed.replace(/[%_]/g, "")}%`;
    request = supabase
      .from("items")
      .select(PART_FIELDS)
      .neq("item_type", "Kit/Package")
      .or(`sku.ilike.${pattern},name.ilike.${pattern}`)
      .limit(30);
    if (excludeGeneric) request = request.eq("is_generic", false);
  }
  const { data, error } = await request;
  if (error) throw new Error(errorText(error));
  for (const row of data ?? []) {
    if (byId.has(String(row.id))) continue;
    byId.set(String(row.id), toPartChoice(row, false));
  }
  return [...byId.values()].sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.sku.localeCompare(b.sku, undefined, { numeric: true }));
}

export async function setItemGeneric(itemId: string, generic: boolean): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.from("items").update({ is_generic: generic }).eq("id", itemId);
  if (error) throw new Error(errorText(error));
}

export type SoKitLineLoad =
  | { status: "ready"; line: SoKitLineView }
  | { status: "missing" }
  | { status: "unavailable" };

export async function loadSoKitLine(lineId: string): Promise<SoKitLineLoad> {
  const supabase = await getSupabase();
  const line = await supabase
    .from("so_lines")
    .select("id, line_no, customer_part_number, customer_description, qty")
    .eq("id", lineId)
    .maybeSingle();
  if (line.error) {
    if (salesTableMissing(line.error)) return { status: "unavailable" };
    throw new Error(errorText(line.error));
  }
  if (!line.data) return { status: "missing" };
  const allocations = await supabase
    .from("so_line_allocations")
    .select("items(sku, name, item_type)")
    .eq("so_line_id", lineId);
  if (allocations.error) {
    if (salesTableMissing(allocations.error)) return { status: "unavailable" };
    throw new Error(errorText(allocations.error));
  }
  const kit = (allocations.data ?? [])
    .map((row) => (Array.isArray(row.items) ? row.items[0] : row.items))
    .find((item) => item && item.item_type === "Kit/Package");
  const components = await supabase
    .from("so_line_components")
    .select("id, planned_item_id, actual_item_id, qty, swap_reason, planned:items!so_line_components_planned_item_id_fkey(sku, name, is_generic), actual:items!so_line_components_actual_item_id_fkey(sku, name, is_generic)")
    .eq("so_line_id", lineId);
  if (components.error) {
    if (salesTableMissing(components.error)) return { status: "unavailable" };
    throw new Error(errorText(components.error));
  }
  return {
    status: "ready",
    line: {
      lineId: String(line.data.id),
      lineNo: Number(line.data.line_no),
      description: String(line.data.customer_description || line.data.customer_part_number || kit?.name || ""),
      qty: String(line.data.qty ?? ""),
      kitSku: String(kit?.sku ?? ""),
      kitName: String(kit?.name ?? ""),
      components: (components.data ?? []).map((row) => {
      const planned = Array.isArray(row.planned) ? row.planned[0] : row.planned;
      const actual = Array.isArray(row.actual) ? row.actual[0] : row.actual;
      const actualId = row.actual_item_id ? String(row.actual_item_id) : null;
      return {
        id: String(row.id),
        plannedItemId: String(row.planned_item_id),
        plannedSku: String(planned?.sku ?? ""),
        plannedName: String(planned?.name ?? ""),
        plannedGeneric: Boolean(planned?.is_generic),
        actualItemId: actualId,
        actualSku: String(actual?.sku ?? ""),
        actualName: String(actual?.name ?? ""),
        actualGeneric: Boolean(actual?.is_generic),
        qty: String(row.qty ?? ""),
        swapReason: String(row.swap_reason ?? ""),
        swapped: Boolean(actualId && actualId !== String(row.planned_item_id)),
      };
    }),
    },
  };
}

export async function swapSoComponent(componentId: string, actualItemId: string, reason: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("swap_so_line_component", {
    p_component_id: componentId,
    p_actual_item_id: actualItemId,
    p_reason: reason,
    p_swapped_by: await operatorId(),
  });
  if (error) throw new Error(errorText(error));
}

export async function assertKitLineReleasable(lineId: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("assert_kit_line_releasable", { p_line_id: lineId });
  if (error) throw new Error(errorText(error));
}
