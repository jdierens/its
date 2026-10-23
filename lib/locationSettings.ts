"use server";

import { errorText } from "@/lib/errors";
import { assertStockAdmin, stockSettingsWritable } from "@/lib/stockAccess";
import { isBinType, type BinType } from "@/lib/bins";
import { getSupabase } from "@/lib/supabase";

export type LocationTypeRow = {
  id: string;
  slug: string;
  name: string;
  prefix: string;
  pattern: string;
};

export type LocationRow = {
  id: string;
  code: string;
  typeName: string;
  prefix: string;
};

export type PutawaySetting = {
  canEdit: boolean;
  types: LocationTypeRow[];
  locations: LocationRow[];
  defaults: Record<BinType, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function fetchPutawaySetting(): Promise<PutawaySetting> {
  const supabase = await getSupabase();
  const [types, locations, defaults, canEdit] = await Promise.all([
    supabase.from("location_types").select("id, slug, name, prefix, pattern").order("prefix"),
    supabase
      .from("locations")
      .select("id, code, location_types(name, prefix)")
      .order("code"),
    supabase.from("bin_default_locations").select("bin_type, location_id"),
    stockSettingsWritable(),
  ]);
  if (types.error) throw new Error(errorText(types.error));
  if (locations.error) throw new Error(errorText(locations.error));
  if (defaults.error) throw new Error(errorText(defaults.error));

  const locationRows: LocationRow[] = (locations.data ?? []).filter(isRecord).map((row) => {
    const type = row.location_types;
    const typeRow = Array.isArray(type) ? type[0] : type;
    const info: Record<string, unknown> = isRecord(typeRow) ? typeRow : {};
    return {
      id: String(row.id),
      code: String(row.code),
      typeName: String(info.name ?? ""),
      prefix: String(info.prefix ?? ""),
    };
  });
  const byType: Record<BinType, string> = { B: "", C: "", P: "" };
  for (const row of defaults.data ?? []) {
    if (!isRecord(row) || !isBinType(String(row.bin_type))) continue;
    byType[String(row.bin_type) as BinType] = String(row.location_id ?? "");
  }
  return {
    canEdit,
    types: (types.data ?? []).filter(isRecord).map((row) => ({
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      prefix: String(row.prefix),
      pattern: String(row.pattern),
    })),
    locations: locationRows,
    defaults: byType,
  };
}

export async function savePutawayDefaults(defaults: Record<BinType, string>): Promise<void> {
  await assertStockAdmin();
  const { error } = await (await getSupabase()).rpc("set_bin_default_locations", {
    p_box: defaults.B,
    p_crate: defaults.C,
    p_pallet: defaults.P,
  });
  if (error) throw new Error(errorText(error));
}

export async function createLocationType(input: {
  name: string;
  prefix: string;
  pattern: string;
}): Promise<void> {
  await assertStockAdmin();
  const { error } = await (await getSupabase()).rpc("add_location_type", {
    p_name: input.name,
    p_prefix: input.prefix,
    p_pattern: input.pattern,
  });
  if (error) throw new Error(errorText(error));
}

export async function createLocation(code: string): Promise<void> {
  await assertStockAdmin();
  const { error } = await (await getSupabase()).rpc("add_location", { p_code: code });
  if (error) throw new Error(errorText(error));
}
