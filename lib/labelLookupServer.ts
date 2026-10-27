"use server";

import { errorText } from "@/lib/errors";
import { itemIdsMatchingListQuery } from "@/lib/itemListSearch";
import { findItemForLabel } from "@/lib/items";
import {
  escapeLike,
  labelTaxonomyFields,
  LABEL_RESULT_CAP,
  sortLabelMatches,
  type LabelLookupResult,
} from "@/lib/labelLookup";
import { getSupabase } from "@/lib/supabase";
import type { LabelItem } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, sku, name, description, coo, taxonomies(short_code, long_code, name)";

type Row = {
  id: string;
  sku: string | null;
  name: string | null;
  description: string | null;
  coo: string | null;
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
    coo: row.coo?.trim() || null,
  };
}

const ID_CHUNK = 100;

async function labelRowsById(supabase: SupabaseClient, ids: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let start = 0; start < ids.length; start += ID_CHUNK * 5) {
    const batches: string[][] = [];
    for (let offset = start; offset < ids.length && batches.length < 5; offset += ID_CHUNK) {
      batches.push(ids.slice(offset, offset + ID_CHUNK));
    }
    const results = await Promise.all(batches.map((chunk) => supabase.from("items").select(COLUMNS).in("id", chunk)));
    for (const result of results) {
      if (result.error) throw new Error(errorText(result.error));
      rows.push(...((result.data ?? []) as unknown as Row[]));
    }
  }
  return rows;
}

export async function searchItemsForLabel(raw: string): Promise<LabelLookupResult> {
  const query = raw.trim().slice(0, 200);
  if (!query) return { exact: null, matches: [], truncated: false };

  if (UUID_PATTERN.test(query)) {
    const exact = await findItemForLabel(query);
    return { exact, matches: exact ? [exact] : [], truncated: false };
  }

  const supabase = await getSupabase();
  const [exactQuery, matchedIds] = await Promise.all([
    supabase.from("items").select(COLUMNS).ilike("sku", escapeLike(query)).limit(5),
    itemIdsMatchingListQuery(supabase, query),
  ]);
  if (exactQuery.error) throw new Error(errorText(exactQuery.error));
  const exactRow = ((exactQuery.data ?? []) as unknown as Row[]).find(
    (row) => (row.sku ?? "").trim().toLowerCase() === query.toLowerCase(),
  );

  const ids: string[] = [];
  const seen = new Set<string>();
  if (exactRow && !seen.has(exactRow.id)) {
    seen.add(exactRow.id);
    ids.push(exactRow.id);
  }
  for (const id of matchedIds ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  const rows = await labelRowsById(supabase, ids);
  const matches = sortLabelMatches(rows.map(toHit), query).slice(0, LABEL_RESULT_CAP);
  return {
    exact: exactRow ? toHit(exactRow) : null,
    matches,
    truncated: ids.length > LABEL_RESULT_CAP,
  };
}
