import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

export const BIN_TYPES = [
  { id: "P", label: "Pallet", word: "PALLET" },
  { id: "C", label: "Crate", word: "CRATE" },
  { id: "B", label: "Box", word: "BOX" },
] as const;

export type BinType = (typeof BIN_TYPES)[number]["id"];

export const BIN_PRINT_MAX = 100;
export const BIN_COPY_MAX = 50;
export const DEFAULT_BIN_NEXT_NUMBER = 20000;

const REFERENCE = /^(\d+)-([PCB])$/;

export type BinRecord = {
  id: string;
  number: number;
  type: BinType;
  reference: string;
  notes: string | null;
  printedCount: number;
  lastPrintedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  currentLocationId: string | null;
};

export type BinCounter = {
  nextNumber: number;
  highestIssued: number | null;
};

export function isBinType(value: string): value is BinType {
  return BIN_TYPES.some((type) => type.id === value);
}

export function binTypeWord(type: BinType): string {
  return BIN_TYPES.find((entry) => entry.id === type)?.word ?? type;
}

export function binTypeLabel(type: BinType): string {
  return BIN_TYPES.find((entry) => entry.id === type)?.label ?? type;
}

export function formatBinReference(number: number, type: BinType): string {
  return `${number}-${type}`;
}

export function parseBinReference(
  value: string,
): { number: number; type: BinType; reference: string } | null {
  const match = value.trim().toUpperCase().match(REFERENCE);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number) || number < 1 || String(number) !== match[1]) return null;
  const type = match[2];
  if (!isBinType(type)) return null;
  return { number, type, reference: formatBinReference(number, type) };
}

export function nextNumberError(proposed: number, highestIssued: number | null): string | null {
  if (!Number.isInteger(proposed) || proposed < 1) {
    return "Next bin number must be a whole number of at least 1.";
  }
  if (highestIssued != null && proposed <= highestIssued) {
    return `Next number must be higher than the highest issued number (${highestIssued}).`;
  }
  return null;
}

export function parsePrintCount(value: string, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return null;
  return parsed;
}

export function parseBinRange(
  fromText: string,
  toText: string,
): { from: number; to: number } | null {
  const from = parsePrintCount(fromText, Number.MAX_SAFE_INTEGER);
  const to = parsePrintCount(toText, Number.MAX_SAFE_INTEGER);
  if (from == null || to == null || to < from) return null;
  if (to - from + 1 > BIN_PRINT_MAX) return null;
  return { from, to };
}

export function binCreatedLabel(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data)) return [data];
  return [];
}

export function binFromRow(row: Record<string, unknown>): BinRecord {
  const type = row.type;
  if (typeof type !== "string" || !isBinType(type)) {
    throw new Error("Unexpected bin type.");
  }
  const number = Number(row.number);
  if (!Number.isInteger(number)) throw new Error("Unexpected bin number.");
  return {
    id: String(row.id),
    number,
    type,
    reference: String(row.reference),
    notes: row.notes == null ? null : String(row.notes),
    printedCount: Number(row.printed_count),
    lastPrintedAt: row.last_printed_at == null ? null : String(row.last_printed_at),
    createdAt: String(row.created_at),
    createdBy: row.created_by == null ? null : String(row.created_by),
    currentLocationId: row.current_location_id == null ? null : String(row.current_location_id),
  };
}

const BIN_COLUMNS =
  "id, number, type, reference, notes, printed_count, last_printed_at, created_at, created_by, current_location_id";

export async function fetchBinCounter(): Promise<BinCounter> {
  const supabase = await getSupabase();
  const [counter, highest] = await Promise.all([
    supabase.from("bin_counter").select("next_number").eq("id", true).single(),
    supabase.from("bins").select("number").order("number", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (counter.error) throw new Error(errorText(counter.error));
  if (highest.error) throw new Error(errorText(highest.error));
  const nextNumber = Number(counter.data?.next_number);
  if (!Number.isInteger(nextNumber)) throw new Error("Bin counter is missing.");
  const highestIssued =
    highest.data?.number == null ? null : Number(highest.data.number);
  return {
    nextNumber,
    highestIssued: Number.isInteger(highestIssued) ? highestIssued : null,
  };
}

export async function fetchRecentBins(limit = 20): Promise<BinRecord[]> {
  const { data, error } = await (await getSupabase())
    .from("bins")
    .select(BIN_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(errorText(error));
  return (data ?? []).map((row) => binFromRow(row as Record<string, unknown>));
}

export async function saveBinNextNumber(nextNumber: number): Promise<number> {
  const { data, error } = await (await getSupabase()).rpc("set_bin_next_number", {
    p_next: nextNumber,
  });
  if (error) throw new Error(errorText(error));
  const saved = Number(data);
  if (!Number.isInteger(saved)) throw new Error("Bin counter did not save.");
  return saved;
}

export async function reserveBins(type: BinType, count: number): Promise<BinRecord[]> {
  const { data, error } = await (await getSupabase()).rpc("reserve_bins", {
    p_type: type,
    p_count: count,
  });
  if (error) throw new Error(errorText(error));
  return asRows(data).map(binFromRow);
}

export async function printBinRange(
  type: BinType,
  from: number,
  to: number,
): Promise<BinRecord[]> {
  const { data, error } = await (await getSupabase()).rpc("print_bin_range", {
    p_type: type,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(errorText(error));
  return asRows(data).map(binFromRow);
}

export async function reprintBin(reference: string, copies: number): Promise<BinRecord> {
  const { data, error } = await (await getSupabase()).rpc("reprint_bin", {
    p_reference: reference,
    p_copies: copies,
  });
  if (error) throw new Error(errorText(error));
  const row = asRows(data)[0];
  if (!row) throw new Error("That bin did not print.");
  return binFromRow(row);
}
