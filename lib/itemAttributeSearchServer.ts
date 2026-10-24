import type { SupabaseClient } from "@supabase/supabase-js";
import { readAppUser } from "@/lib/appUserRecord";
import { authRequired } from "@/lib/authRequired";
import { canViewFinancials } from "@/lib/export/access";
import { errorText } from "@/lib/errors";
import {
  ITEM_SEARCH_PAGE_SIZE,
  PART_NOT_FOUND,
  filtersFromFields,
  itemMatchesFilters,
  missingSearchFunction,
  normalizePartNumber,
  seedMatchCount,
  type AttributeFilters,
  type AttributeSearchResponse,
  type ParsedAttributeSearch,
  type SearchField,
  type SearchFieldView,
  type SearchItem,
  type SearchOption,
  type StoredAttribute,
} from "@/lib/itemAttributeSearch";
import { sessionUser } from "@/lib/sessionUser";
import { getSupabase } from "@/lib/supabase";

export class ItemSearchDenied extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type ItemSearchAccess = {
  canViewFinancials: boolean;
};

type FieldRow = SearchField & {
  label: string | null;
  unit: string | null;
  sortOrder: number;
};

type TaxonomyRow = {
  id: string;
  name: string;
  shortCode: string;
  fields: FieldRow[];
};

type SeedHit = {
  source: "item" | "quote";
  itemId: string | null;
  taxonomyId: string;
  shortCode: string;
  taxonomyName: string;
  attributes: { name: string; value: string; usesList: boolean; dataType: FieldRow["dataType"] }[];
};

/** Approved session when sign-in is on. The open app, with sign-in off, uses the same gate as the items list. */
export async function itemSearchAccess(): Promise<ItemSearchAccess> {
  const session = await sessionUser();
  if (authRequired()) {
    if (!session) throw new ItemSearchDenied("Sign in required.", 401);
    const user = await readAppUser(session.id);
    if (!user || user.status !== "approved") throw new ItemSearchDenied("An approved account is required.", 403);
    return { canViewFinancials: canViewFinancials(user.role) };
  }
  if (!session) return { canViewFinancials: true };
  const user = await readAppUser(session.id);
  if (!user || user.status !== "approved") return { canViewFinancials: true };
  return { canViewFinancials: canViewFinancials(user.role) };
}

export async function runAttributeSearch(parsed: ParsedAttributeSearch): Promise<AttributeSearchResponse> {
  const supabase = await getSupabase();
  const taxonomies = await loadTaxonomies(supabase);
  let message: string | null = null;
  let suggested: Record<string, string | string[]> | null = null;
  let effective = parsed;

  if (parsed.mode === "part" && parsed.part && !parsed.seeded) {
    const seed = await findPartSeed(supabase, parsed.part);
    if (!seed) {
      message = PART_NOT_FOUND;
    } else {
      effective = applySeed(parsed, seed);
      suggested = suggestedParams(effective, seed);
      if (seed.source === "quote") {
        message = `No item has this part number. A price quote is filed under ${seed.taxonomyName}. Pick the fields to search.`;
      }
    }
  }

  const taxonomy = taxonomies.find((entry) => entry.shortCode === effective.tax) ?? null;
  const empty: AttributeSearchResponse = {
    taxonomies: taxonomies.map(summary),
    taxonomyId: taxonomy?.id ?? null,
    fields: (taxonomy?.fields ?? []).map((field) => ({ ...publicField(field), options: [] })),
    items: [],
    total: 0,
    page: effective.page,
    pageSize: ITEM_SEARCH_PAGE_SIZE,
    message,
    suggested,
  };
  if (!taxonomy) return empty;

  const filters = filtersFromFields(taxonomy.fields, effective);
  const result = await searchTaxonomy(supabase, taxonomy, filters, effective.page);
  return {
    ...empty,
    fields: result.fields,
    items: result.items,
    total: result.total,
  };
}

function summary(taxonomy: TaxonomyRow) {
  return { id: taxonomy.id, name: taxonomy.name, shortCode: taxonomy.shortCode };
}

function publicField(field: FieldRow): Omit<SearchFieldView, "options"> {
  return {
    id: field.id,
    name: field.name,
    label: field.unit ? `${field.name} (${field.unit})` : field.name,
    dataType: field.dataType,
    usesList: field.usesList,
  };
}

