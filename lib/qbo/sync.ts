import type { SupabaseClient } from "@supabase/supabase-js";
import { ReconnectError, TokenRequestError } from "@/lib/qbo/auth";
import { companyUrl, type QboConfig } from "@/lib/qbo/config";
import { isStaleSyncToken, qboRequest, type QboResult } from "@/lib/qbo/http";
import { writeSyncLog } from "@/lib/qbo/log";
import { RECONNECT_MESSAGE } from "@/lib/qbo/messages";
import {
  formatQboTime,
  fromQbo,
  isQboDeleted,
  preserveVendorLocalFields,
  qboEntityName,
  qboEntityPath,
  tableFor,
  toQboBody,
  type ContactFields,
  type ContactKind,
  type SyncStatus,
} from "@/lib/qbo/map";
import { forceRefreshAccessToken, validAccessToken } from "@/lib/qbo/oauth";
import { getServiceSupabase } from "@/lib/supabaseAdmin";

const PAGE_SIZE = 100;
const CDC_PAGE = 1000;
const OVERLAP_MS = 2 * 60 * 1000;

type ContactRecord = ContactFields & { id: string; sync_status: SyncStatus };

export type SyncReport = {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: number;
  message: string;
};

const SELECT_COLUMNS =
  "id, display_name, company_name, given_name, family_name, primary_email, phone, billing_address, shipping_address, tax_id, notes, active, qbo_id, qbo_sync_token, qbo_last_updated, sync_status";

let syncing = false;

type TokenBox = { token: string };

async function authed<T>(box: TokenBox, method: "GET" | "POST", url: string, body?: unknown): Promise<QboResult<T>> {
  return qboRequest<T>({
    method,
    url,
    token: box.token,
    body,
    refresh: async () => {
      const next = await forceRefreshAccessToken();
      box.token = next.access_token;
      return next.access_token;
    },
  });
}

export async function runSync(): Promise<SyncReport> {
  if (syncing) throw new Error("A QuickBooks sync is already running.");
  syncing = true;
  const startedAt = new Date().toISOString();
  const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, errors: 0, message: "" };
  try {
    const admin = getServiceSupabase();
    if (!admin) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY on the server.");
    const { config, connection } = await validAccessToken();
    const box: TokenBox = { token: connection.access_token };
    await pushKind(admin, config, connection.realm_id, box, "customer", report);
    const refreshed = await validAccessToken();
    box.token = refreshed.connection.access_token;
    await pushKind(admin, refreshed.config, refreshed.connection.realm_id, box, "vendor", report);
    const pullAuth = await validAccessToken();
    box.token = pullAuth.connection.access_token;
    await pullChanges(admin, pullAuth.config, pullAuth.connection.realm_id, box, startedAt, report);
    report.message = `Pushed ${report.pushed}, pulled ${report.pulled}, conflicts ${report.conflicts}, errors ${report.errors}.`;
    await writeSyncLog({
      entity: "sync",
      direction: "pull",
      status: "ok",
      message: report.message,
      startedAt,
      detail: {
        pushed: report.pushed,
        pulled: report.pulled,
        conflicts: report.conflicts,
        errors: report.errors,
      },
    });
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : "QuickBooks sync failed.";
    report.errors += 1;
    report.message = message === RECONNECT_MESSAGE ? RECONNECT_MESSAGE : message;
    const intuitTid =
      error instanceof ReconnectError || error instanceof TokenRequestError
        ? error.intuitTid
        : error && typeof error === "object" && "intuitTid" in error && (typeof error.intuitTid === "string" || error.intuitTid === null)
          ? error.intuitTid
          : null;
    await writeSyncLog({
      entity: "sync",
      direction: "pull",
      status: "error",
      message: report.message,
      startedAt,
      detail: { intuitTid },
    });
    return report;
  } finally {
    syncing = false;
  }
}

async function pushKind(
  admin: SupabaseClient,
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  kind: ContactKind,
  report: SyncReport,
) {
  const { data, error } = await admin
    .from(tableFor(kind))
    .select(SELECT_COLUMNS)
    .in("sync_status", ["local", "pending", "error"]);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ContactRecord[]) {
    await pushOne(admin, config, realmId, box, kind, row, report);
  }
}

