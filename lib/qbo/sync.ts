import type { SupabaseClient } from "@supabase/supabase-js";
import { ReconnectError, TokenRequestError } from "@/lib/qbo/auth";
import { companyUrl, type QboConfig } from "@/lib/qbo/config";
import { formatQboError } from "@/lib/qbo/failure";
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
import { emptyCounts, formatEntityResult, type EntityCounts, type SyncOptions } from "@/lib/qbo/syncOptions";
import { getServiceSupabase } from "@/lib/supabaseAdmin";

const PAGE_SIZE = 100;
const CDC_PAGE = 1000;
const OVERLAP_MS = 2 * 60 * 1000;

type ContactRecord = ContactFields & { id: string; sync_status: SyncStatus };

export type EntityResult = EntityCounts & { entity: ContactKind };

export type SyncReport = {
  entities: EntityResult[];
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

export async function runSync(options: SyncOptions): Promise<SyncReport> {
  if (syncing) throw new Error("A QuickBooks sync is already running.");
  syncing = true;
  const startedAt = new Date().toISOString();
  const results: EntityResult[] = [];
  try {
    const admin = getServiceSupabase();
    if (!admin) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY on the server.");
    const initial = await validAccessToken();
    const box: TokenBox = { token: initial.connection.access_token };
    for (const kind of options.entities) {
      const counts = emptyCounts();
      try {
        if (options.direction !== "pull") {
          const auth = await validAccessToken();
          box.token = auth.connection.access_token;
          await pushKind(admin, auth.config, auth.connection.realm_id, box, kind, counts);
          await touchLastSync(admin, kind, startedAt);
        }
        if (options.direction !== "push") {
          const auth = await validAccessToken();
          box.token = auth.connection.access_token;
          const complete = await pullKind(
            admin,
            auth.config,
            auth.connection.realm_id,
            box,
            kind,
            options.full,
            startedAt,
            counts,
          );
          if (complete) await saveCursor(admin, kind, startedAt);
          else await touchLastSync(admin, kind, startedAt);
        }
      } catch (error) {
        if (error instanceof ReconnectError || error instanceof TokenRequestError) throw error;
        counts.errors += 1;
        await writeSyncLog({
          entity: kind,
          direction: options.direction === "push" ? "push" : "pull",
          status: "error",
          message: error instanceof Error ? error.message : "QuickBooks sync failed.",
          startedAt,
          detail: callDetail(error),
        });
      }
      results.push({ entity: kind, ...counts });
      await writeSyncLog({
        entity: kind,
        direction: options.direction === "push" ? "push" : "pull",
        status: counts.errors > 0 ? "error" : "ok",
        message: formatEntityResult(kind, counts),
        startedAt,
        detail: {
          created: counts.created,
          updated: counts.updated,
          conflicts: counts.conflicts,
          errors: counts.errors,
        },
      });
    }
    return { entities: results, message: results.map((result) => formatEntityResult(result.entity, result)).join(" ") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "QuickBooks sync failed.";
    const intuitTid =
      error instanceof ReconnectError || error instanceof TokenRequestError
        ? error.intuitTid
        : error && typeof error === "object" && "intuitTid" in error && (typeof error.intuitTid === "string" || error.intuitTid === null)
          ? error.intuitTid
          : null;
    await writeSyncLog({
      entity: "sync",
      direction: options.direction === "push" ? "push" : "pull",
      status: "error",
      message: message === RECONNECT_MESSAGE ? RECONNECT_MESSAGE : message,
      startedAt,
      detail: { intuitTid, ...callDetail(error) },
    });
    return {
      entities: results,
      message: message === RECONNECT_MESSAGE ? RECONNECT_MESSAGE : message,
    };
  } finally {
    syncing = false;
  }
}

function callDetail(error: unknown): Record<string, string | number | null> {
  if (!error || typeof error !== "object") return {};
  const record = error as { httpStatus?: unknown; code?: unknown; intuitTid?: unknown; request?: unknown };
  return {
    httpStatus: typeof record.httpStatus === "number" ? record.httpStatus : null,
    code: typeof record.code === "string" ? record.code : null,
    intuitTid: typeof record.intuitTid === "string" ? record.intuitTid : null,
    request: typeof record.request === "string" ? record.request : null,
  };
}

async function pushKind(
  admin: SupabaseClient,
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  kind: ContactKind,
  counts: EntityCounts,
) {
  const { data, error } = await admin
    .from(tableFor(kind))
    .select(SELECT_COLUMNS)
    .in("sync_status", ["local", "pending", "error"]);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ContactRecord[]) {
    await pushOne(admin, config, realmId, box, kind, row, counts);
  }
}

async function pushOne(
  admin: SupabaseClient,
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  kind: ContactKind,
  row: ContactRecord,
  counts: EntityCounts,
) {
  const name = qboEntityName(kind);
  const path = qboEntityPath(kind);
  const mode = row.qbo_id ? "update" : "create";
  if (mode === "update" && !row.qbo_sync_token) {
    await markError(admin, config, kind, row, counts, "QuickBooks SyncToken is missing, so the update was not sent.");
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
    await resolveStale(admin, config, realmId, box, kind, row, counts, result.message, result.intuitTid);
    return;
  }
  if (!result.ok) {
    await markError(admin, config, kind, row, counts, result.message, {
      request: mode,
      code: result.code,
      status: result.status,
      intuitTid: result.intuitTid,
      refreshed: result.refreshed,
    });
    return;
  }

  const entity = unwrapEntity(result.data, name);
  if (!entity) {
    await markError(admin, config, kind, row, counts, "QuickBooks did not return the saved record.");
    return;
  }
  try {
    const incoming = preserveVendorLocalFields(kind, fromQbo(kind, entity), row);
    await writeFields(admin, kind, row.id, incoming, "synced");
    if (mode === "create") counts.created += 1;
    else counts.updated += 1;
  } catch (error) {
    await markError(
      admin,
      config,
      kind,
      row,
      counts,
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
  counts: EntityCounts,
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
      config,
      kind,
      row,
      counts,
      `${message} Refetch failed: ${fetched.message}`,
      {
        request: "refetch",
        code: fetched.code,
        status: fetched.status,
        intuitTid: fetched.intuitTid ?? intuitTid,
        refreshed: fetched.refreshed,
      },
    );
    return;
  }
  const entity = unwrapEntity(fetched.data, qboEntityName(kind));
  if (!entity) {
    await markError(admin, config, kind, row, counts, `${message} QuickBooks did not return the current record.`);
    return;
  }
  try {
    const incoming = preserveVendorLocalFields(kind, fromQbo(kind, entity), row);
    await writeFields(admin, kind, row.id, incoming, "conflict");
    counts.conflicts += 1;
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
      config,
      kind,
      row,
      counts,
      error instanceof Error ? error.message : "The refetched QuickBooks record could not be saved.",
    );
  }
}