function applySeed(parsed: ParsedAttributeSearch, seed: SeedHit): ParsedAttributeSearch {
  const lists: Record<string, string[]> = {};
  const ranges: Record<string, { min: string; max: string }> = {};
  const seedValues: Record<string, string> = {};
  for (const attribute of seed.attributes) {
    if (!attribute.value.trim()) continue;
    seedValues[attribute.name] = attribute.value;
    if (attribute.usesList) lists[attribute.name] = [attribute.value];
    else if (attribute.dataType === "integer" || attribute.dataType === "decimal") {
      ranges[attribute.name] = { min: attribute.value, max: attribute.value };
    }
  }
  return {
    ...parsed,
    tax: seed.shortCode,
    exclude: seed.itemId ?? "",
    page: 1,
    lists,
    ranges,
    seed: seedValues,
  };
}

function suggestedParams(parsed: ParsedAttributeSearch, seed: SeedHit): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = { tax: seed.shortCode, seeded: "1" };
  if (seed.itemId) params.exclude = seed.itemId;
  for (const [name, values] of Object.entries(parsed.lists)) params[`attr.${name}`] = values;
  for (const [name, span] of Object.entries(parsed.ranges)) {
    if (span.min) params[`min.${name}`] = span.min;
    if (span.max) params[`max.${name}`] = span.max;
  }
  for (const [name, value] of Object.entries(parsed.seed)) params[`seed.${name}`] = value;
  return params;
}

async function searchTaxonomy(
  supabase: SupabaseClient,
  taxonomy: TaxonomyRow,
  filters: AttributeFilters,
  page: number,
): Promise<{ fields: SearchFieldView[]; items: SearchItem[]; total: number }> {
  const rpc = await searchWithFunctions(supabase, taxonomy, filters, page);
  if (rpc) return rpc;
  return searchInProcess(supabase, taxonomy, filters, page);
}

async function searchWithFunctions(
  supabase: SupabaseClient,
  taxonomy: TaxonomyRow,
  filters: AttributeFilters,
  page: number,
): Promise<{ fields: SearchFieldView[]; items: SearchItem[]; total: number } | null> {
  const payload = filterPayload(filters);
  const offset = (page - 1) * ITEM_SEARCH_PAGE_SIZE;
  const [listed, facets] = await Promise.all([
    supabase.rpc("search_items_by_attributes", {
      p_taxonomy_id: taxonomy.id,
      p_filters: payload,
      p_limit: ITEM_SEARCH_PAGE_SIZE,
      p_offset: offset,
    }),
    supabase.rpc("search_item_attribute_facets", {
      p_taxonomy_id: taxonomy.id,
      p_filters: payload,
    }),
  ]);
  if (missingSearchFunction(listed.error) || missingSearchFunction(facets.error)) return null;
  if (listed.error) throw new Error(listed.error.message);
  if (facets.error) throw new Error(facets.error.message);
  const rows = (listed.data ?? []) as Record<string, unknown>[];
  let total = rows.length > 0 ? numberValue(rows[0]?.total_count) : 0;
  if (rows.length === 0 && offset > 0) {
    const probe = await supabase.rpc("search_items_by_attributes", {
      p_taxonomy_id: taxonomy.id,
      p_filters: payload,
      p_limit: 1,
      p_offset: 0,
    });
    if (probe.error) throw new Error(probe.error.message);
    const probeRows = (probe.data ?? []) as Record<string, unknown>[];
    total = probeRows.length > 0 ? numberValue(probeRows[0]?.total_count) : 0;
  }
  return {
    items: rows.map(itemFromRpc),
    total,
    fields: fieldsWithFacetRows(taxonomy.fields, (facets.data ?? []) as Record<string, unknown>[]),
  };
}

function filterPayload(filters: AttributeFilters) {
  return {
    lists: filters.lists,
    ranges: filters.ranges,
    seed: filters.seed,
    exclude_id: filters.excludeId,
  };
}

function itemFromRpc(row: Record<string, unknown>): SearchItem {
  return {
    id: String(row.id ?? ""),
    sku: text(row.sku),
    name: text(row.name),
    manufacturer: text(row.manufacturer_name),
    partNumber: text(row.part_number),
    quantity: row.quantity == null || row.quantity === "" ? null : numberValue(row.quantity),
    matchCount: numberValue(row.match_count),
    seedCount: numberValue(row.seed_count),
  };
}