async function pushOne(
  admin: SupabaseClient,
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  kind: ContactKind,
  row: ContactRecord,
  report: SyncReport,
) {
  const name = qboEntityName(kind);
  const path = qboEntityPath(kind);
  const mode = row.qbo_id ? "update" : "create";
  if (mode === "update" && !row.qbo_sync_token) {
    await markError(admin, kind, row, report, "QuickBooks SyncToken is missing, so the update was not sent.");
    return;
  }

  const result = await authed<Record<string, unknown>>(
    box,
    "POST",
    companyUrl(config, realmId, path),
    toQboBody(kind, row, mode),
  );

  if (!result.ok && result.message === RECONNECT_MESSAGE) throw new ReconnectError(result.intuitTid);
  if (!result.ok && isStaleSyncToken(result.code, result.message) && row.qbo_id) {
    await resolveStale(admin, config, realmId, box, kind, row, report, result.message, result.intuitTid);
    return;
  }
  if (!result.ok) {
    await markError(admin, kind, row, report, result.message, result.code, result.status, result.intuitTid);
    return;
  }

  const entity = unwrapEntity(result.data, name);
  if (!entity) {
    await markError(admin, kind, row, report, "QuickBooks did not return the saved record.");
    return;
  }
  try {
    const incoming = preserveVendorLocalFields(kind, fromQbo(kind, entity), row);
    await writeFields(admin, kind, row.id, incoming, "synced");
    report.pushed += 1;
  } catch (error) {
    await markError(
      admin,
      kind,
      row,
      report,
      error instanceof Error ? error.message : "The QuickBooks response could not be saved.",
    );
  }
}

async function resolveStale(
  admin: SupabaseClient,
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  kind: ContactKind,
  row: ContactRecord,
  report: SyncReport,
  message: string,
  intuitTid: string | null,
) {
  const fetched = await authed<Record<string, unknown>>(
    box,
    "GET",
    companyUrl(config, realmId, `${qboEntityPath(kind)}/${encodeURIComponent(row.qbo_id ?? "")}`),
  );
  if (!fetched.ok && fetched.message === RECONNECT_MESSAGE) throw new ReconnectError(fetched.intuitTid);
  if (!fetched.ok) {
    await markError(
      admin,
      kind,
      row,
      report,
      `${message} Refetch failed: ${fetched.message}`,
      fetched.code,
      fetched.status,
      fetched.intuitTid ?? intuitTid,
    );
    return;
  }
  const entity = unwrapEntity(fetched.data, qboEntityName(kind));
  if (!entity) {
    await markError(admin, kind, row, report, `${message} QuickBooks did not return the current record.`);
    return;
  }
  try {
    const incoming = preserveVendorLocalFields(kind, fromQbo(kind, entity), row);
    await writeFields(admin, kind, row.id, incoming, "conflict");
    report.conflicts += 1;
    await writeSyncLog({
      entity: kind,
      direction: "push",
      status: "error",
      message: `SyncToken for ${row.display_name} was stale. The QuickBooks record was kept and the local edit was discarded.`,
      detail: { qboId: row.qbo_id, code: "5010", intuitTid },
    });
  } catch (error) {
    await markError(
      admin,
      kind,
      row,
      report,
      error instanceof Error ? error.message : "The refetched QuickBooks record could not be saved.",
    );
  }
}

async function pullChanges(
  admin: SupabaseClient,
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  startedAt: string,
  report: SyncReport,
) {
  const watermark = await lastFullPull(admin);
  if (!watermark) {
    await pullQuery(admin, config, realmId, box, "customer", report);
    await pullQuery(admin, config, realmId, box, "vendor", report);
    return;
  }
  const changedSince = formatQboTime(new Date(Date.parse(watermark) - OVERLAP_MS));
  let cursor = changedSince;
  for (let page = 0; page < 20; page += 1) {
    const result = await authed<Record<string, unknown>>(
      box,
      "GET",
      companyUrl(config, realmId, "cdc", {
        entities: "Customer,Vendor",
        changedSince: cursor,
      }),
    );
    if (!result.ok) throw httpFailure(result);
    const customers = cdcEntities(result.data, "Customer");
    const vendors = cdcEntities(result.data, "Vendor");
    let latest = Date.parse(cursor);
    for (const entity of customers) {
      latest = Math.max(latest, await applyIncoming(admin, "customer", entity, report));
    }
    for (const entity of vendors) {
      latest = Math.max(latest, await applyIncoming(admin, "vendor", entity, report));
    }
    const hitCap = customers.length >= CDC_PAGE || vendors.length >= CDC_PAGE;
    if (!hitCap) return;
    const next = formatQboTime(new Date(latest + 1000));
    if (next === cursor) return;
    cursor = next;
  }
  await writeSyncLog({
    entity: "sync",
    direction: "pull",
    status: "error",
    message: "CDC stopped after 20 pages. Run sync again to continue.",
    startedAt,
  });
  report.errors += 1;
}