async function pullKind(
  admin: SupabaseClient,
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  kind: ContactKind,
  full: boolean,
  startedAt: string,
  counts: EntityCounts,
): Promise<boolean> {
  const watermark = full ? null : await entityCursor(admin, kind);
  if (!watermark) {
    await pullQuery(admin, config, realmId, box, kind, counts);
    return true;
  }
  const changedSince = formatQboTime(new Date(Date.parse(watermark) - OVERLAP_MS));
  let cursor = changedSince;
  const name = qboEntityName(kind);
  for (let page = 0; page < 20; page += 1) {
    const result = await authed<Record<string, unknown>>(
      box,
      "GET",
      companyUrl(config, realmId, "cdc", {
        entities: name,
        changedSince: cursor,
      }),
    );
    if (!result.ok) throw httpFailure(config, kind, "CDC", result);
    const entities = cdcEntities(result.data, name);
    let latest = Date.parse(cursor);
    for (const entity of entities) {
      latest = Math.max(latest, await applyIncoming(admin, kind, entity, counts));
    }
    if (entities.length < CDC_PAGE) return true;
    const next = formatQboTime(new Date(latest + 1000));
    if (next === cursor) return true;
    cursor = next;
  }
  counts.errors += 1;
  await writeSyncLog({
    entity: kind,
    direction: "pull",
    status: "error",
    message: `${qboEntityName(kind)} CDC stopped after 20 pages. Run sync again to continue. The change cursor was left where it was.`,
    startedAt,
  });
  return false;
}

async function pullQuery(
  admin: SupabaseClient,
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  kind: ContactKind,
  counts: EntityCounts,
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
    if (!result.ok) throw httpFailure(config, kind, "query", result);
    const entities = queryEntities(result.data, name);
    for (const entity of entities) await applyIncoming(admin, kind, entity, counts);
    if (entities.length < PAGE_SIZE) return;
    start += entities.length;
  }
}

