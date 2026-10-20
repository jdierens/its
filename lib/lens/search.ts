import { getSupabase } from "@/lib/supabase";
import type { LensCandidate } from "@/lib/lens/rank";

type CandidateRow = {
  id: string;
  sku: string | null;
  name: string | null;
  part_number: string | null;
  oem_part_number: string | null;
  model: string | null;
  manufacturer_name: string | null;
  taxonomy_name: string | null;
  spec_code: string | null;
  quantity: number | null;
  sku_similarity: number | null;
  part_similarity: number | null;
  oem_similarity: number | null;
  model_similarity: number | null;
  spec_similarity: number | null;
};

export async function findLensCandidates(needles: string[]): Promise<LensCandidate[]> {
  if (needles.length === 0) return [];
  const { data, error } = await (await getSupabase()).rpc("lens_item_candidates", { p_needles: needles });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CandidateRow[]).map(toCandidate);
}

async function loadTaxonomyNames(): Promise<string[]> {
  const { data, error } = await (await getSupabase()).from("taxonomies").select("name").order("sort_order");
  if (error) return [];
  return (data ?? [])
    .map((row) => (typeof row.name === "string" ? row.name.trim() : ""))
    .filter(Boolean);
}

export { loadTaxonomyNames };

function toCandidate(row: CandidateRow): LensCandidate {
  return {
    id: row.id,
    sku: row.sku ?? "",
    name: row.name ?? "",
    partNumber: row.part_number ?? "",
    oemPartNumber: row.oem_part_number ?? "",
    model: row.model ?? "",
    manufacturerName: row.manufacturer_name ?? "",
    taxonomyName: row.taxonomy_name ?? "",
    specCode: row.spec_code ?? "",
    quantity: typeof row.quantity === "number" ? row.quantity : null,
    skuSimilarity: numberOrZero(row.sku_similarity),
    partSimilarity: numberOrZero(row.part_similarity),
    oemSimilarity: numberOrZero(row.oem_similarity),
    modelSimilarity: numberOrZero(row.model_similarity),
    specSimilarity: numberOrZero(row.spec_similarity),
  };
}

function numberOrZero(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
