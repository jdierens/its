import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

export type Country = {
  alpha3: string;
  alpha2: string;
  name: string;
};

export async function fetchCountries(): Promise<Country[]> {
  const { data, error } = await (await getSupabase())
    .from("countries")
    .select("alpha3, alpha2, name")
    .order("name");
  if (error) throw new Error(errorText(error));
  return (data ?? []).map((row) => ({
    alpha3: String(row.alpha3),
    alpha2: String(row.alpha2),
    name: String(row.name),
  }));
}