async function applyIncoming(
  admin: SupabaseClient,
  kind: ContactKind,
  value: unknown,
  counts: EntityCounts,
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
      counts.errors += 1;
      await writeSyncLog({
        entity: kind,
        direction: "pull",
        status: "error",
        message: error.message,
        detail: { qboId },
      });
      return 0;
    }
    if (status === "conflict") counts.conflicts += 1;
    else counts.updated += 1;
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
    counts.errors += 1;
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
      counts.errors += 1;
      await writeSyncLog({
        entity: kind,
        direction: "pull",
        status: "error",
        message: inserted.error.message,
        detail: { qboId },
      });
    } else {
      counts.created += 1;
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
    counts.errors += 1;
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
    counts.conflicts += 1;
    await writeSyncLog({
      entity: kind,
      direction: "pull",
      status: "error",
      message: `${existing.display_name} changed in QuickBooks after a local edit. The QuickBooks record was kept.`,
      detail: { qboId },
    });
  } else {
    counts.updated += 1;
  }
  return Number.isNaN(incomingTime) ? 0 : incomingTime;
}

type FailureMeta = {
  request: string;
  code: string | null;
  status: number;
  intuitTid: string | null;
  refreshed: boolean;
};

async function markError(
  admin: SupabaseClient,
  config: QboConfig,
  kind: ContactKind,
  row: ContactRecord,
  counts: EntityCounts,
  message: string,
  failure?: FailureMeta,
) {
  counts.errors += 1;
  const text = failure
    ? formatQboError({
        subject: `${qboEntityName(kind)} ${failure.request} for ${row.display_name}`,
        status: failure.status,
        code: failure.code,
        message,
        intuitTid: failure.intuitTid,
        environment: config.environment,
        refreshed: failure.refreshed,
      })
    : `${row.display_name}: ${message}`;
  await admin.from(tableFor(kind)).update({ sync_status: "error" }).eq("id", row.id);
  await writeSyncLog({
    entity: kind,
    direction: "push",
    status: "error",
    message: text,
    detail: {
      qboId: row.qbo_id,
      code: failure?.code ?? null,
      httpStatus: failure?.status ?? null,
      intuitTid: failure?.intuitTid ?? null,
      request: failure?.request ?? null,
    },
  });
}

function httpFailure(
  config: QboConfig,
  kind: ContactKind,
  request: string,
  result: {
    ok: false;
    status: number;
    message: string;
    code: string | null;
    intuitTid: string | null;
    refreshed: boolean;
  },
): Error {
  if (result.message === RECONNECT_MESSAGE) return new ReconnectError(result.intuitTid);
  const error = new Error(
    formatQboError({
      subject: `${qboEntityName(kind)} ${request}`,
      status: result.status,
      code: result.code,
      message: result.message,
      intuitTid: result.intuitTid,
      environment: config.environment,
      refreshed: result.refreshed,
    }),
  ) as Error & { intuitTid?: string | null; httpStatus?: number; code?: string | null; request?: string };
  error.intuitTid = result.intuitTid;
  error.httpStatus = result.status;
  error.code = result.code;
  error.request = request;
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

async function entityCursor(admin: SupabaseClient, kind: ContactKind): Promise<string | null> {
  const { data, error } = await admin
    .from("qbo_sync_cursor")
    .select("cdc_since")
    .eq("entity", kind)
    .maybeSingle();
  if (error) {
    if (missingCursorTable(error.message)) return legacyCursor(admin);
    throw new Error(error.message);
  }
  if (data) return (data.cdc_since as string | null) ?? null;
  return legacyCursor(admin);
}

async function legacyCursor(admin: SupabaseClient): Promise<string | null> {
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

async function saveCursor(admin: SupabaseClient, kind: ContactKind, startedAt: string): Promise<void> {
  const { error } = await admin.from("qbo_sync_cursor").upsert(
    { entity: kind, cdc_since: startedAt, last_sync_at: startedAt, updated_at: startedAt },
    { onConflict: "entity" },
  );
  if (error) throw new Error(error.message);
}

async function touchLastSync(admin: SupabaseClient, kind: ContactKind, startedAt: string): Promise<void> {
  const existing = await admin.from("qbo_sync_cursor").select("cdc_since").eq("entity", kind).maybeSingle();
  if (existing.error) {
    if (missingCursorTable(existing.error.message)) return;
    throw new Error(existing.error.message);
  }
  const { error } = await admin.from("qbo_sync_cursor").upsert(
    {
      entity: kind,
      cdc_since: (existing.data?.cdc_since as string | null | undefined) ?? null,
      last_sync_at: startedAt,
      updated_at: startedAt,
    },
    { onConflict: "entity" },
  );
  if (error) throw new Error(error.message);
}

function missingCursorTable(message: string): boolean {
  return /qbo_sync_cursor/i.test(message) && /does not exist|schema cache|could not find/i.test(message);
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
