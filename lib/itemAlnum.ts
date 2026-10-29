/**
 * Punctuation-insensitive item text.
 * `public.normalize_alnum` in supabase/migrations/20261025230000_item_alnum_search.sql
 * must stay the same rule: keep A–Z, a–z, and 0–9, then compare case-insensitively.
 * A stored value contained in the query has to keep at least 3 letters or digits,
 * the same floor as a Find SKU longest word.
 * A digits-only attribute does not match that way. `96.0` is not a hit inside a part number.
 * A `|` in the query is OR. Each alternative is normalized on its own.
 * `7060DX5|7060PX5` matches either model. Spaces around the pipe, and empty
 * segments from a leading, trailing, or doubled pipe, are ignored.
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

/**
 * Pieces of a search query separated by `|`.
 * Blank pieces from extra pipes are dropped. Spaces beside a pipe are trimmed.
 */
export function alnumQueryAlternatives(query: string): string[] {
  return query
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Alternatives long enough for a punctuation-insensitive contains match. Identical needles are kept once. */
export function alnumSearchTerms(query: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const term of alnumQueryAlternatives(query)) {
    const needle = normalizeAlnum(term);
    if (needle.length < ALNUM_CONTAINED_MIN || seen.has(needle)) continue;
    seen.add(needle);
    terms.push(term);
  }
  return terms;
}

function alnumFieldContainsTerm(field: string, query: string): boolean {
  const hay = normalizeAlnum(field);
  const needle = normalizeAlnum(query);
  return needle.length >= ALNUM_CONTAINED_MIN && hay.includes(needle);
}

/**
 * The normalized query contains the normalized field, and the field is shorter.
 * Equal strings are handled by `alnumFieldContainsTerm`.
 */
function alnumQueryContainsTerm(field: string, query: string): boolean {
  const hay = normalizeAlnum(field);
  const needle = normalizeAlnum(query);
  return hay.length >= ALNUM_CONTAINED_MIN && hay.length < needle.length && needle.includes(hay);
}

/** The normalized field contains any alternative. A query with no `|` is one term. */
export function alnumFieldContains(field: string, query: string): boolean {
  return alnumQueryAlternatives(query).some((term) => alnumFieldContainsTerm(field, term));
}

/**
 * Any alternative contains the normalized field, and the field is shorter than that alternative.
 * Equal strings are handled by `alnumFieldContains`.
 */
export function alnumQueryContains(field: string, query: string): boolean {
  return alnumQueryAlternatives(query).some((term) => alnumQueryContainsTerm(field, term));
}

/** True when the normalized value is digits and nothing else. `96.0` and `0.96` are. */
export function alnumDigitsOnly(value: string): boolean {
  const normalized = normalizeAlnum(value);
  return normalized.length > 0 && /^[0-9]+$/.test(normalized);
}

/**
 * Reverse match for an attribute value.
 * A digits-only value is a capacity or a count, so it does not sit inside a longer query.
 * A value with a letter still can. Forward search uses `alnumFieldContains`.
 */
export function attributeAlnumQueryContains(field: string, query: string): boolean {
  if (alnumDigitsOnly(field)) return false;
  return alnumQueryContains(field, query);
}

/** Either normalized string contains the other. */
export function alnumContains(field: string, query: string): boolean {
  return alnumFieldContains(field, query) || alnumQueryContains(field, query);
}
