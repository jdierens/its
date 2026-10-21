import type { LabelItem } from "@/lib/types";

export const LABEL_RESULT_CAP = 25;

export type LabelLookupResult = {
  exact: LabelItem | null;
  matches: LabelItem[];
  truncated: boolean;
};

export type LabelLookupChoice = "select" | "list" | "empty";

/** LIKE wildcards and the escape character itself. */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** PostgREST `or` filter. The pattern is quoted so commas in the query stay in one value. */
export function labelLikeOr(query: string): string {
  const pattern = `%${escapeLike(query)}%`;
  const quoted = `"${pattern.replace(/"/g, '""')}"`;
  return ["sku", "name", "description"].map((column) => `${column}.ilike.${quoted}`).join(",");
}

export function descriptionSnippet(value: string, max = 80): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function sortLabelMatches(matches: readonly LabelItem[], query: string): LabelItem[] {
  const needle = query.trim().toLowerCase();
  const rank = (item: LabelItem) => {
    const sku = item.sku.toLowerCase();
    const name = item.name.toLowerCase();
    if (sku === needle) return 0;
    if (needle && sku.includes(needle)) return 1;
    if (needle && name.includes(needle)) return 2;
    return 3;
  };
  return matches.slice().sort((a, b) => rank(a) - rank(b) || a.sku.localeCompare(b.sku, undefined, { numeric: true }));
}

/**
 * An exact SKU selects immediately. A typed prefix does not, even when one row matches.
 * Enter selects only when the search comes back with a single row.
 */
export function labelLookupChoice(input: {
  submitted: boolean;
  exact: boolean;
  matchCount: number;
  truncated: boolean;
}): LabelLookupChoice {
  if (input.exact) return "select";
  if (input.matchCount === 0) return "empty";
  if (input.submitted && input.matchCount === 1 && !input.truncated) return "select";
  return "list";
}
