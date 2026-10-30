import type { SupabaseClient } from "@supabase/supabase-js";
import { ReconnectError, TokenRequestError } from "@/lib/qbo/auth";
import { companyUrl, type QboConfig } from "@/lib/qbo/config";
import { formatQboError } from "@/lib/qbo/failure";
import { isStaleSyncToken, qboRequest, type QboResult } from "@/lib/qbo/http";
import { finishSyncChunk, openSyncChunk, writeSyncLog } from "@/lib/qbo/log";
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
import {
  addCounts,
  CDC_PAGE,
  countQuery,
  formatPullProgress,
  listQuery,
  nextStart,
  PAGES_PER_CHUNK,
  pageCompletesList,
  readPullCounts,
  readTotalCount,
  recordsReached,
  type SyncChunk,
} from "@/lib/qbo/pull";
import { emptyCounts, formatEntityResult, type EntityCounts, type SyncOptions } from "@/lib/qbo/syncOptions";
import { getServiceSupabase } from "@/lib/supabaseAdmin";

const OVERLAP_MS = 2 * 60 * 1000;

type ContactRecord = ContactFields & { id: string; sync_status: SyncStatus };

export type EntityResult = SyncChunk;

export type SyncReport = {
  entities: EntityResult[];
  message: string;
};

const SELECT_COLUMNS =
  "id, display_name, company_name, given_name, family_name, primary_email, phone, billing_address, shipping_address, tax_id, notes, active, qbo_id, qbo_sync_token, qbo_last_updated, sync_status";

