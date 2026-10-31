import { alnumFieldContains, alnumQueryContains } from "@/lib/itemAlnum";
import type { LabelItem } from "@/lib/types";

export const LABEL_RESULT_CAP = 25;

/** How many label matches to return. A missing or invalid cap stays at 25. */
export function labelMatchLimit(cap?: number): number {
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap < 1) return LABEL_RESULT_CAP;
  return Math.floor(cap);
}

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

export function labelTaxonomyFields(value: unknown): {
  shortCode: string | null;
  longCode: string | null;
  taxonomyName: string | null;
} {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return { shortCode: null, longCode: null, taxonomyName: null };
  const record = row as Record<string, unknown>;
  const short = String(record.short_code ?? "").trim().toUpperCase();
  const long = String(record.long_code ?? "").trim().toUpperCase();
  const name = String(record.name ?? "").trim();
  return {
    shortCode: short || null,
    longCode: long || null,
    taxonomyName: name || null,
  };
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
    if (needle && sku === needle) return 0;
    if (needle && (sku.includes(needle) || alnumFieldContains(item.sku, query))) return 1;
    if (needle && (name.includes(needle) || alnumFieldContains(item.name, query))) return 2;
    if (alnumQueryContains(item.sku, query)) return 3;
    if (alnumQueryContains(item.name, query)) return 4;
    return 5;
  };
  return matches.slice().sort((a, b) => rank(a) - rank(b) || a.sku.localeCompare(b.sku, undefined, { numeric: true }));
}

/**
 * An exact SKU selects immediately. A typed prefix does not, even when one row matches.
 * Enter selects only when the search comes back with a single row.
 * Receiving can select that single row without Enter.
 */
/** Enter applies the result. A live search applies only while the field still shows that query. */
export function labelResultApplies(typed: string, query: string, submitted: boolean): boolean {
  if (submitted) return true;
  return typed.trim() === query;
}

export function labelLookupChoice(input: {
  submitted: boolean;
  exact: boolean;
  matchCount: number;
  truncated: boolean;
  loneSelects?: boolean;
}): LabelLookupChoice {
  if (input.exact) return "select";
  if (input.matchCount === 0) return "empty";
  if ((input.submitted || input.loneSelects) && input.matchCount === 1 && !input.truncated) return "select";
  return "list";
}
