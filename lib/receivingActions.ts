"use server";

import { authRequired } from "@/lib/authRequired";
import { readAppUser } from "@/lib/appUserRecord";
import { errorText } from "@/lib/errors";
import { labelTaxonomyFields } from "@/lib/labelLookup";
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
  applyReceiptColumns,
  binDetailFromJson,
  createdBinFromJson,
  moveFromJson,
  receiptFromJson,
  suggestionsFromJson,
  type BinDetail,
  type ReceiptColumnRow,
  type BinSuggestion,
  type CreatedBin,
  type MoveResult,
  type ReceiptResult,
} from "@/lib/stockReceive";
import type { BinType } from "@/lib/bins";
import { lastPutawayBinReference } from "@/lib/receivingLine";
import { RECENT_ORIGIN_SCAN, distinctRecentOrigins } from "@/lib/receivingOrigins";
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

const RECEIPT_SEARCH_COLUMNS = `${RECEIPT_LINE_COLUMNS}, search_query`;

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

function receiptColumnRows(data: unknown): ReceiptColumnRow[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object").map((row) => {
    const originQty = row.origin_qty == null || row.origin_qty === "" ? null : Number(row.origin_qty);
    const qty = row.qty == null || row.qty === "" ? null : Number(row.qty);
    const text = (value: unknown) => {
      if (value == null) return null;
      const trimmed = String(value).trim();
      return trimmed ? trimmed : null;
    };
    return {
      id: String(row.id ?? ""),
      receivedOn: text(row.received_on),
      project: text(row.project),
      incomingTag: text(row.incoming_tag),
      originDescription: text(row.origin_description),
      originQty: originQty != null && Number.isFinite(originQty) ? originQty : null,
      sku: text(row.sku),
      itemName: text(row.item_name),
      qty: qty != null && Number.isFinite(qty) ? qty : null,
      comment: text(row.comment),
      operatorInitials: text(row.operator_initials),
    };
  }).filter((row) => row.id);
}

async function attachContentLabels(detail: BinDetail): Promise<BinDetail> {
  const ids = [...new Set(detail.contents.map((row) => row.itemId).filter(Boolean))];
  if (ids.length === 0) return detail;
  const { data, error } = await (await getSupabase()).from("items").select("id, description, taxonomies(short_code)").in("id", ids);
  if (error || !data) return detail;
  const byId = new Map(
    data.map((row) => {
      const record = row as { id?: string; description?: string | null; taxonomies?: unknown };
      return [String(record.id ?? ""), { description: String(record.description ?? ""), shortCode: labelTaxonomyFields(record.taxonomies).shortCode }] as const;
    }),
  );
  return {
    ...detail,
    contents: detail.contents.map((row) => {
      const extra = byId.get(row.itemId);
      if (!extra) return row;
      return { ...row, description: extra.description, shortCode: extra.shortCode };
    }),
  };
}

const RECEIPT_OVERLAY_COLUMNS =
  "id, received_on, project, incoming_tag, origin_description, origin_qty, sku, item_name, qty, comment, operator_initials";

async function attachReceiptColumns(detail: BinDetail): Promise<BinDetail> {
  const ids = detail.cycles.flatMap((cycle) =>
    cycle.events.filter((event) => event.eventType === "receive_into_bin").map((event) => event.id),
  );
  if (ids.length === 0) return detail;
  const supabase = await getSupabase();
  const viewed = await supabase.from("receipt_lines").select(`${RECEIPT_OVERLAY_COLUMNS}, bin_reference`).eq("bin_reference", detail.reference);
  if (!viewed.error) return applyReceiptColumns(detail, receiptColumnRows(viewed.data));
  if (viewed.error && missingColumn(viewed.error)) {
    const older = await supabase.from("receipt_lines").select(RECEIPT_OVERLAY_COLUMNS).in("id", ids);
    if (!older.error) return applyReceiptColumns(detail, receiptColumnRows(older.data));
    if (!missingSchema(older.error) && !missingColumn(older.error)) return detail;
  } else if (!missingSchema(viewed.error)) {
    return detail;
  }
  const legacy = await supabase
    .from("stock_events")
    .select("id, received_on, project, incoming_tag, origin_description, origin_qty, qty, comment, operator_initials")
    .in("id", ids);
  if (legacy.error || !legacy.data) return detail;
  return applyReceiptColumns(detail, receiptColumnRows(legacy.data));
}

export async function fetchBinDetail(reference: string): Promise<BinDetail | null> {
  const { data, error } = await (await getSupabase()).rpc("fetch_bin_detail", {
    p_reference: reference,
  });
  if (error) rpcError(error);
  const detail = binDetailFromJson(data);
  if (!detail) return null;
  const named = await attachItemNames(detail);
  const labeled = await attachContentLabels(named);
  return attachReceiptColumns(labeled);
}