type ChunkLog = { id: string | null };

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
      let done = options.direction === "push";
      let stopped = false;
      let position: number | null = null;
      let total: number | null = null;
      const chunkLog: ChunkLog = { id: null };
      let failureMessage: string | null = null;
      let failureDetail: Record<string, string | number | null> | null = null;
      const direction = options.direction === "push" ? "push" : "pull";
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
          const outcome = await pullKind(
            admin,
            auth.config,
            auth.connection.realm_id,
            box,
            kind,
            options.full,
            startedAt,
            chunkLog,
          );
          Object.assign(counts, addCounts(counts, outcome.counts));
          done = outcome.done;
          position = outcome.position;
          total = outcome.total;
        }
      } catch (error) {
        if (error instanceof ReconnectError || error instanceof TokenRequestError) {
          if (chunkLog.id) {
            await finishSyncChunk(chunkLog.id, {
              entity: kind,
              direction,
              status: "error",
              message: error.message,
              startedAt,
              detail: { intuitTid: error.intuitTid, ...callDetail(error) },
            });
            chunkLog.id = null;
          }
          throw error;
        }
        stopped = true;
        done = false;
        counts.errors += 1;
        const progress = await readCursor(admin, kind).catch(() => null);
        const where = progress?.start_position ? ` before position ${progress.start_position}` : "";
        const reason = error instanceof Error ? error.message : "QuickBooks sync failed.";
        failureMessage = `${qboEntityName(kind)} ${direction} failed${where}. Run sync again to continue. ${reason}`;
        failureDetail = { ...callDetail(error), startPosition: progress?.start_position ?? null };
      }
      results.push({ entity: kind, ...counts, done, stopped, position, total });
      const progressLine =
        position === null ? null : `${formatPullProgress(kind, position, total)}. Pull is still running.`;
      await finishSyncChunk(chunkLog.id, {
        entity: kind,
        direction,
        status: counts.errors > 0 || stopped ? "error" : "ok",
        message:
          failureMessage ??
          (stopped
            ? `${qboEntityName(kind)} ${direction} stopped${position === null ? "" : ` at ${formatPullProgress(kind, position, total)}`}. Run sync again to continue.`
            : done
              ? formatEntityResult(kind, counts)
              : progressLine ?? `${qboEntityName(kind)} pull is still running.`),
        startedAt,
        detail: {
          created: counts.created,
          updated: counts.updated,
          conflicts: counts.conflicts,
          errors: counts.errors,
          position,
          total,
          ...(failureDetail ?? {}),
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

type PullOutcome = {
  done: boolean;
  position: number | null;
  total: number | null;
  counts: EntityCounts;
};

async function ensureChunkLog(
  chunkLog: ChunkLog,
  entry: {
    entity: ContactKind;
    message: string;
    startedAt: string;
    detail: Record<string, string | number | null>;
  },
): Promise<void> {
  if (chunkLog.id) return;
  chunkLog.id = await openSyncChunk({
    entity: entry.entity,
    direction: "pull",
    message: entry.message,
    startedAt: entry.startedAt,
    detail: entry.detail,
  });
}

async function pullKind(
  admin: SupabaseClient,
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  kind: ContactKind,
  full: boolean,
  startedAt: string,
  chunkLog: ChunkLog,
): Promise<PullOutcome> {
  const stored = await readCursor(admin, kind);
  if (stored.start_position !== null || full || !stored.cdc_since) {
    return pullQueryChunk(admin, config, realmId, box, kind, startedAt, stored, chunkLog);
  }
  return pullCdcChunk(admin, config, realmId, box, kind, startedAt, stored, chunkLog);
}

async function pullQueryChunk(
  admin: SupabaseClient,
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  kind: ContactKind,
  startedAt: string,
  stored: StoredCursor,
  chunkLog: ChunkLog,
): Promise<PullOutcome> {
  const name = qboEntityName(kind);
  const startAt = stored.start_position ?? 1;
  const previous = stored.start_position === null ? emptyCounts() : stored.pull_counts ?? emptyCounts();
  const pullStarted = stored.start_position === null ? startedAt : stored.pull_started_at ?? startedAt;
  let total = stored.query_total;
  const seen = Math.max(0, startAt - 1);
  await ensureChunkLog(chunkLog, {
    entity: kind,
    message: `${formatPullProgress(kind, seen, total)}. Pull is still running.`,
    startedAt,
    detail: { position: seen, total, startPosition: startAt },
  });
  if (stored.start_position === null) {
    total = await fetchCount(config, realmId, box, kind);
    await saveProgress(admin, kind, stored, {
      start_position: 1,
      query_total: total,
      resume_since: null,
      pull_started_at: pullStarted,
      pull_counts: emptyCounts(),
    });
  }
  const counts = emptyCounts();
  let start = startAt;
  let position = seen;
  for (let page = 0; page < PAGES_PER_CHUNK; page += 1) {
    const result = await authed<Record<string, unknown>>(
      box,
      "GET",
      companyUrl(config, realmId, "query", { query: listQuery(name, start) }),
    );
    if (!result.ok) throw httpFailure(config, kind, "query", result);
    const reported = readTotalCount(result.data);
    if (reported !== null) total = reported;
    const entities = queryEntities(result.data, name);
    for (const entity of entities) await applyIncoming(admin, kind, entity, counts);
    position = recordsReached(start, entities.length);
    const combined = addCounts(previous, counts);
    if (pageCompletesList(entities.length)) {
      await saveCursor(admin, kind, pullStarted, new Date().toISOString());
      return { done: true, position, total, counts: combined };
    }
    start = nextStart(start, entities.length);
    await saveProgress(admin, kind, stored, {
      start_position: start,
      query_total: total,
      resume_since: null,
      pull_started_at: pullStarted,
      pull_counts: combined,
    });
  }
  return { done: false, position, total, counts: addCounts(previous, counts) };
}

async function fetchCount(
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  kind: ContactKind,
): Promise<number | null> {
  const result = await authed<Record<string, unknown>>(
    box,
    "GET",
    companyUrl(config, realmId, "query", { query: countQuery(qboEntityName(kind)) }),
  );
  if (!result.ok) throw httpFailure(config, kind, "count", result);
  return readTotalCount(result.data);
}

async function pullCdcChunk(
  admin: SupabaseClient,
  config: QboConfig,
  realmId: string,
  box: TokenBox,
  kind: ContactKind,
  startedAt: string,
  stored: StoredCursor,
  chunkLog: ChunkLog,
): Promise<PullOutcome> {
  const watermark = stored.resume_since ?? stored.cdc_since;
  if (!watermark) return pullQueryChunk(admin, config, realmId, box, kind, startedAt, stored, chunkLog);
  const label = kind === "customer" ? "Customers" : "Vendors";
  await ensureChunkLog(chunkLog, {
    entity: kind,
    message: `${label}: still reading changes.`,
    startedAt,
    detail: { position: null, total: null },
  });
  const cursor = stored.resume_since ?? formatQboTime(new Date(Date.parse(watermark) - OVERLAP_MS));
  const previous = stored.resume_since ? stored.pull_counts ?? emptyCounts() : emptyCounts();
  const pullStarted = stored.resume_since ? stored.pull_started_at ?? startedAt : startedAt;
  const counts = emptyCounts();
  const name = qboEntityName(kind);
  const result = await authed<Record<string, unknown>>(
    box,
    "GET",
    companyUrl(config, realmId, "cdc", { entities: name, changedSince: cursor }),
  );
  if (!result.ok) throw httpFailure(config, kind, "CDC", result);
  const entities = cdcEntities(result.data, name);
  let latest = Date.parse(cursor);
  for (const entity of entities) {
    latest = Math.max(latest, await applyIncoming(admin, kind, entity, counts));
  }
  const combined = addCounts(previous, counts);
  const finished = entities.length < CDC_PAGE;
  const next = formatQboTime(new Date((Number.isNaN(latest) ? Date.parse(cursor) : latest) + 1000));
  if (finished || next === cursor) {
    await saveCursor(admin, kind, pullStarted, new Date().toISOString());
    return { done: true, position: null, total: null, counts: combined };
  }
  await saveProgress(admin, kind, stored, {
    start_position: null,
    query_total: null,
    resume_since: next,
    pull_started_at: pullStarted,
    pull_counts: combined,
  });
  return { done: false, position: null, total: null, counts: combined };
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
    if (inserted.error?.code === "23505") {
      const again = await findByQboId(admin, kind, qboId);
      if (!again) {
        counts.errors += 1;
        await writeSyncLog({
          entity: kind,
          direction: "pull",
          status: "error",
          message: "QuickBooks id is already stored, but the row could not be read.",
          detail: { qboId },
        });
      } else {
        const written = await writeFields(admin, kind, again.id, incoming, again.sync_status === "conflict" ? "conflict" : "synced");
        if (!written.ok) {
          counts.errors += 1;
          await writeSyncLog({
            entity: kind,
            direction: "pull",
            status: "error",
            message: written.message,
            detail: { qboId },
          });
        } else {
          counts.updated += 1;
        }
      }
    } else if (inserted.error) {
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

type StoredCursor = {
  cdc_since: string | null;
  last_sync_at: string | null;
  start_position: number | null;
  query_total: number | null;
  resume_since: string | null;
  pull_started_at: string | null;
  pull_counts: EntityCounts | null;
};

const EMPTY_STORED: StoredCursor = {
  cdc_since: null,
  last_sync_at: null,
  start_position: null,
  query_total: null,
  resume_since: null,
  pull_started_at: null,
  pull_counts: null,
};

async function readCursor(admin: SupabaseClient, kind: ContactKind): Promise<StoredCursor> {
  const { data, error } = await admin
    .from("qbo_sync_cursor")
    .select("cdc_since, last_sync_at, start_position, query_total, resume_since, pull_started_at, pull_counts")
    .eq("entity", kind)
    .maybeSingle();
  if (error) {
    if (missingCursorTable(error.message)) {
      const legacy = await legacyCursor(admin);
      return { ...EMPTY_STORED, cdc_since: legacy };
    }
    throw new Error(error.message);
  }
  if (!data) {
    const legacy = await legacyCursor(admin);
    return { ...EMPTY_STORED, cdc_since: legacy };
  }
  const row = data as Record<string, unknown>;
  return {
    cdc_since: typeof row.cdc_since === "string" ? row.cdc_since : null,
    last_sync_at: typeof row.last_sync_at === "string" ? row.last_sync_at : null,
    start_position: typeof row.start_position === "number" && row.start_position >= 1 ? row.start_position : null,
    query_total: typeof row.query_total === "number" && row.query_total >= 0 ? row.query_total : null,
    resume_since: typeof row.resume_since === "string" ? row.resume_since : null,
    pull_started_at: typeof row.pull_started_at === "string" ? row.pull_started_at : null,
    pull_counts: readPullCounts(row.pull_counts),
  };
}

async function saveProgress(
  admin: SupabaseClient,
  kind: ContactKind,
  stored: StoredCursor,
  progress: {
    start_position: number | null;
    query_total: number | null;
    resume_since: string | null;
    pull_started_at: string;
    pull_counts: EntityCounts;
  },
): Promise<void> {
  const { error } = await admin.from("qbo_sync_cursor").upsert(
    {
      entity: kind,
      cdc_since: stored.cdc_since,
      last_sync_at: stored.last_sync_at,
      start_position: progress.start_position,
      query_total: progress.query_total,
      resume_since: progress.resume_since,
      pull_started_at: progress.pull_started_at,
      pull_counts: progress.pull_counts,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "entity" },
  );
  if (error) throw new Error(error.message);
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

async function saveCursor(admin: SupabaseClient, kind: ContactKind, pullStartedAt: string, finishedAt: string): Promise<void> {
  const { error } = await admin.from("qbo_sync_cursor").upsert(
    {
      entity: kind,
      cdc_since: pullStartedAt,
      last_sync_at: finishedAt,
      updated_at: finishedAt,
      start_position: null,
      query_total: null,
      resume_since: null,
      pull_started_at: null,
      pull_counts: null,
    },
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