async function pullQuery(
  admin: SupabaseClient,
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  kind: ContactKind,
  report: SyncReport,
) {
  const name = qboEntityName(kind);
  let start = 1;
  for (;;) {
    const result = await authed<Record<string, unknown>>(
      box,
      "GET",
      companyUrl(config, realmId, "query", {
        query: `select * from ${name} where Active in (true, false) startposition ${start} maxresults ${PAGE_SIZE}`,
      }),
    );
    if (!result.ok) throw httpFailure(result);
    const entities = queryEntities(result.data, name);
    for (const entity of entities) await applyIncoming(admin, kind, entity, report);
    if (entities.length < PAGE_SIZE) return;
    start += entities.length;
  }
}

async function applyIncoming(
  admin: SupabaseClient,
  kind: ContactKind,
  value: unknown,
  report: SyncReport,
): Promise<number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const entity = value as Record<string, unknown>;
  const qboId = entity.Id === undefined || entity.Id === null ? "" : String(entity.Id);
  if (!qboId) return 0;
  const existing = await findByQboId(admin, kind, qboId);

  if (isQboDeleted(entity)) {
    if (!existing) return 0;
    const status: SyncStatus = existing.sync_status === "pending" || existing.sync_status === "local" ? "conflict" : "synced";
    const { error } = await admin
      .from(tableFor(kind))
      .update({ active: false, sync_status: status })
      .eq("id", existing.id);
    if (error) {
      report.errors += 1;
      await writeSyncLog({
        entity: kind,
        direction: "pull",
        status: "error",
        message: error.message,
        detail: { qboId },
      });
      return 0;
    }
    if (status === "conflict") report.conflicts += 1;
    else report.pulled += 1;
    await writeSyncLog({
      entity: kind,
      direction: "pull",
      status: status === "conflict" ? "error" : "ok",
      message:
        status === "conflict"
          ? `${existing.display_name} was deleted in QuickBooks. The local edit was discarded and the contact was marked inactive.`
          : `${existing.display_name} was deleted in QuickBooks and marked inactive.`,
      detail: { qboId },
    });
    return 0;
  }

  let incoming: ContactFields;
  try {
    incoming = preserveVendorLocalFields(kind, fromQbo(kind, entity), existing);
  } catch (error) {
    report.errors += 1;
    await writeSyncLog({
      entity: kind,
      direction: "pull",
      status: "error",
      message: error instanceof Error ? error.message : "A QuickBooks record could not be mapped.",
      detail: { qboId },
    });
    return 0;
  }

  const incomingTime = incoming.qbo_last_updated ? Date.parse(incoming.qbo_last_updated) : 0;
  if (!existing) {
    const inserted = await admin.from(tableFor(kind)).insert(dbFields(incoming, "synced"));
    if (inserted.error) {
      report.errors += 1;
      await writeSyncLog({
        entity: kind,
        direction: "pull",
        status: "error",
        message: inserted.error.message,
        detail: { qboId },
      });
    } else {
      report.pulled += 1;
    }
    return Number.isNaN(incomingTime) ? 0 : incomingTime;
  }

  const keepLocal =
    (existing.sync_status === "pending" || existing.sync_status === "local") &&
    !isNewer(incoming.qbo_last_updated, existing.qbo_last_updated);
  if (keepLocal) return Number.isNaN(incomingTime) ? 0 : incomingTime;

  const conflict =
    (existing.sync_status === "pending" || existing.sync_status === "local") &&
    isNewer(incoming.qbo_last_updated, existing.qbo_last_updated);
  const status: SyncStatus =
    existing.sync_status === "conflict" && !isNewer(incoming.qbo_last_updated, existing.qbo_last_updated)
      ? "conflict"
      : conflict
        ? "conflict"
        : "synced";
  if (status === "conflict" && existing.sync_status === "conflict") {
    return Number.isNaN(incomingTime) ? 0 : incomingTime;
  }

  const written = await writeFields(admin, kind, existing.id, incoming, status);
  if (!written.ok) {
    report.errors += 1;
    await writeSyncLog({
      entity: kind,
      direction: "pull",
      status: "error",
      message: written.message,
      detail: { qboId },
    });
    return Number.isNaN(incomingTime) ? 0 : incomingTime;
  }
  if (status === "conflict") {
    report.conflicts += 1;
    await writeSyncLog({
      entity: kind,
      direction: "pull",
      status: "error",
      message: `${existing.display_name} changed in QuickBooks after a local edit. The QuickBooks record was kept.`,
      detail: { qboId },
    });
  } else {
    report.pulled += 1;
  }
  return Number.isNaN(incomingTime) ? 0 : incomingTime;
}

