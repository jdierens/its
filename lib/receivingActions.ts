"use server";

import { authRequired } from "@/lib/authRequired";
import { readAppUser } from "@/lib/appUserRecord";
import { errorText } from "@/lib/errors";
import { canViewFinancials } from "@/lib/export/access";
import { searchItemsForLabel } from "@/lib/labelLookupServer";
import type { LabelItem } from "@/lib/types";
import { scanTokensInSearchOrder } from "@/lib/receivingScan";
import {
  RECENT_PROJECT_SCAN,
  distinctRecentProjects,
  recentProjectStorageKey,
  type RecentProjectRow,
} from "@/lib/receivingProjects";
import {
  RECEIVING_PAGE_SIZE,
  parseReceiptDate,
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

function missingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42P01";
}

function missingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST204" || error.code === "42703";
}

const RECEIPT_COLUMNS =
  "id, received_on, occurred_at, project, incoming_tag, origin_description, origin_qty, sku, item_name, item_id, qty, comment, operator_initials, edited, editor_initials";

const RECEIPT_LINE_COLUMNS =
  `${RECEIPT_COLUMNS}, cleaned, wiped, short_code, long_code, taxonomy_name, bin_reference, location_code`;

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

export async function receivingClerkInitials(): Promise<string> {
  return operatorInitials();
}

export type RecentReceivingProjects = {
  storageKey: string;
  projects: string[];
  latest: string | null;
};

export async function recentReceivingProjects(): Promise<RecentReceivingProjects> {
  const initials = await operatorInitials();
  const session = authRequired() ? await sessionUser() : null;
  const storageKey = recentProjectStorageKey(session?.id ?? null, initials);
  const projects = await projectsForOperator(initials);
  return { storageKey, projects, latest: projects[0] ?? null };
}

async function projectsForOperator(initials: string): Promise<string[]> {
  const supabase = await getSupabase();
  const viewed = await supabase
    .from("receipt_lines")
    .select("project")
    .eq("operator_initials", initials)
    .order("received_on", { ascending: false, nullsFirst: false })
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RECENT_PROJECT_SCAN);
  if (!viewed.error) return distinctRecentProjects((viewed.data ?? []) as RecentProjectRow[]);
  if (!missingSchema(viewed.error)) rpcError(viewed.error);
  const legacy = await supabase
    .from("stock_events")
    .select("project")
    .eq("event_type", "receive_into_bin")
    .eq("operator_initials", initials)
    .order("received_on", { ascending: false, nullsFirst: false })
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RECENT_PROJECT_SCAN);
  if (legacy.error) rpcError(legacy.error);
  return distinctRecentProjects((legacy.data ?? []) as RecentProjectRow[]);
}

export type ReceivingScanResult = {
  scanRaw: string;
  token: string | null;
  tried: string[];
  exact: LabelItem | null;
  matches: LabelItem[];
  truncated: boolean;
};

export async function searchReceivingScan(raw: string): Promise<ReceivingScanResult> {
  const scanRaw = raw.trim().slice(0, 500);
  const tokens = scanTokensInSearchOrder(scanRaw).slice(0, 8);
  if (tokens.length === 0) {
    return { scanRaw, token: null, tried: [], exact: null, matches: [], truncated: false };
  }
  const tried: string[] = [];
  for (const token of tokens) {
    tried.push(token);
    const result = await searchItemsForLabel(token.slice(0, 200));
    if (result.exact || result.matches.length > 0) {
      return { scanRaw, token, tried, exact: result.exact, matches: result.matches, truncated: result.truncated };
    }
  }
  return { scanRaw, token: tokens[0] ?? null, tried, exact: null, matches: [], truncated: false };
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
  clientRequestId: string;
  scanRaw?: string | null;
  cleaned?: boolean | null;
  wiped?: boolean | null;
}): Promise<ReceiptResult> {
  const initials = await operatorInitials();
  const receivedOn = receivingDateToStore(input.receivedOn);
  const supabase = await getSupabase();
  const payload = {
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
    p_client_request_id: input.clientRequestId,
    p_scan_raw: input.scanRaw?.trim() || null,
    p_cleaned: input.cleaned ?? null,
    p_wiped: input.wiped ?? null,
  };
  let { data, error } = await supabase.rpc("receive_into_bin", payload);
  if (error && (missingSchema(error) || missingColumn(error))) {
    const { p_cleaned: _cleaned, p_wiped: _wiped, ...withoutFlags } = payload;
    ({ data, error } = await supabase.rpc("receive_into_bin", withoutFlags));
  }
  if (error && missingSchema(error)) {
    const { p_scan_raw: _scan, ...legacy } = {
      p_reference: payload.p_reference,
      p_item_id: payload.p_item_id,
      p_qty: payload.p_qty,
      p_initials: payload.p_initials,
      p_comment: payload.p_comment,
      p_project: payload.p_project,
      p_origin: payload.p_origin,
      p_incoming_tag: payload.p_incoming_tag,
      p_received_on: payload.p_received_on,
      p_origin_qty: payload.p_origin_qty,
      p_client_request_id: payload.p_client_request_id,
      p_scan_raw: payload.p_scan_raw,
    };
    ({ data, error } = await supabase.rpc("receive_into_bin", legacy));
  }
  if (error) rpcError(error);
  return receiptFromJson(data);
}