function fieldsWithFacetRows(fields: FieldRow[], rows: Record<string, unknown>[]): SearchFieldView[] {
  return fields.map((field) => {
    if (!field.usesList) return { ...publicField(field), options: [] };
    const options = rows
      .filter((row) => String(row.attribute_id) === field.id)
      .map((row) => ({
        value: text(row.value),
        sortOrder: row.sort_order == null ? null : numberValue(row.sort_order),
        count: numberValue(row.item_count),
      }))
      .sort(compareOptions);
    return { ...publicField(field), options };
  });
}

async function searchInProcess(
  supabase: SupabaseClient,
  taxonomy: TaxonomyRow,
  filters: AttributeFilters,
  page: number,
): Promise<{ fields: SearchFieldView[]; items: SearchItem[]; total: number }> {
  const items = await loadTaxonomyItems(supabase, taxonomy.id);
  const attributes = await loadAttributes(supabase, items.map((item) => item.id));
  const byItem = groupAttributes(attributes);
  const kept = items.filter((item) => {
    if (filters.excludeId && item.id === filters.excludeId) return false;
    return itemMatchesFilters(byItem.get(item.id) ?? [], filters);
  });
  kept.sort((left, right) => {
    const count = seedMatchCount(byItem.get(right.id) ?? [], filters.seed) - seedMatchCount(byItem.get(left.id) ?? [], filters.seed);
    if (count !== 0) return count;
    return left.sku.localeCompare(right.sku, undefined, { numeric: true });
  });
  const start = (page - 1) * ITEM_SEARCH_PAGE_SIZE;
  const seedCount = Object.keys(filters.seed).length;
  const pageRows = kept.slice(start, start + ITEM_SEARCH_PAGE_SIZE).map((item) => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    manufacturer: item.manufacturer,
    partNumber: item.partNumber,
    quantity: item.quantity,
    matchCount: seedMatchCount(byItem.get(item.id) ?? [], filters.seed),
    seedCount,
  }));
  const listedValues = await loadListedValues(supabase, taxonomy.fields.filter((field) => field.usesList).map((field) => field.id));
  const fields = taxonomy.fields.map((field) => {
    if (!field.usesList) return { ...publicField(field), options: [] };
    const relaxed: AttributeFilters = { ...filters, lists: { ...filters.lists } };
    delete relaxed.lists[field.id];
    const pool = items.filter((item) => {
      if (filters.excludeId && item.id === filters.excludeId) return false;
      return itemMatchesFilters(byItem.get(item.id) ?? [], relaxed);
    });
    const counts = new Map<string, number>();
    const seen = new Map<string, { value: string; sortOrder: number | null }>();
    for (const item of items) {
      for (const stored of byItem.get(item.id) ?? []) {
        if (stored.attributeId !== field.id || !stored.value.trim()) continue;
        const canonical = canonicalValue(listedValues.get(field.id) ?? [], stored.value);
        if (!seen.has(canonical.key)) seen.set(canonical.key, canonical);
      }
    }
    for (const item of pool) {
      for (const stored of byItem.get(item.id) ?? []) {
        if (stored.attributeId !== field.id || !stored.value.trim()) continue;
        const canonical = canonicalValue(listedValues.get(field.id) ?? [], stored.value);
        counts.set(canonical.key, (counts.get(canonical.key) ?? 0) + 1);
      }
    }
    const options = [...seen.values()]
      .map((option) => ({ ...option, count: counts.get(option.value.toLowerCase()) ?? 0 }))
      .sort(compareOptions);
    return { ...publicField(field), options };
  });
  return { fields, items: pageRows, total: kept.length };
}

function canonicalValue(listed: { value: string; sortOrder: number }[], stored: string): { key: string; value: string; sortOrder: number | null } {
  const match = listed.find((option) => option.value.trim().toLowerCase() === stored.trim().toLowerCase());
  const value = match?.value ?? stored.trim();
  return { key: value.toLowerCase(), value, sortOrder: match?.sortOrder ?? null };
}

function compareOptions(left: SearchOption, right: SearchOption): number {
  const leftOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.value.localeCompare(right.value, undefined, { numeric: true });
}

type ItemRecord = {
  id: string;
  sku: string;
  name: string;
  manufacturer: string;
  partNumber: string;
  quantity: number | null;
};

async function loadTaxonomyItems(supabase: SupabaseClient, taxonomyId: string): Promise<ItemRecord[]> {
  const rows = await fetchPages((from, to) =>
    supabase
      .from("items")
      .select("id, sku, name, part_number, quantity, manufacturers(name)")
      .eq("taxonomy_id", taxonomyId)
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => ({
    id: String(row.id),
    sku: text(row.sku),
    name: text(row.name),
    manufacturer: embeddedName(row.manufacturers),
    partNumber: text(row.part_number),
    quantity: row.quantity == null || row.quantity === "" ? null : numberValue(row.quantity),
  }));
}

