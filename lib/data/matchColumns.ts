import type { ColumnSpec } from "@/lib/data/registry";

export type ColumnMapping = Record<string, string | null>;

export function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[#_./\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keysFor(column: ColumnSpec): Set<string> {
  return new Set([column.key, ...column.synonyms].map((name) => normalizeHeader(name)));
}

export function autoMatch(headers: string[], columns: ColumnSpec[]): ColumnMapping {
  const used = new Set<string>();
  const mapping: ColumnMapping = {};
  for (const column of columns) {
    const keys = keysFor(column);
    const header = headers.find((candidate) => !used.has(candidate) && keys.has(normalizeHeader(candidate)));
    mapping[column.key] = header ?? null;
    if (header) used.add(header);
  }
  return mapping;
}

export function applyRememberedMapping(
  headers: string[],
  auto: ColumnMapping,
  remembered: ColumnMapping | null,
): ColumnMapping {
  if (!remembered) return auto;
  const available = new Set(headers);
  const mapping: ColumnMapping = { ...auto };
  for (const [key, source] of Object.entries(remembered)) {
    if (source == null) mapping[key] = null;
    else if (available.has(source)) mapping[key] = source;
  }
  return mapping;
}

export function unmappedHeaders(headers: string[], mapping: ColumnMapping): string[] {
  const used = new Set(Object.values(mapping).filter((value): value is string => Boolean(value)));
  return headers.filter((header) => !used.has(header));
}

export function missingRequired(columns: ColumnSpec[], mapping: ColumnMapping): ColumnSpec[] {
  return columns.filter((column) => column.required && !mapping[column.key]);
}

export function sampleValues(rows: string[][], headers: string[], header: string, limit = 3): string[] {
  const index = headers.indexOf(header);
  if (index < 0) return [];
  const values: string[] = [];
  for (const row of rows) {
    const value = (row[index] ?? "").trim();
    if (!value || values.includes(value)) continue;
    values.push(value);
    if (values.length >= limit) break;
  }
  return values;
}

export function readMappedRow(
  headers: string[],
  cells: string[],
  mapping: ColumnMapping,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, header] of Object.entries(mapping)) {
    if (!header) {
      record[key] = "";
      continue;
    }
    const index = headers.indexOf(header);
    record[key] = index < 0 ? "" : (cells[index] ?? "").trim();
  }
  return record;
}

const MAP_PREFIX = "its.dataMap.";

export function mappingStorageKey(tableId: string): string {
  return `${MAP_PREFIX}${tableId}`;
}

export function readRememberedMapping(tableId: string): ColumnMapping | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(mappingStorageKey(tableId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const mapping: ColumnMapping = {};
    for (const [key, value] of Object.entries(parsed)) {
      mapping[key] = typeof value === "string" ? value : null;
    }
    return mapping;
  } catch {
    return null;
  }
}

export function writeRememberedMapping(tableId: string, mapping: ColumnMapping): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(mappingStorageKey(tableId), JSON.stringify(mapping));
}
