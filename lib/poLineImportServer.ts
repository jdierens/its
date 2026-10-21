"use server";

import { errorText } from "@/lib/errors";
import { applyItemMatch, mapImportSheet, type ImportPreview, type ItemMatch } from "@/lib/poLineImport";
import { readTabularFile } from "@/lib/poSpreadsheet";
import { purchasePageAccess } from "@/lib/purchaseSession";
import { getSupabase } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDIT_DENIED = "You cannot change a purchase order.";

export async function previewPurchaseLines(input: { fileName: string; fileBase64: string }): Promise<ImportPreview> {
  const access = await purchasePageAccess();
  if (!access.canEdit || !access.canViewMoney) throw new Error(EDIT_DENIED);
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(input.fileBase64);
  } catch {
    throw new Error("Could not read the file.");
  }
  let table: string[][];
  try {
    table = readTabularFile(input.fileName || "lines.csv", bytes);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not read the file.", rows: [] };
  }
  const mapped = mapImportSheet(table);
  if (mapped.error) return mapped;
  const matches = await matchItems(mapped.rows.map((row) => row.itemSku).filter(Boolean));
  return {
    error: null,
    rows: mapped.rows.map((row) => applyItemMatch(row, matches.get(row.itemSku.trim().toLowerCase()) ?? null)),
  };
}

function decodeBase64(value: string): Uint8Array {
  const cleaned = value.replace(/\s/g, "");
  if (!cleaned || cleaned.length > 1_200_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new Error("Could not read the file.");
  }
  return new Uint8Array(Buffer.from(cleaned, "base64"));
}

async function matchItems(keys: string[]): Promise<Map<string, ItemMatch>> {
  const map = new Map<string, ItemMatch>();
  const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  const uuids = unique.filter((key) => UUID.test(key));
  const skus = unique.filter((key) => !UUID.test(key));
  const supabase = await getSupabase();
  if (uuids.length > 0) {
    const { data, error } = await supabase.from("items").select("id, sku, name, description").in("id", uuids);
    if (error) throw new Error(errorText(error));
    for (const row of data ?? []) remember(map, row);
  }
  for (let index = 0; index < skus.length; index += 20) {
    const chunk = skus.slice(index, index + 20);
    const filter = chunk.map((sku) => `sku.ilike.${quoteFilter(escapeLike(sku))}`).join(",");
    const { data, error } = await supabase.from("items").select("id, sku, name, description").or(filter);
    if (error) throw new Error(errorText(error));
    for (const row of data ?? []) remember(map, row);
  }
  return map;
}

function remember(
  map: Map<string, ItemMatch>,
  row: { id: unknown; sku: unknown; name: unknown; description: unknown },
): void {
  const match: ItemMatch = {
    id: String(row.id),
    sku: String(row.sku ?? ""),
    name: String(row.name ?? ""),
    description: String(row.description ?? "").slice(0, 500),
  };
  map.set(match.id.toLowerCase(), match);
  if (match.sku) map.set(match.sku.toLowerCase(), match);
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function quoteFilter(value: string): string {
  if (/[,"():\s]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
