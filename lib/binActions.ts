"use server";

import { binFromRow, type BinRecord, type BinType } from "@/lib/bins";
import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

const BIN_COLUMNS =
  "id, number, type, reference, notes, printed_count, last_printed_at, created_at, created_by, current_location_id";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data)) return [data];
  return [];
}

export async function fetchBin(reference: string): Promise<BinRecord | null> {
  const { data, error } = await (await getSupabase())
    .from("bins")
    .select(BIN_COLUMNS)
    .eq("reference", reference)
    .maybeSingle();
  if (error) throw new Error(errorText(error));
  if (!data) return null;
  return binFromRow(data as Record<string, unknown>);
}

export async function fetchBinCounter(): Promise<{ nextNumber: number; highestIssued: number | null }> {
  const supabase = await getSupabase();
  const [counter, highest] = await Promise.all([
    supabase.from("bin_counter").select("next_number").eq("id", true).single(),
    supabase.from("bins").select("number").order("number", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (counter.error) throw new Error(errorText(counter.error));
  if (highest.error) throw new Error(errorText(highest.error));
  const nextNumber = Number(counter.data?.next_number);
  if (!Number.isInteger(nextNumber)) throw new Error("Bin counter is missing.");
  const highestIssued = highest.data?.number == null ? null : Number(highest.data.number);
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
  const { data, error } = await (await getSupabase()).rpc("set_bin_next_number", { p_next: nextNumber });
  if (error) throw new Error(errorText(error));
  const saved = Number(data);
  if (!Number.isInteger(saved)) throw new Error("Bin counter did not save.");
  return saved;
}

export async function reserveBins(type: BinType, count: number): Promise<BinRecord[]> {
  const { data, error } = await (await getSupabase()).rpc("reserve_bins", { p_type: type, p_count: count });
  if (error) throw new Error(errorText(error));
  return asRows(data).map(binFromRow);
}

export async function printBinRange(type: BinType, from: number, to: number): Promise<BinRecord[]> {
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
