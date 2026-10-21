"use server";

import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

export type ManufacturerAlias = {
  id: string;
  alias: string;
};

export type ManufacturerRecord = {
  id: string;
  name: string;
  aliases: ManufacturerAlias[];
  itemCount: number;
};

export type ManufacturerSuggestion = {
  id: string;
  name: string;
  matched: string;
  score: number;
};

type AliasRow = { id: string; alias: string };
type MakerRow = {
  id: string;
  name: string;
  manufacturer_aliases: AliasRow[] | null;
};

export async function fetchManufacturerChoices(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await (await getSupabase()).from("manufacturers").select("id, name").order("name");
  if (error) throw new Error(errorText(error));
  return (data ?? []).map((row) => ({ id: String(row.id), name: String(row.name) }));
}

export async function fetchManufacturers(): Promise<ManufacturerRecord[]> {
  const supabase = await getSupabase();
  const [listed, counted] = await Promise.all([
    supabase
      .from("manufacturers")
      .select("id, name, manufacturer_aliases(id, alias)")
      .order("name"),
    supabase.from("items").select("manufacturer_id").not("manufacturer_id", "is", null),
  ]);
  if (listed.error) throw new Error(errorText(listed.error));
  if (counted.error) throw new Error(errorText(counted.error));

  const counts = new Map<string, number>();
  for (const row of counted.data ?? []) {
    const id = row.manufacturer_id;
    if (typeof id !== "string") continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return ((listed.data ?? []) as MakerRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    aliases: (row.manufacturer_aliases ?? [])
      .slice()
      .sort((a, b) => a.alias.localeCompare(b.alias)),
    itemCount: counts.get(row.id) ?? 0,
  }));
}

export async function suggestManufacturers(query: string): Promise<ManufacturerSuggestion[]> {
  const trimmed = query.trim();
  const supabase = await getSupabase();
  if (!trimmed) {
    const { data, error } = await supabase.from("manufacturers").select("id, name").order("name").limit(8);
    if (error) throw new Error(errorText(error));
    return (data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      matched: String(row.name),
      score: 1,
    }));
  }

  const { data, error } = await supabase.rpc("suggest_manufacturers", { p_query: trimmed });
  if (error) throw new Error(errorText(error));
  return ((data ?? []) as { id: string; name: string; matched: string; score: number }[]).map((row) => ({
    id: row.id,
    name: row.name,
    matched: row.matched,
    score: Number(row.score),
  }));
}

export async function createManufacturer(name: string): Promise<{ id: string; name: string }> {
  const supabase = await getSupabase();
  const created = await supabase.rpc("create_manufacturer", { p_name: name });
  if (created.error) throw new Error(errorText(created.error));
  if (typeof created.data !== "string") throw new Error("Manufacturer was not saved.");
  const named = await supabase.from("manufacturers").select("name").eq("id", created.data).single();
  if (named.error) throw new Error(errorText(named.error));
  return { id: created.data, name: String(named.data.name) };
}

export async function renameManufacturer(id: string, name: string): Promise<void> {
  const { error } = await (await getSupabase()).rpc("rename_manufacturer", { p_id: id, p_name: name });
  if (error) throw new Error(errorText(error));
}

export async function addManufacturerAlias(manufacturerId: string, alias: string): Promise<void> {
  const { error } = await (await getSupabase()).rpc("add_manufacturer_alias", {
    p_manufacturer_id: manufacturerId,
    p_alias: alias,
  });
  if (error) throw new Error(errorText(error));
}

export async function removeManufacturerAlias(id: string): Promise<void> {
  const { error } = await (await getSupabase()).rpc("remove_manufacturer_alias", { p_id: id });
  if (error) throw new Error(errorText(error));
}

export async function mergeManufacturers(keepId: string, dropId: string): Promise<void> {
  const { error } = await (await getSupabase()).rpc("merge_manufacturers", { p_keep: keepId, p_drop: dropId });
  if (error) throw new Error(errorText(error));
}
