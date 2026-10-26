"use server";

import { itemMoveIds, itemMoveTargetBin, itemMoveTargetError } from "@/lib/binItemMove";
import { errorText } from "@/lib/errors";
import {
  moveMigrationMissing,
  movePlaceFromJson,
  movePreviewFromJson,
  moveSummaryFromJson,
  recentMovesFromJson,
  type MovePlace,
  type MovePreview,
  type MoveResult,
  type RecentMove,
} from "@/lib/moveInventory";
import { operatorInitials } from "@/lib/stockAccess";
import { getSupabase } from "@/lib/supabase";

const MOVE_BIN_ITEMS_MIGRATION = "supabase/migrations/20261026220253_move_bin_items.sql";
const MOVE_BIN_ITEM_LINES_MIGRATION = "supabase/migrations/20261026233415_move_bin_item_lines.sql";

function raiseRpc(error: { code?: string; message?: string } | null): never {
  if (moveMigrationMissing(error)) {
    throw new Error("Apply supabase/migrations/20261024064500_move_inventory.sql before moves can be saved.");
  }
  throw new Error(errorText(error));
}

export async function fetchMovePlace(code: string): Promise<MovePlace> {
  const { data, error } = await (await getSupabase()).rpc("fetch_move_place", { p_code: code });
  if (error) raiseRpc(error);
  return movePlaceFromJson(data);
}

export async function previewMove(payload: {
  kind: "bin" | "bins" | "item" | "items" | "empty";
  binRefs: string[];
  fromBin: string | null;
  itemId: string | null;
  qty: number | null;
  items?: { itemId: string; qty: number }[];
  targetBin: string | null;
  targetLocation: string | null;
}): Promise<MovePreview> {
  if (payload.kind === "items") {
    const items = payload.items ?? [];
    if (items.length < 1) return { ok: false, message: "Choose an item.", summary: null };
    const summaries: string[] = [];
    for (const line of items) {
      const next = await previewMove({ ...payload, kind: "item", itemId: line.itemId, qty: line.qty, items: undefined });
      if (!next.ok) return next;
      if (next.summary) summaries.push(next.summary);
    }
    return { ok: true, message: null, summary: summaries.join(" ") };
  }
  const { data, error } = await (await getSupabase()).rpc("preview_move", {
    p_payload: {
      kind: payload.kind,
      bin_refs: payload.binRefs,
      from_bin: payload.fromBin,
      item_id: payload.itemId,
      qty: payload.qty,
      target_bin: payload.targetBin,
      target_location: payload.targetLocation,
    },
  });
  if (error) raiseRpc(error);
  return movePreviewFromJson(data);
}

export async function commitMove(input: {
  kind: "bin" | "bins" | "item" | "items" | "empty";
  binRefs: string[];
  fromBin: string | null;
  itemId: string | null;
  qty: number | null;
  items?: { itemId: string; qty: number }[];
  targetBin: string | null;
  targetLocation: string | null;
  comment: string;
  requestId: string;
}): Promise<MoveResult> {
  const initials = await operatorInitials();
  const supabase = await getSupabase();
  let data: unknown;
  let error: { code?: string; message?: string } | null;
  if (input.kind === "item" || (input.kind === "items" && (input.items?.length ?? 0) === 1)) {
    const line = input.kind === "items" ? input.items?.[0] : null;
    ({ data, error } = await supabase.rpc("move_item_qty", {
      p_from_bin_ref: input.fromBin,
      p_to_bin_ref: input.targetBin,
      p_item_id: line?.itemId ?? input.itemId,
      p_qty: line?.qty ?? input.qty,
      p_initials: initials,
      p_comment: input.comment,
      p_client_request_id: input.requestId,
    }));
  } else if (input.kind === "items") {
    const lines = input.items ?? [];
    if (lines.length < 1) throw new Error("Choose an item.");
    ({ data, error } = await supabase.rpc("move_bin_items", {
      p_from_bin_ref: input.fromBin,
      p_to_bin_ref: input.targetBin,
      p_lines: lines.map((line) => ({ item_id: line.itemId, qty: line.qty })),
      p_initials: initials,
      p_client_request_id: input.requestId,
    }));
    if (error && moveMigrationMissing(error)) {
      throw new Error(`Apply ${MOVE_BIN_ITEM_LINES_MIGRATION} before several items can be moved together.`);
    }
  } else if (input.kind === "empty") {
    ({ data, error } = await supabase.rpc("empty_bin_into", {
      p_from_bin: input.fromBin,
      p_to_bin: input.targetBin,
      p_initials: initials,
      p_client_request_id: input.requestId,
    }));
  } else if (input.binRefs.length === 1 && input.targetBin == null && input.targetLocation) {
    ({ data, error } = await supabase.rpc("unnest", {
      p_bin_ref: input.binRefs[0],
      p_target_location_code: input.targetLocation,
      p_initials: initials,
      p_client_request_id: input.requestId,
    }));
  } else if (input.binRefs.length === 1) {
    ({ data, error } = await supabase.rpc("move_bin", {
      p_bin_ref: input.binRefs[0],
      p_target_bin_ref: input.targetBin,
      p_target_location_code: input.targetLocation,
      p_initials: initials,
      p_client_request_id: input.requestId,
    }));
  } else {
    ({ data, error } = await supabase.rpc("move_bins", {
      p_bin_refs: input.binRefs,
      p_target_bin_ref: input.targetBin,
      p_target_location_code: input.targetLocation,
      p_initials: initials,
      p_client_request_id: input.requestId,
    }));
  }
  if (error) raiseRpc(error);
  return { summary: moveSummaryFromJson(data), requestId: input.requestId };
}

export async function moveBinItems(input: {
  fromBin: string;
  toBin: string;
  itemIds: string[];
  requestId: string;
}): Promise<MoveResult> {
  const itemIds = itemMoveIds(input.itemIds);
  if (itemIds.length < 1) throw new Error("Choose an item.");
  if (itemIds.length > 200) throw new Error("Move at most 200 items at once.");
  const targetError = itemMoveTargetError(input.toBin);
  if (targetError) throw new Error(targetError);
  const initials = await operatorInitials();
  const { data, error } = await (await getSupabase()).rpc("move_bin_items", {
    p_from_bin_ref: input.fromBin,
    p_to_bin_ref: itemMoveTargetBin(input.toBin),
    p_item_ids: itemIds,
    p_initials: initials,
    p_client_request_id: input.requestId,
  });
  if (error) {
    if (moveMigrationMissing(error)) {
      throw new Error(`Apply ${MOVE_BIN_ITEMS_MIGRATION} before selected items can be moved.`);
    }
    throw new Error(errorText(error));
  }
  return { summary: moveSummaryFromJson(data), requestId: input.requestId };
}

export async function undoMove(originalRequestId: string, requestId: string): Promise<MoveResult> {
  const initials = await operatorInitials();
  const { data, error } = await (await getSupabase()).rpc("undo_move", {
    p_original_request_id: originalRequestId,
    p_initials: initials,
    p_client_request_id: requestId,
  });
  if (error) raiseRpc(error);
  return { summary: moveSummaryFromJson(data), requestId };
}

export async function listRecentMoves(): Promise<RecentMove[]> {
  const { data, error } = await (await getSupabase()).rpc("list_recent_moves", { p_limit: 20 });
  if (error) raiseRpc(error);
  return recentMovesFromJson(data);
}
