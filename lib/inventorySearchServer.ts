"use server";

import { errorText } from "@/lib/errors";
import {
  inventoryHits,
  type InventoryContentSource,
  type InventoryHit,
  type InventoryMatch,
} from "@/lib/inventorySearch";
import { alnumQueryAlternatives } from "@/lib/itemAlnum";
import { searchReceivingScan } from "@/lib/receivingActions";
import { scanSearchNote } from "@/lib/receivingScan";
import type { LabelItem } from "@/lib/types";
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

/**
 * Receiving Find, then on-hand quantity and bin locations for each hit.
 * `|` is OR before that scan. `7060DX5|7060PX5` keeps either model.
 */
export async function searchInventory(raw: string): Promise<InventorySearchResult> {
  const query = raw.trim().slice(0, 500);
  if (!query) return { ok: true, query: "", note: null, hits: [], truncated: false };
  const terms = alnumQueryAlternatives(query);
  if (terms.length === 0) return { ok: true, query, note: null, hits: [], truncated: false };
  try {
    const scans = await Promise.all(terms.map((term) => searchReceivingScan(term)));
    const found = scans.some((result) => result.exact || result.matches.length > 0);
    const note =
      scans
        .map((result) =>
          scanSearchNote({
            token: result.token,
            tried: result.tried,
            found: Boolean(result.exact || result.matches.length > 0),
          }),
        )
        .filter((line): line is string => Boolean(line))
        .join(" ") || null;
    if (!found) return { ok: true, query, note, hits: [], truncated: false };
    const matches = mergeScanMatches(scans);
    const supabase = await getSupabase();
    const contents = await openBinContents(
      supabase,
      matches.map((match) => match.id),
    );
    const hits = inventoryHits(matches, contents);
    return {
      ok: true,
      query,
      note,
      hits,
      truncated: scans.some((result) => result.truncated),
    };
  } catch (cause) {
    return { ok: false, message: errorText(cause) };
  }
}

function mergeScanMatches(scans: readonly { matches: readonly LabelItem[] }[]): InventoryMatch[] {
  const matches: InventoryMatch[] = [];
  const seen = new Set<string>();
  for (const scan of scans) {
    for (const match of scan.matches) {
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      matches.push({
        id: match.id,
        sku: match.sku,
        name: match.name,
        description: match.description,
      });
    }
  }
  return matches;
}
