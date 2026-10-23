"use server";

import { isBinType } from "@/lib/bins";
import { reprintBin } from "@/lib/binActions";
import {
  classifyBinRows,
  importRowsFromMapped,
  type BinImportContext,
  type ClassifiedBinRow,
  type CounterBump,
} from "@/lib/data/binRows";
import { toCsv } from "@/lib/data/csv";
import {
  DATA_TABLES,
  exportColumns,
  importSizeError,
  MAX_IMPORT_ROWS,
  type DataTable,
} from "@/lib/data/registry";
import { errorText } from "@/lib/errors";
import { canViewFinancials } from "@/lib/export/access";
import { readAppUser } from "@/lib/appUserRecord";
import { authRequired } from "@/lib/authRequired";
import { sessionUser } from "@/lib/sessionUser";
import { operatorInitials, stockSettingsWritable } from "@/lib/stockAccess";
import { getSupabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export type BinImportPreview = {
  rows: ClassifiedBinRow[];
  counter: CounterBump;
};

export type BinImportResult = {
  committed: boolean;
  rows: ClassifiedBinRow[];
  counterBefore: number;
  counterAfter: number;
  counterBumped: boolean;
};

export type DataExport = {
  filename: string;
  csv: string;
  truncated: boolean;
  headers: string[];
  rows: string[][];
};

type MappedBinInput = {
  code: string;
  location: string;
  note: string;
  type: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function assertDataAdmin(): Promise<string> {
  if (!(await stockSettingsWritable())) {
    throw new Error("Only an admin can import or export data.");
  }
  return operatorInitials();
}

async function canViewMoney(): Promise<boolean> {
  if (!authRequired()) return true;
  const session = await sessionUser();
  if (!session) return false;
  const user = await readAppUser(session.id);
  return Boolean(user && canViewFinancials(user.role));
}

function preparedRows(inputs: MappedBinInput[]) {
  const rows = importRowsFromMapped(inputs);
  const error = importSizeError(JSON.stringify(rows).length, rows.length);
  if (error) throw new Error(error);
  return rows;
}

async function eachPage(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  order: string,
  limit = 100000,
): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; rows.length < limit; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(order)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(errorText(error));
    const batch = ((data ?? []) as unknown[]).filter(isRecord);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function embedded(value: unknown): Record<string, unknown> {
  const row = Array.isArray(value) ? value[0] : value;
  return isRecord(row) ? row : {};
}

async function binContext(supabase: SupabaseClient): Promise<BinImportContext> {
  const [bins, locations, defaults, counter] = await Promise.all([
    eachPage(supabase, "bins", "number, reference", "number"),
    eachPage(supabase, "locations", "code", "code"),
    supabase.from("bin_default_locations").select("bin_type, locations(code)"),
    supabase.from("bin_counter").select("next_number").eq("id", true).single(),
  ]);
  if (defaults.error) throw new Error(errorText(defaults.error));
  if (counter.error) throw new Error(errorText(counter.error));
  const nextNumber = Number(counter.data?.next_number);
  if (!Number.isInteger(nextNumber)) throw new Error("Bin counter is missing.");

  const existingByNumber = new Map<number, string>();
  for (const row of bins) {
    const number = Number(row.number);
    if (Number.isInteger(number)) existingByNumber.set(number, String(row.reference ?? ""));
  }
  const placeCodes = new Set(locations.map((row) => String(row.code ?? "").toUpperCase()));
  const fallback: BinImportContext["defaults"] = {};
  for (const row of defaults.data ?? []) {
    if (!isRecord(row) || !isBinType(String(row.bin_type))) continue;
    const code = String(embedded(row.locations).code ?? "").toUpperCase();
    if (code) fallback[String(row.bin_type) as "B" | "C" | "P"] = code;
  }
  return { existingByNumber, locations: placeCodes, defaults: fallback, nextNumber };
}

export async function fetchLocationPrefixes(): Promise<string[]> {
  await assertDataAdmin();
  const { data, error } = await (await getSupabase())
    .from("location_types")
    .select("prefix")
    .order("prefix");
  if (error) throw new Error(errorText(error));
  return (data ?? []).filter(isRecord).map((row) => String(row.prefix ?? "")).filter(Boolean);
}

export async function previewBinImport(inputs: MappedBinInput[]): Promise<BinImportPreview> {
  await assertDataAdmin();
  const rows = preparedRows(inputs);
  const context = await binContext(await getSupabase());
  return classifyBinRows(rows, context);
}

function classifiedFromJson(value: unknown): ClassifiedBinRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    row: Number(row.row),
    code: String(row.code ?? ""),
    location: String(row.location ?? ""),
    note: String(row.note ?? ""),
    status: row.status === "new" || row.status === "exists" || row.status === "error" ? row.status : "error",
    reason: row.reason == null || row.reason === "" ? null : String(row.reason),
  }));
}

export async function commitBinImport(inputs: MappedBinInput[]): Promise<BinImportResult> {
  const initials = await assertDataAdmin();
  const rows = preparedRows(inputs);
  const { data, error } = await (await getSupabase()).rpc("import_bins", {
    p_rows: rows,
    p_initials: initials,
    p_dry_run: false,
  });
  if (error) throw new Error(errorText(error));
  const payload = isRecord(data) ? data : {};
  return {
    committed: payload.committed === true,
    rows: classifiedFromJson(payload.rows),
    counterBefore: Number(payload.counter_before),
    counterAfter: Number(payload.counter_after),
    counterBumped: payload.counter_bumped === true,
  };
}

