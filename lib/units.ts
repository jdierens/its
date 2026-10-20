import { errorText } from "@/lib/errors";
import { SEEDED_UNITS } from "@/lib/itemFields";
import { getSupabase } from "@/lib/supabase";

export async function fetchUnits(): Promise<string[]> {
  const { data, error } = await (await getSupabase()).from("units").select("name").order("sort_order");
  if (error) throw new Error(errorText(error));
  const names = (data ?? [])
    .map((row) => String(row.name ?? "").trim())
    .filter((name) => name.length > 0);
  return names.length > 0 ? names : [...SEEDED_UNITS];
}
