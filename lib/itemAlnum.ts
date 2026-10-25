/**
 * Punctuation-insensitive item text.
 * `public.normalize_alnum` in supabase/migrations/20261025230000_item_alnum_search.sql
 * must stay the same rule: keep A–Z, a–z, and 0–9, then compare case-insensitively.
 * A stored value contained in the query has to keep at least 3 letters or digits,
 * the same floor as a Find SKU longest word.
 */

export const ITEM_ALNUM_COLUMNS = [
  "sku",
  "name",
  "description",
  "model",
  "part_number",
  "oem_name",
  "oem_part_number",
  "product_url",
] as const;

export type ItemAlnumColumn = (typeof ITEM_ALNUM_COLUMNS)[number];

/** Shortest stored value that may match by sitting inside a longer query. */
export const ALNUM_CONTAINED_MIN = 3;

/** Letters and digits only, lowercased. Hyphens, slashes, underscores, and spaces drop out. */
export function normalizeAlnum(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The normalized field contains the normalized query. */
export function alnumFieldContains(field: string, query: string): boolean {
  const hay = normalizeAlnum(field);
  const needle = normalizeAlnum(query);
  return needle.length >= ALNUM_CONTAINED_MIN && hay.includes(needle);
}

/**
 * The normalized query contains the normalized field, and the field is shorter.
 * Equal strings are handled by `alnumFieldContains`.
 */
export function alnumQueryContains(field: string, query: string): boolean {
  const hay = normalizeAlnum(field);
  const needle = normalizeAlnum(query);
  return hay.length >= ALNUM_CONTAINED_MIN && hay.length < needle.length && needle.includes(hay);
}

/** Either normalized string contains the other. */
export function alnumContains(field: string, query: string): boolean {
  return alnumFieldContains(field, query) || alnumQueryContains(field, query);
}
