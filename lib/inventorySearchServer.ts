"use server";

import { errorText } from "@/lib/errors";
import {
  inventoryHits,
  type InventoryContentSource,
  type InventoryHit,
} from "@/lib/inventorySearch";
import { searchReceivingScan } from "@/lib/receivingActions";
import { scanSearchNote } from "@/lib/receivingScan";
import { getSupabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export type InventorySearchResult =
  | { ok: true; query: string; note: string | null; hits: InventoryHit[]; truncated: boolean }
  | { ok: false; message: string };

type ContentRow = {
  item_id?: unknown;
  qty?: unknown;
  bin_id?: unknown;
  cycle_id?: unknown;
};

const CONTENT_LIMIT = 5000;

/**
 * On-hand for the items receiving Find already ranked.
 * Open bin cycles only. Quantity is `bin_contents`, not `items.quantity`.
 * Every open bin is included. Receiving's same-project suggestion is a different list.
 */
async function openBinContents(supabase: SupabaseClient, itemIds: string[]): Promise<InventoryContentSource[]> {
  if (itemIds.length === 0) return [];
  const contents = await supabase
    .from("bin_contents")
    .select("item_id, qty, bin_id, cycle_id")
    .in("item_id", itemIds)
    .gt("qty", 0)
    .limit(CONTENT_LIMIT);
  if (contents.error) throw new Error(errorText(contents.error));
  const rows = (contents.data ?? []) as ContentRow[];
  if (rows.length === 0) return [];

  const cycleIds = [...new Set(rows.map((row) => String(row.cycle_id ?? "")).filter(Boolean))];
  const binIds = [...new Set(rows.map((row) => String(row.bin_id ?? "")).filter(Boolean))];
  const [cycles, bins] = await Promise.all([
    supabase.from("bin_cycles").select("id, status").in("id", cycleIds),
    supabase.from("bins").select("id, reference, current_location_id").in("id", binIds),
  ]);
  if (cycles.error) throw new Error(errorText(cycles.error));
  if (bins.error) throw new Error(errorText(bins.error));

  const open = new Set(
    (cycles.data ?? [])
      .filter((row) => String(row.status ?? "") === "open")
      .map((row) => String(row.id)),
  );
  const locationIds = [
    ...new Set(
      (bins.data ?? [])
        .map((row) => (row.current_location_id == null ? "" : String(row.current_location_id)))
        .filter(Boolean),
    ),
  ];
  const locations =
    locationIds.length === 0
      ? { data: [] as { id: string; code: string | null }[], error: null }
      : await supabase.from("locations").select("id, code").in("id", locationIds);
  if (locations.error) throw new Error(errorText(locations.error));
  const locationById = new Map(
    (locations.data ?? []).map((row) => [String(row.id), String(row.code ?? "").trim()]),
  );
  const binById = new Map(
    (bins.data ?? []).map((row) => {
      const locationId = row.current_location_id == null ? "" : String(row.current_location_id);
      const location = locationId ? locationById.get(locationId) ?? "" : "";
      return [String(row.id), { reference: String(row.reference ?? ""), locationCode: location || null }] as const;
    }),
  );

  return rows.map((row) => {
    const bin = binById.get(String(row.bin_id ?? ""));
    return {
      itemId: String(row.item_id ?? ""),
      qty: Number(row.qty),
      binReference: bin?.reference ?? "",
      locationCode: bin?.locationCode ?? null,
      cycleOpen: open.has(String(row.cycle_id ?? "")),
    };
  });
}

/** Receiving Find, then on-hand quantity and bin locations for each hit. */
export async function searchInventory(raw: string): Promise<InventorySearchResult> {
  const query = raw.trim().slice(0, 500);
  if (!query) return { ok: true, query: "", note: null, hits: [], truncated: false };
  try {
    const result = await searchReceivingScan(query);
    const found = Boolean(result.exact || result.matches.length > 0);
    const note = scanSearchNote({ token: result.token, tried: result.tried, found });
    if (!found) return { ok: true, query, note, hits: [], truncated: false };
    const supabase = await getSupabase();
    const contents = await openBinContents(
      supabase,
      result.matches.map((match) => match.id),
    );
    const hits = inventoryHits(result.matches, contents);
    return { ok: true, query, note, hits, truncated: result.truncated };
  } catch (cause) {
    return { ok: false, message: errorText(cause) };
  }
}