/** Most recent receive of this item, on any project. Blank when it has never been put away. */
export async function lastPutawayBin(itemId: string): Promise<string | null> {
  const id = itemId.trim();
  if (!id) return null;
  const supabase = await getSupabase();
  const viewed = await supabase
    .from("receipt_lines")
    .select("bin_reference")
    .eq("item_id", id)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (!viewed.error) {
    const row = Array.isArray(viewed.data) ? viewed.data[0] : null;
    return lastPutawayBinReference(row ?? null);
  }
  if (!missingColumn(viewed.error) && !missingSchema(viewed.error)) rpcError(viewed.error);
  const legacy = await supabase
    .from("stock_events")
    .select("bins(reference)")
    .eq("event_type", "receive_into_bin")
    .eq("item_id", id)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (legacy.error) {
    if (missingSchema(legacy.error)) return null;
    rpcError(legacy.error);
  }
  const row = Array.isArray(legacy.data) ? legacy.data[0] : null;
  return lastPutawayBinReference(row ?? null);
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

export async function recentReceivingOrigins(): Promise<string[]> {
  const supabase = await getSupabase();
  const viewed = await supabase
    .from("receipt_lines")
    .select("origin_description")
    .order("received_on", { ascending: false, nullsFirst: false })
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RECENT_ORIGIN_SCAN);
  if (!viewed.error) return distinctRecentOrigins((viewed.data ?? []) as { origin_description?: string | null }[]);
  if (!missingSchema(viewed.error)) rpcError(viewed.error);
  const legacy = await supabase
    .from("stock_events")
    .select("origin_description")
    .eq("event_type", "receive_into_bin")
    .order("received_on", { ascending: false, nullsFirst: false })
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RECENT_ORIGIN_SCAN);
  if (legacy.error) rpcError(legacy.error);
  return distinctRecentOrigins((legacy.data ?? []) as { origin_description?: string | null }[]);
}

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
  searchQuery?: string | null;
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
    p_search_query: input.searchQuery?.trim().slice(0, 500) || null,
    p_cleaned: input.cleaned ?? null,
    p_wiped: input.wiped ?? null,
  };
  let { data, error } = await supabase.rpc("receive_into_bin", payload);
  if (error && (missingSchema(error) || missingColumn(error))) {
    const { p_search_query: _search, ...withoutSearch } = payload;
    ({ data, error } = await supabase.rpc("receive_into_bin", withoutSearch));
  }
  if (error && (missingSchema(error) || missingColumn(error))) {
    const { p_cleaned: _cleaned, p_wiped: _wiped, p_search_query: _search, ...withoutFlags } = payload;
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
  searchQuery?: string | null;
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
    p_search_query: input.searchQuery?.trim().slice(0, 500) || null,
  };
  let { error } = await supabase.rpc("edit_receipt", payload);
  if (error && (missingSchema(error) || missingColumn(error))) {
    const { p_search_query: _search, ...withoutSearch } = payload;
    ({ error } = await supabase.rpc("edit_receipt", withoutSearch));
  }
  if (error && (missingSchema(error) || missingColumn(error))) {
    const { p_cleaned: _cleaned, p_wiped: _wiped, p_search_query: _search, ...legacy } = payload;
    ({ error } = await supabase.rpc("edit_receipt", legacy));
  }
  if (error) rpcError(error);
}

export async function listReceivingEntries(
  project: string,
  offset: number,
): Promise<{ rows: ReceivingEntry[]; total: number }> {
  const from = Math.max(0, Math.floor(offset));
  const to = from + RECEIVING_PAGE_SIZE - 1;
  const supabase = await getSupabase();
  const money = await viewerCanSeeMoney();
  const trimmed = project.trim();
  const receiptPage = (columns: string) => {
    let viewed = supabase.from("receipt_lines").select(columns, { count: "exact" });
    viewed = trimmed ? viewed.eq("project", trimmed) : viewed.is("project", null);
    return viewed
      .order("received_on", { ascending: false, nullsFirst: false })
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
  };
  let corrected = await receiptPage(RECEIPT_SEARCH_COLUMNS);
  if (corrected.error && missingColumn(corrected.error)) corrected = await receiptPage(RECEIPT_LINE_COLUMNS);
  if (corrected.error && missingColumn(corrected.error)) corrected = await receiptPage(RECEIPT_COLUMNS);
  if (!corrected.error) {
    const raw = Array.isArray(corrected.data) ? corrected.data : [];
    const page = raw.map((row) => receivingEntryForViewer(row as unknown as Record<string, unknown>, money));
    return { rows: page, total: corrected.count ?? page.length };
  }
  if (!missingSchema(corrected.error)) rpcError(corrected.error);
  let query = supabase
    .from("stock_events")
    .select(
      "id, item_id, received_on, occurred_at, project, qty, comment, operator_initials, incoming_tag, origin_description, origin_qty, items(sku, name)",
      { count: "exact" },
    )
    .eq("event_type", "receive_into_bin");
  query = trimmed ? query.eq("project", trimmed) : query.is("project", null);
  const { data, error, count } = await query
    .order("received_on", { ascending: false, nullsFirst: false })
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  if (error) rpcError(error);
  const raw = Array.isArray(data) ? data : [];
  const page = raw.map((row) => receivingEntryForViewer(row as Record<string, unknown>, money));
  return { rows: page, total: count ?? page.length };
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
