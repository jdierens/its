export const ITEM_SEARCH_PAGE_SIZE = 50;
export const PART_NOT_FOUND = "Part number not found. Pick a taxonomy to search by fields.";

const NUMBER_VALUE = /^-?[0-9]+(\.[0-9]+)?$/;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SearchMode = "taxonomy" | "part";

export type ParsedAttributeSearch = {
  mode: SearchMode;
  tax: string;
  part: string;
  exclude: string;
  seeded: boolean;
  page: number;
  lists: Record<string, string[]>;
  ranges: Record<string, { min: string; max: string }>;
  seed: Record<string, string>;
};

export type SearchField = {
  id: string;
  name: string;
  dataType: "integer" | "decimal" | "text";
  usesList: boolean;
};

export type StoredAttribute = {
  attributeId: string;
  value: string;
};

export type AttributeFilters = {
  lists: Record<string, string[]>;
  ranges: Record<string, { min: string | null; max: string | null }>;
  seed: Record<string, string>;
  excludeId: string | null;
};

const MONEY_KEYS = new Set([
  "ecommerce_price",
  "ecommerce_price_updated_at",
  "market_price",
  "market_price_updated_at",
  "msrp",
  "msrp_updated_at",
  "pricing_checked_at",
  "price",
  "unit_price",
  "shipping",
  "ecommercePrice",
  "marketPrice",
  "msrp",
]);

/** Uppercase, then drop whitespace, slashes, and dashes. Same rule as price_quotes.part_number_norm. */
export function normalizePartNumber(value: string): string {
  return value.toUpperCase().replace(/[\s/-]/g, "");
}

export function attributeValuesEqual(stored: string, wanted: string): boolean {
  const left = stored.trim();
  const right = wanted.trim();
  if (left.toLowerCase() === right.toLowerCase()) return true;
  if (!NUMBER_VALUE.test(left) || !NUMBER_VALUE.test(right)) return false;
  return Number(left) === Number(right);
}

export function valueInRange(stored: string, min: string | null, max: string | null): boolean {
  const text = stored.trim();
  if (!NUMBER_VALUE.test(text)) return false;
  const number = Number(text);
  if (min && NUMBER_VALUE.test(min) && number < Number(min)) return false;
  if (max && NUMBER_VALUE.test(max) && number > Number(max)) return false;
  return Boolean((min && NUMBER_VALUE.test(min)) || (max && NUMBER_VALUE.test(max)));
}

export function parseAttributeSearchParams(params: URLSearchParams): ParsedAttributeSearch {
  const mode = params.get("mode") === "part" ? "part" : "taxonomy";
  const lists: Record<string, string[]> = {};
  const ranges: Record<string, { min: string; max: string }> = {};
  const seed: Record<string, string> = {};
  for (const [key, raw] of params.entries()) {
    const value = raw.trim();
    if (!value) continue;
    if (key.startsWith("attr.")) {
      const name = key.slice("attr.".length);
      if (!name) continue;
      lists[name] = [...(lists[name] ?? []), value];
    } else if (key.startsWith("min.")) {
      const name = key.slice("min.".length);
      ranges[name] = { min: value, max: ranges[name]?.max ?? "" };
    } else if (key.startsWith("max.")) {
      const name = key.slice("max.".length);
      ranges[name] = { min: ranges[name]?.min ?? "", max: value };
    } else if (key.startsWith("seed.")) {
      const name = key.slice("seed.".length);
      if (name) seed[name] = value;
    }
  }
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  return {
    mode,
    tax: (params.get("tax") ?? "").trim().toUpperCase(),
    part: (params.get("part") ?? "").trim(),
    exclude: (params.get("exclude") ?? "").trim(),
    seeded: params.get("seeded") === "1",
    page: Number.isFinite(page) ? page : 1,
    lists,
    ranges,
    seed,
  };
}