export async function editReceipt(input: {
  eventId: string;
  receivedOn: string;
  project: string;
  incomingTag: string;
  origin: string;
  originQty: number | null;
  comment: string;
  qty: number;
  itemId: string;
  confirmed: boolean;
  cleaned?: boolean | null;
  wiped?: boolean | null;
}): Promise<void> {
  const initials = await operatorInitials();
  if (!/^[A-Z]{2}$/.test(initials)) throw new Error("Operator initials must be 2 letters.");
  const receivedOn = parseReceiptDate(input.receivedOn);
  const supabase = await getSupabase();
  const payload = {
    p_event_id: input.eventId,
    p_initials: initials,
    p_received_on: receivedOn,
    p_project: input.project,
    p_incoming_tag: input.incomingTag,
    p_origin: input.origin,
    p_origin_qty: input.originQty,
    p_comment: input.comment,
    p_qty: input.qty,
    p_item_id: input.itemId,
    p_confirmed: input.confirmed,
    p_cleaned: input.cleaned ?? null,
    p_wiped: input.wiped ?? null,
  };
  let { error } = await supabase.rpc("edit_receipt", payload);
  if (error && (missingSchema(error) || missingColumn(error))) {
    const { p_cleaned: _cleaned, p_wiped: _wiped, ...legacy } = payload;
    ({ error } = await supabase.rpc("edit_receipt", legacy));
  }
  if (error) rpcError(error);
}

export async function listReceivingEntries(
  project: string,
  offset: number,
): Promise<{ rows: ReceivingEntry[]; nextOffset: number | null }> {
  const from = Math.max(0, Math.floor(offset));
  const supabase = await getSupabase();
  const money = await viewerCanSeeMoney();
  const trimmed = project.trim();
  const receiptPage = (columns: string) => {
    let viewed = supabase.from("receipt_lines").select(columns);
    viewed = trimmed ? viewed.eq("project", trimmed) : viewed.is("project", null);
    return viewed
      .order("received_on", { ascending: false, nullsFirst: false })
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + RECEIVING_PAGE_SIZE);
  };
  let corrected = await receiptPage(RECEIPT_LINE_COLUMNS);
  if (corrected.error && missingColumn(corrected.error)) corrected = await receiptPage(RECEIPT_COLUMNS);
  if (!corrected.error) {
    const raw = Array.isArray(corrected.data) ? corrected.data : [];
    const page = raw
      .slice(0, RECEIVING_PAGE_SIZE)
      .map((row) => receivingEntryForViewer(row as unknown as Record<string, unknown>, money));
    return {
      rows: page,
      nextOffset: raw.length > RECEIVING_PAGE_SIZE ? from + RECEIVING_PAGE_SIZE : null,
    };
  }
  if (!missingSchema(corrected.error)) rpcError(corrected.error);
  let query = supabase
    .from("stock_events")
    .select(
      "id, item_id, received_on, occurred_at, project, qty, comment, operator_initials, incoming_tag, origin_description, origin_qty, items(sku, name)",
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