async function markError(
  admin: SupabaseClient,
  kind: ContactKind,
  row: ContactRecord,
  report: SyncReport,
  message: string,
  code?: string | null,
  httpStatus?: number,
  intuitTid?: string | null,
) {
  report.errors += 1;
  await admin.from(tableFor(kind)).update({ sync_status: "error" }).eq("id", row.id);
  await writeSyncLog({
    entity: kind,
    direction: "push",
    status: "error",
    message: `${row.display_name}: ${message}`,
    detail: {
      qboId: row.qbo_id,
      code: code ?? null,
      httpStatus: httpStatus ?? null,
      intuitTid: intuitTid ?? null,
    },
  });
}

function httpFailure(result: { ok: false; message: string; intuitTid: string | null }): Error {
  if (result.message === RECONNECT_MESSAGE) return new ReconnectError(result.intuitTid);
  const error = new Error(result.message) as Error & { intuitTid?: string | null };
  error.intuitTid = result.intuitTid;
  return error;
}

async function writeFields(
  admin: SupabaseClient,
  kind: ContactKind,
  id: string,
  fields: ContactFields,
  status: SyncStatus,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await admin.from(tableFor(kind)).update(dbFields(fields, status)).eq("id", id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

function dbFields(fields: ContactFields, status: SyncStatus) {
  return {
    display_name: fields.display_name,
    company_name: fields.company_name,
    given_name: fields.given_name,
    family_name: fields.family_name,
    primary_email: fields.primary_email,
    phone: fields.phone,
    billing_address: fields.billing_address,
    shipping_address: fields.shipping_address,
    tax_id: fields.tax_id,
    notes: fields.notes,
    active: fields.active,
    qbo_id: fields.qbo_id,
    qbo_sync_token: fields.qbo_sync_token,
    qbo_last_updated: fields.qbo_last_updated,
    sync_status: status,
  };
}

async function findByQboId(
  admin: SupabaseClient,
  kind: ContactKind,
  qboId: string,
): Promise<ContactRecord | null> {
  const { data, error } = await admin
    .from(tableFor(kind))
    .select(SELECT_COLUMNS)
    .eq("qbo_id", qboId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ContactRecord | null) ?? null;
}

async function lastFullPull(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin
    .from("qbo_sync_log")
    .select("started_at")
    .eq("entity", "sync")
    .eq("direction", "pull")
    .eq("status", "ok")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.started_at ?? null;
}

function isNewer(incoming: string | null, stored: string | null): boolean {
  if (!incoming) return false;
  if (!stored) return true;
  const left = Date.parse(incoming);
  const right = Date.parse(stored);
  if (Number.isNaN(left) || Number.isNaN(right)) return true;
  return left > right;
}

function queryEntities(payload: Record<string, unknown>, name: string): unknown[] {
  const response = payload.QueryResponse;
  if (!response || typeof response !== "object" || Array.isArray(response)) return [];
  return asList((response as Record<string, unknown>)[name]);
}

function cdcEntities(payload: Record<string, unknown>, name: string): unknown[] {
  const batches = asList(payload.CDCResponse);
  const found: unknown[] = [];
  for (const batch of batches) {
    if (!batch || typeof batch !== "object") continue;
    const groups = asList((batch as Record<string, unknown>).QueryResponse);
    for (const group of groups) {
      if (!group || typeof group !== "object") continue;
      found.push(...asList((group as Record<string, unknown>)[name]));
    }
  }
  return found;
}

function unwrapEntity(payload: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const value = payload[name];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asList(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