async function loadAttributes(supabase: SupabaseClient, itemIds: string[]): Promise<(StoredAttribute & { itemId: string })[]> {
  const rows: (StoredAttribute & { itemId: string })[] = [];
  for (let index = 0; index < itemIds.length; index += 200) {
    const chunk = itemIds.slice(index, index + 200);
    if (chunk.length === 0) continue;
    const { data, error } = await supabase.from("item_attributes").select("item_id, attribute_id, value").in("item_id", chunk);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      rows.push({
        itemId: String(row.item_id),
        attributeId: String(row.attribute_id),
        value: text(row.value),
      });
    }
  }
  return rows;
}

function groupAttributes(rows: (StoredAttribute & { itemId: string })[]): Map<string, StoredAttribute[]> {
  const grouped = new Map<string, StoredAttribute[]>();
  for (const row of rows) {
    const list = grouped.get(row.itemId) ?? [];
    list.push({ attributeId: row.attributeId, value: row.value });
    grouped.set(row.itemId, list);
  }
  return grouped;
}

async function loadListedValues(supabase: SupabaseClient, attributeIds: string[]) {
  const grouped = new Map<string, { value: string; sortOrder: number }[]>();
  if (attributeIds.length === 0) return grouped;
  const { data, error } = await supabase
    .from("attribute_values")
    .select("attribute_id, value, sort_order")
    .in("attribute_id", attributeIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const id = String(row.attribute_id);
    const list = grouped.get(id) ?? [];
    list.push({ value: text(row.value), sortOrder: numberValue(row.sort_order) });
    grouped.set(id, list);
  }
  return grouped;
}

