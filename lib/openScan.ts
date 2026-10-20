import { errorText } from "@/lib/errors";
import { binPath, parseScan } from "@/lib/scan";
import { getSupabase } from "@/lib/supabase";

export async function openScan(raw: string): Promise<string> {
  const parsed = parseScan(raw);
  if (!parsed) throw new Error("That code is not an item or a bin.");
  if (parsed.kind === "item") return `/items/${parsed.id}`;
  if (parsed.kind === "bin") return binPath(parsed.reference);

  const supabase = getSupabase();
  const sku = parsed.sku;
  const query = supabase.from("items").select("id").limit(2);
  const listed =
    sku.includes("%") || sku.includes("_")
      ? await query.eq("sku", sku)
      : await query.ilike("sku", sku);
  if (listed.error) throw new Error(errorText(listed.error));
  const rows = listed.data ?? [];
  if (rows.length === 0) throw new Error(`No item with SKU ${sku}.`);
  if (rows.length > 1) throw new Error(`More than one item matches SKU ${sku}.`);
  return `/items/${rows[0].id}`;
}
