"use server";

import { authRequired } from "@/lib/authRequired";
import { readAppUser } from "@/lib/appUserRecord";
import { errorText } from "@/lib/errors";
import { canViewFinancials } from "@/lib/export/access";
import {
  RECEIVING_PAGE_SIZE,
  receivingDateToStore,
  receivingEntryForViewer,
  type ReceivingEntry,
} from "@/lib/receivingSettings";
import { sessionUser } from "@/lib/sessionUser";
import { operatorInitials } from "@/lib/stockAccess";
import {
  binDetailFromJson,
  createdBinFromJson,
  moveFromJson,
  receiptFromJson,
  suggestionsFromJson,
  type BinDetail,
  type BinSuggestion,
  type CreatedBin,
  type MoveResult,
  type ReceiptResult,
} from "@/lib/stockReceive";
import type { BinType } from "@/lib/bins";
import { getSupabase } from "@/lib/supabase";

function rpcError(error: { message?: string } | null): never {
  throw new Error(errorText(error));
}

async function attachItemNames(detail: BinDetail): Promise<BinDetail> {
  const skus = [
    ...new Set(
      detail.cycles.flatMap((cycle) =>
        cycle.events.map((event) => event.sku).filter((sku): sku is string => Boolean(sku)),
      ),
    ),
  ];
  if (skus.length === 0) return detail;
  const { data, error } = await (await getSupabase()).from("items").select("sku, name").in("sku", skus);
  if (error || !data) return detail;
  const names = new Map(
    data.map((row) => [String(row.sku ?? ""), String(row.name ?? "").trim()] as const),
  );
  return {
    ...detail,
    cycles: detail.cycles.map((cycle) => ({
      ...cycle,
      events: cycle.events.map((event) => ({
        ...event,
        itemName: event.itemName ?? (event.sku ? names.get(event.sku) || null : null),
      })),
    })),
  };
}

export async function fetchBinDetail(reference: string): Promise<BinDetail | null> {
  const { data, error } = await (await getSupabase()).rpc("fetch_bin_detail", {
    p_reference: reference,
  });
  if (error) rpcError(error);
  const detail = binDetailFromJson(data);
  if (!detail) return null;
  return attachItemNames(detail);
}

export async function suggestBins(itemId: string, project: string): Promise<BinSuggestion[]> {
  const { data, error } = await (await getSupabase()).rpc("suggest_bins_for_sku", {
    p_item_id: itemId,
    p_project: project.trim() || null,
  });
  if (error) rpcError(error);
  return suggestionsFromJson(data);
}

export async function createReceivingBin(type: BinType, code: string | null): Promise<CreatedBin> {
  const initials = await operatorInitials();
  const { data, error } = await (await getSupabase()).rpc("create_receiving_bin", {
    p_type: type,
    p_code: code,
    p_initials: initials,
  });
  if (error) rpcError(error);
  return createdBinFromJson(data);
}

async function viewerCanSeeMoney(): Promise<boolean> {
  if (!authRequired()) return true;
  const session = await sessionUser();
  if (!session) return false;
  const user = await readAppUser(session.id);
  return Boolean(user && canViewFinancials(user.role));
}

export async function receiveIntoBin(input: {
  reference: string;
  itemId: string;
  qty: number;
  comment: string;
  project: string;
  origin: string;
  incomingTag: string;
  receivedOn: string;
  originQty: number | null;
}): Promise<ReceiptResult> {
  const initials = await operatorInitials();
  const receivedOn = receivingDateToStore(input.receivedOn);
  const { data, error } = await (await getSupabase()).rpc("receive_into_bin", {
    p_reference: input.reference,
    p_item_id: input.itemId,
    p_qty: input.qty,
    p_initials: initials,
    p_comment: input.comment,
    p_project: input.project,
    p_origin: input.origin,
    p_incoming_tag: input.incomingTag,
    p_received_on: receivedOn,
    p_origin_qty: input.originQty,
  });
  if (error) rpcError(error);
  return receiptFromJson(data);
}

export async function listReceivingEntries(
  project: string,
  offset: number,
): Promise<{ rows: ReceivingEntry[]; nextOffset: number | null }> {
  const from = Math.max(0, Math.floor(offset));
  const supabase = await getSupabase();
  const money = await viewerCanSeeMoney();
  const trimmed = project.trim();
  let query = supabase
    .from("stock_events")
    .select(
      "id, received_on, occurred_at, qty, comment, operator_initials, incoming_tag, origin_description, origin_qty, items(sku), bins(reference)",
    )
    .eq("event_type", "receive_into_bin");
  query = trimmed ? query.eq("project", trimmed) : query.is("project", null);
  const { data, error } = await query
    .order("received_on", { ascending: false, nullsFirst: false })
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + RECEIVING_PAGE_SIZE);
  if (error) rpcError(error);
  const raw = Array.isArray(data) ? data : [];
  const page = raw.slice(0, RECEIVING_PAGE_SIZE).map((row) => receivingEntryForViewer(row as Record<string, unknown>, money));
  return {
    rows: page,
    nextOffset: raw.length > RECEIVING_PAGE_SIZE ? from + RECEIVING_PAGE_SIZE : null,
  };
}

export async function moveBinToLocation(reference: string, locationCode: string): Promise<MoveResult> {
  const initials = await operatorInitials();
  const { data, error } = await (await getSupabase()).rpc("move_bin_to_location", {
    p_reference: reference,
    p_location_code: locationCode,
    p_initials: initials,
  });
  if (error) rpcError(error);
  return moveFromJson(data);
}