async function findPartSeed(supabase: SupabaseClient, part: string): Promise<SeedHit | null> {
  const norm = normalizePartNumber(part);
  if (!norm) return null;
  const quoted = `"${part.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  const exact = await supabase
    .from("items")
    .select("id, sku, part_number, oem_part_number, model, taxonomy_id")
    .or(`part_number.ilike.${quoted},oem_part_number.ilike.${quoted},model.ilike.${quoted}`)
    .limit(50);
  if (exact.error) throw new Error(exact.error.message);
  let candidates = ((exact.data ?? []) as PartRow[]).filter((row) => partRank(row, norm) < 9);
  if (candidates.length === 0) candidates = await scanPartColumns(supabase, norm);
  candidates.sort((left, right) => partRank(left, norm) - partRank(right, norm) || text(left.sku).localeCompare(text(right.sku)));
  const best = candidates[0];
  if (best?.taxonomy_id) {
    const attributes = await loadSeedAttributes(supabase, String(best.id), String(best.taxonomy_id));
    const taxonomy = await taxonomyIdentity(supabase, String(best.taxonomy_id));
    if (taxonomy) {
      return {
        source: "item",
        itemId: String(best.id),
        taxonomyId: taxonomy.id,
        shortCode: taxonomy.shortCode,
        taxonomyName: taxonomy.name,
        attributes,
      };
    }
  }
  const quote = await supabase
    .from("price_quotes")
    .select("taxonomy_id, taxonomies(name, short_code)")
    .eq("part_number_norm", norm)
    .not("taxonomy_id", "is", null)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (quote.error) throw new Error(quote.error.message);
  const taxonomyId = quote.data?.taxonomy_id ? String(quote.data.taxonomy_id) : "";
  const embedded = embeddedTaxonomy(quote.data?.taxonomies);
  if (!taxonomyId || !embedded?.shortCode) return null;
  return {
    source: "quote",
    itemId: null,
    taxonomyId,
    shortCode: embedded.shortCode,
    taxonomyName: embedded.name,
    attributes: [],
  };
}

type PartRow = {
  id?: unknown;
  sku?: unknown;
  part_number?: unknown;
  oem_part_number?: unknown;
  model?: unknown;
  taxonomy_id?: unknown;
};

function partRank(row: PartRow, norm: string): number {
  if (normalizePartNumber(text(row.part_number)) === norm) return 1;
  if (normalizePartNumber(text(row.oem_part_number)) === norm) return 2;
  if (normalizePartNumber(text(row.model)) === norm) return 3;
  return 9;
}

async function scanPartColumns(supabase: SupabaseClient, norm: string): Promise<PartRow[]> {
  const found: PartRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 12000; from += pageSize * 4) {
    const pages = await Promise.all(
      [0, 1, 2, 3].map(async (step) => {
        const start = from + step * pageSize;
        const { data, error } = await supabase
          .from("items")
          .select("id, sku, part_number, oem_part_number, model, taxonomy_id")
          .order("id")
          .range(start, start + pageSize - 1);
        if (error) throw new Error(error.message);
        return (data ?? []) as PartRow[];
      }),
    );
    let short = false;
    for (const page of pages) {
      for (const row of page) {
        if (partRank(row, norm) < 9) found.push(row);
      }
      if (page.length < pageSize) short = true;
    }
    if (short) break;
  }
  return found;
}

async function loadSeedAttributes(
  supabase: SupabaseClient,
  itemId: string,
  taxonomyId: string,
): Promise<SeedHit["attributes"]> {
  const [links, saved] = await Promise.all([
    supabase
      .from("taxonomy_attributes")
      .select("attribute_id, attributes(id, name, data_type, uses_list)")
      .eq("taxonomy_id", taxonomyId),
    supabase.from("item_attributes").select("attribute_id, value").eq("item_id", itemId),
  ]);
  if (links.error) throw new Error(links.error.message);
  if (saved.error) throw new Error(saved.error.message);
  const byId = new Map<string, { name: string; usesList: boolean; dataType: FieldRow["dataType"] }>();
  for (const link of links.data ?? []) {
    const attribute = embeddedAttribute(link.attributes);
    if (!attribute?.id || !attribute.name) continue;
    const dataType = attribute.data_type === "integer" || attribute.data_type === "decimal" ? attribute.data_type : "text";
    byId.set(String(attribute.id), { name: String(attribute.name), usesList: attribute.uses_list === true, dataType });
  }
  return (saved.data ?? []).flatMap((row) => {
    const attribute = byId.get(String(row.attribute_id));
    if (!attribute) return [];
    return [{ name: attribute.name, value: text(row.value), usesList: attribute.usesList, dataType: attribute.dataType }];
  });
}

async function taxonomyIdentity(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("taxonomies").select("id, name, short_code").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.short_code) return null;
  return { id: String(data.id), name: text(data.name), shortCode: text(data.short_code).toUpperCase() };
}

async function loadTaxonomies(supabase: SupabaseClient): Promise<TaxonomyRow[]> {
  const { data, error } = await supabase
    .from("taxonomies")
    .select("id, name, short_code, sort_order, taxonomy_attributes(sort_order, attributes(id, name, label, data_type, unit, uses_list))")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).flatMap((row) => {
    const shortCode = text(row.short_code).toUpperCase();
    if (!shortCode) return [];
    const links = Array.isArray(row.taxonomy_attributes) ? row.taxonomy_attributes : [];
    const fields = links
      .flatMap((link) => {
        const record = link as Record<string, unknown>;
        const attribute = embeddedAttribute(record.attributes);
        if (!attribute?.id || !attribute.name) return [];
        const dataType = attribute.data_type === "integer" || attribute.data_type === "decimal" ? attribute.data_type : "text";
        return [{
          id: String(attribute.id),
          name: String(attribute.name),
          label: attribute.label == null ? null : String(attribute.label),
          dataType,
          unit: attribute.unit == null ? null : String(attribute.unit),
          usesList: attribute.uses_list === true,
          sortOrder: numberValue(record.sort_order),
        } satisfies FieldRow];
      })
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
    return [{ id: String(row.id), name: text(row.name), shortCode, fields }];
  });
}

async function fetchPages(
  load: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 20000; from += pageSize) {
    const { data, error } = await load(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function embeddedName(value: unknown): string {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return "";
  return text((row as { name?: unknown }).name);
}

function embeddedTaxonomy(value: unknown): { name: string; shortCode: string } | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const record = row as { name?: unknown; short_code?: unknown };
  const shortCode = text(record.short_code).toUpperCase();
  if (!shortCode) return null;
  return { name: text(record.name), shortCode };
}

function embeddedAttribute(value: unknown): {
  id?: unknown;
  name?: unknown;
  label?: unknown;
  data_type?: unknown;
  unit?: unknown;
  uses_list?: unknown;
} | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  return row as {
    id?: unknown;
    name?: unknown;
    label?: unknown;
    data_type?: unknown;
    unit?: unknown;
    uses_list?: unknown;
  };
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function numberValue(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function searchFailure(error: unknown): string {
  return errorText(error);
}