export async function markImportedBinsPrinted(references: string[]): Promise<number> {
  await assertDataAdmin();
  const codes = references.map((reference) => reference.trim()).filter(Boolean);
  if (codes.length > MAX_IMPORT_ROWS) throw new Error("Import at most 5000 rows at a time.");
  for (const reference of codes) {
    await reprintBin(reference, 1);
  }
  return codes.length;
}

function tableOrThrow(id: string): DataTable {
  const table = DATA_TABLES.find((item) => item.id === id);
  if (!table || !table.exportable) throw new Error("That table cannot be exported.");
  return table;
}

export async function exportDataTable(tableId: string): Promise<DataExport> {
  await assertDataAdmin();
  const table = tableOrThrow(tableId);
  const money = await canViewMoney();
  const columns = exportColumns(table, money);
  const headers = columns.map((column) => column.key);
  if (table.id === "bins") return exportBins(headers);
  if (table.id === "locations") return exportLocations(headers);
  throw new Error("That table cannot be exported.");
}

async function exportBins(headers: string[]): Promise<DataExport> {
  const supabase = await getSupabase();
  const { count, error: countError } = await supabase
    .from("bins")
    .select("id", { count: "exact", head: true });
  if (countError) throw new Error(errorText(countError));
  const bins = await eachPage(
    supabase,
    "bins",
    "id, number, type, reference, created_at, created_by_initials, printed_count, last_printed_at, current_location_id",
    "number",
    MAX_IMPORT_ROWS,
  );
  const locationIds = [...new Set(bins.map((row) => String(row.current_location_id ?? "")).filter(Boolean))];
  const binIds = bins.map((row) => String(row.id));
  const locationById = new Map<string, string>();
  for (const chunk of chunks(locationIds, 200)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase.from("locations").select("id, code").in("id", chunk);
    if (error) throw new Error(errorText(error));
    for (const row of data ?? []) {
      if (isRecord(row)) locationById.set(String(row.id), String(row.code ?? ""));
    }
  }
  const cycleByBin = new Map<string, { id: string; project: string; origin: string }>();
  for (const chunk of chunks(binIds, 200)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("bin_cycles")
      .select("id, bin_id, project, origin_description")
      .eq("status", "open")
      .in("bin_id", chunk);
    if (error) throw new Error(errorText(error));
    for (const row of data ?? []) {
      if (!isRecord(row)) continue;
      cycleByBin.set(String(row.bin_id), {
        id: String(row.id),
        project: String(row.project ?? ""),
        origin: String(row.origin_description ?? ""),
      });
    }
  }
  const qtyByCycle = new Map<string, number>();
  const cycleIds = [...cycleByBin.values()].map((cycle) => cycle.id);
  for (const chunk of chunks(cycleIds, 200)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase.from("bin_contents").select("cycle_id, qty").in("cycle_id", chunk);
    if (error) throw new Error(errorText(error));
    for (const row of data ?? []) {
      if (!isRecord(row)) continue;
      const id = String(row.cycle_id);
      qtyByCycle.set(id, (qtyByCycle.get(id) ?? 0) + Number(row.qty ?? 0));
    }
  }
  const rows = bins.map((row) => {
    const cycle = cycleByBin.get(String(row.id));
    const values: Record<string, string> = {
      code: String(row.reference ?? ""),
      type: String(row.type ?? ""),
      location: locationById.get(String(row.current_location_id ?? "")) ?? "",
      project: cycle?.project ?? "",
      origin: cycle?.origin ?? "",
      qty: String(cycle ? (qtyByCycle.get(cycle.id) ?? 0) : 0),
      created_at: compactStamp(String(row.created_at ?? "")),
      created_by_initials: String(row.created_by_initials ?? ""),
      printed_count: String(row.printed_count ?? 0),
      last_printed_at: row.last_printed_at ? compactStamp(String(row.last_printed_at)) : "",
    };
    return headers.map((header) => values[header] ?? "");
  });
  return {
    filename: "bins.csv",
    csv: toCsv(headers, rows),
    truncated: (count ?? 0) > MAX_IMPORT_ROWS,
    headers,
    rows,
  };
}

async function exportLocations(headers: string[]): Promise<DataExport> {
  const supabase = await getSupabase();
  const { count, error: countError } = await supabase
    .from("locations")
    .select("id", { count: "exact", head: true });
  if (countError) throw new Error(errorText(countError));
  const locations = await eachPage(
    supabase,
    "locations",
    "code, row, bay, elevation, orientation, description, location_types(name, prefix)",
    "code",
    MAX_IMPORT_ROWS,
  );
  const rows = locations.map((row) => {
    const type = embedded(row.location_types);
    const values: Record<string, string> = {
      code: String(row.code ?? ""),
      type: String(type.name ?? ""),
      prefix: String(type.prefix ?? ""),
      row: String(row.row ?? ""),
      bay: String(row.bay ?? ""),
      elevation: String(row.elevation ?? ""),
      orientation: String(row.orientation ?? ""),
      description: String(row.description ?? ""),
    };
    return headers.map((header) => values[header] ?? "");
  });
  return {
    filename: "locations.csv",
    csv: toCsv(headers, rows),
    truncated: (count ?? 0) > MAX_IMPORT_ROWS,
    headers,
    rows,
  };
}

function compactStamp(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(date)
    .replace(/[\u202f\u00a0]/g, " ")
    .replace(",", "");
}

function chunks<T>(values: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}