export function filtersFromFields(fields: SearchField[], parsed: ParsedAttributeSearch): AttributeFilters {
  const lists: Record<string, string[]> = {};
  const ranges: Record<string, { min: string | null; max: string | null }> = {};
  const seed: Record<string, string> = {};
  for (const [name, values] of Object.entries(parsed.lists)) {
    const field = fields.find((entry) => entry.name === name && entry.usesList);
    if (!field || values.length === 0) continue;
    lists[field.id] = values;
  }
  for (const [name, span] of Object.entries(parsed.ranges)) {
    const field = fields.find(
      (entry) => entry.name === name && !entry.usesList && (entry.dataType === "integer" || entry.dataType === "decimal"),
    );
    if (!field || (!span.min && !span.max)) continue;
    ranges[field.id] = { min: span.min || null, max: span.max || null };
  }
  for (const [name, value] of Object.entries(parsed.seed)) {
    const field = fields.find((entry) => entry.name === name);
    if (!field || !value) continue;
    seed[field.id] = value;
  }
  return {
    lists,
    ranges,
    seed,
    excludeId: UUID_VALUE.test(parsed.exclude) ? parsed.exclude : null,
  };
}

export function itemMatchesFilters(attributes: StoredAttribute[], filters: AttributeFilters): boolean {
  for (const [attributeId, values] of Object.entries(filters.lists)) {
    if (values.length === 0) continue;
    const stored = attributes.filter((row) => row.attributeId === attributeId);
    const hit = stored.some((row) => values.some((value) => attributeValuesEqual(row.value, value)));
    if (!hit) return false;
  }
  for (const [attributeId, span] of Object.entries(filters.ranges)) {
    if (!span.min && !span.max) continue;
    const stored = attributes.find((row) => row.attributeId === attributeId);
    if (!stored || !valueInRange(stored.value, span.min, span.max)) return false;
  }
  return true;
}

export function seedMatchCount(attributes: StoredAttribute[], seed: Record<string, string>): number {
  let count = 0;
  for (const [attributeId, value] of Object.entries(seed)) {
    const stored = attributes.find((row) => row.attributeId === attributeId);
    if (stored && attributeValuesEqual(stored.value, value)) count += 1;
  }
  return count;
}

export function matchBadge(matchCount: number, seedCount: number): string | null {
  if (seedCount <= 0) return null;
  return `matches ${matchCount} of ${seedCount} fields`;
}

export function stripMoneyFields<T extends Record<string, unknown>>(row: T, canViewFinancials: boolean): T {
  if (canViewFinancials) return row;
  const copy = { ...row };
  for (const key of Object.keys(copy)) {
    if (MONEY_KEYS.has(key)) delete copy[key];
  }
  return copy;
}

export function missingSearchFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return error.code === "PGRST202" || /could not find the function|schema cache/i.test(message);
}

export type SearchItem = {
  id: string;
  sku: string;
  name: string;
  manufacturer: string;
  partNumber: string;
  quantity: number | null;
  matchCount: number;
  seedCount: number;
};

export type SearchOption = {
  value: string;
  sortOrder: number | null;
  count: number;
};

export type SearchFieldView = {
  id: string;
  name: string;
  label: string;
  dataType: SearchField["dataType"];
  usesList: boolean;
  options: SearchOption[];
};

export type AttributeSearchResponse = {
  taxonomies: { id: string; name: string; shortCode: string }[];
  taxonomyId: string | null;
  fields: SearchFieldView[];
  items: SearchItem[];
  total: number;
  page: number;
  pageSize: number;
  message: string | null;
  suggested: Record<string, string | string[]> | null;
};

export function clearSearchFilters(params: URLSearchParams): void {
  for (const key of [...params.keys()]) {
    if (
      key.startsWith("attr.") ||
      key.startsWith("min.") ||
      key.startsWith("max.") ||
      key.startsWith("seed.") ||
      key === "exclude" ||
      key === "seeded" ||
      key === "part" ||
      key === "page"
    ) {
      params.delete(key);
    }
  }
}
