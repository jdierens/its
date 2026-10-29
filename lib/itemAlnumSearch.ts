import type { SupabaseClient } from "@supabase/supabase-js";
import { errorText } from "@/lib/errors";
import { ITEM_ALNUM_COLUMNS, alnumSearchTerms, type ItemAlnumColumn } from "@/lib/itemAlnum";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RpcError = { code?: string; message?: string };

/**
 * True when the punctuation-insensitive lookup is not in this database yet.
 * Find then keeps its current contains search.
 */
export function alnumSearchUnavailable(error: RpcError | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (error.code === "PGRST202") return true;
  if (/item_ids_matching_alnum/i.test(message) && /schema cache|could not find the function|does not exist/i.test(message)) {
    return true;
  }
  if (error.code === "42883" && /item_ids_matching_alnum|normalize_alnum/i.test(message)) return true;
  if ((error.code === "42703" || /does not exist/i.test(message)) && /_alnum/i.test(message)) return true;
  return false;
}

function idsFromRpc(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object" || !("id" in row)) continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string" && UUID_PATTERN.test(id)) ids.push(id);
  }
  return ids;
}

/**
 * Item ids whose chosen text matches the query after punctuation is removed.
 * `|` is OR. Each alternative is its own call to `item_ids_matching_alnum`, which
 * still normalizes one needle and matches with `LIKE %needle%`. Empty until that
 * function exists. A real database error still throws.
 */
export async function itemIdsMatchingAlnum(
  supabase: SupabaseClient,
  query: string,
  options?: {
    columns?: readonly ItemAlnumColumn[];
    includeAttributes?: boolean;
    taxonomyId?: string | null;
    limit?: number;
  },
): Promise<string[]> {
  const terms = alnumSearchTerms(query.slice(0, 500));
  if (terms.length === 0) return [];
  const taxonomyId = options?.taxonomyId?.trim() || null;
  if (taxonomyId && !UUID_PATTERN.test(taxonomyId)) return [];
  const requested = options?.columns ?? ITEM_ALNUM_COLUMNS;
  const columns = requested.filter((column) => (ITEM_ALNUM_COLUMNS as readonly string[]).includes(column));
  if (columns.length === 0 && options?.includeAttributes !== true) return [];
  const limit = Math.max(1, Math.min(options?.limit ?? 200, 1000));
  const includeAttributes = options?.includeAttributes === true;
  const lists = await Promise.all(
    terms.map((term) => itemIdsMatchingAlnumTerm(supabase, term, columns, includeAttributes, taxonomyId, limit)),
  );
  return unionLimited(lists, limit);
}

async function itemIdsMatchingAlnumTerm(
  supabase: SupabaseClient,
  term: string,
  columns: readonly ItemAlnumColumn[],
  includeAttributes: boolean,
  taxonomyId: string | null,
  limit: number,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("item_ids_matching_alnum", {
    p_query: term.slice(0, 500),
    p_columns: columns,
    p_include_attributes: includeAttributes,
    p_taxonomy_id: taxonomyId,
    p_limit: limit,
  });
  if (error) {
    if (alnumSearchUnavailable(error)) return [];
    throw new Error(errorText(error));
  }
  return idsFromRpc(data);
}

/** Ids from each alternative, interleaved so a long first term cannot fill the limit alone. */
function unionLimited(lists: readonly string[][], limit: number): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const max = lists.reduce((longest, list) => Math.max(longest, list.length), 0);
  for (let index = 0; index < max && ids.length < limit; index += 1) {
    for (const list of lists) {
      const id = list[index];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= limit) break;
    }
  }
  return ids;
}
