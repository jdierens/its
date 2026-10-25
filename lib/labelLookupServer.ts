"use server";

import { errorText } from "@/lib/errors";
import { findItemForLabel } from "@/lib/items";
import {
  escapeLike,
  labelLikeOr,
  labelTaxonomyFields,
  LABEL_RESULT_CAP,
  sortLabelMatches,
  type LabelLookupResult,
} from "@/lib/labelLookup";
import { getSupabase } from "@/lib/supabase";
import type { LabelItem } from "@/lib/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, sku, name, description, taxonomies(short_code, long_code, name)";

type Row = {
  id: string;
  sku: string | null;
  name: string | null;
  description: string | null;
  taxonomies: unknown;
};

function toHit(row: Row): LabelItem {
  const taxonomy = labelTaxonomyFields(row.taxonomies);
  return {
    id: row.id,
    sku: row.sku?.trim() ?? "",
    name: row.name?.trim() ?? "",
    description: row.description ?? "",
    shortCode: taxonomy.shortCode,
    longCode: taxonomy.longCode,
    taxonomyName: taxonomy.taxonomyName,
  };
}

export async function searchItemsForLabel(raw: string): Promise<LabelLookupResult> {
  const query = raw.trim().slice(0, 200);
  if (!query) return { exact: null, matches: [], truncated: false };

  if (UUID_PATTERN.test(query)) {
    const exact = await findItemForLabel(query);
    return { exact, matches: exact ? [exact] : [], truncated: false };
  }

  const supabase = await getSupabase();
  const exactQuery = await supabase.from("items").select(COLUMNS).ilike("sku", escapeLike(query)).limit(5);
  if (exactQuery.error) throw new Error(errorText(exactQuery.error));
  const exactRow = ((exactQuery.data ?? []) as unknown as Row[]).find(
    (row) => (row.sku ?? "").trim().toLowerCase() === query.toLowerCase(),
  );

  const listed = await supabase
    .from("items")
    .select(COLUMNS)
    .or(labelLikeOr(query))
    .order("sku")
    .limit(LABEL_RESULT_CAP + 1);
  if (listed.error) throw new Error(errorText(listed.error));

  const rows = (listed.data ?? []) as unknown as Row[];
  const matches = sortLabelMatches(rows.map(toHit), query);
  return {
    exact: exactRow ? toHit(exactRow) : null,
    matches: matches.slice(0, LABEL_RESULT_CAP),
    truncated: rows.length > LABEL_RESULT_CAP,
  };
}
