import { NextResponse } from "next/server";
import { readQboConfig } from "@/lib/qbo/config";
import { chunkPhaseUnavailable } from "@/lib/qbo/logShape";
import { connectionStatus } from "@/lib/qbo/oauth";
import { getSupabase } from "@/lib/supabase";
import { getServiceSupabase } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LogRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  entity: string;
  direction: string;
  status: string;
  phase?: string | null;
  message: string | null;
};

export async function GET() {
  const config = readQboConfig();
  const serviceRole = Boolean(getServiceSupabase());
  let connected = false;
  let needsReconnect = false;
  let realmId: string | null = null;
  let expiresAt: string | null = null;
  let message: string | null = null;

  if (!serviceRole) {
    message = "Set SUPABASE_SERVICE_ROLE_KEY on the server to read the QuickBooks connection.";
  } else {
    try {
      const status = await connectionStatus();
      connected = status.connected;
      needsReconnect = status.needsReconnect;
      realmId = status.realmId;
      expiresAt = status.expiresAt;
    } catch (error) {
      message = error instanceof Error ? error.message : "Could not read the QuickBooks connection.";
    }
  }

  const logs = await readLogs();
  const lastSync = await readCursors();
  const lastSyncAt = latest(lastSync.customer, lastSync.vendor) ?? logs.find((entry) => entry.entity === "sync")?.startedAt ?? null;

  return NextResponse.json(
    {
      configured: Boolean(config),
      environment: config?.environment ?? null,
      redirectUri: config?.redirectUri ?? null,
      serviceRole,
      connected,
      needsReconnect,
      realmId,
      expiresAt,
      lastSyncAt,
      lastSync,
      message,
      logs,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function readCursors(): Promise<{ customer: string | null; vendor: string | null }> {
  const empty = { customer: null, vendor: null };
  const admin = getServiceSupabase();
  if (!admin) return empty;
  const { data, error } = await admin.from("qbo_sync_cursor").select("entity, last_sync_at");
  if (error || !data) return empty;
  const lastSync: { customer: string | null; vendor: string | null } = { ...empty };
  for (const row of data as { entity?: unknown; last_sync_at?: unknown }[]) {
    const entity = row.entity === "customer" || row.entity === "vendor" ? row.entity : null;
    if (!entity) continue;
    lastSync[entity] = typeof row.last_sync_at === "string" ? row.last_sync_at : null;
  }
  return lastSync;
}

function latest(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

const LOG_COLUMNS = "id, started_at, finished_at, entity, direction, status, message";

async function readLogs() {
  try {
    const supabase = await getSupabase();
    const withPhase = await supabase
      .from("qbo_sync_log")
      .select(`${LOG_COLUMNS}, phase`)
      .order("created_at", { ascending: false })
      .limit(20);
    if (withPhase.error && chunkPhaseUnavailable(withPhase.error.message)) {
      const plain = await supabase
        .from("qbo_sync_log")
        .select(LOG_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(20);
      if (plain.error) return [];
      return mapLogs(plain.data, false);
    }
    if (withPhase.error) return [];
    return mapLogs(withPhase.data, true);
  } catch {
    return [];
  }
}

function mapLogs(data: unknown, hasPhase: boolean) {
  return ((data ?? []) as LogRow[]).map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    entity: row.entity,
    direction: row.direction,
    status: row.status,
    phase: hasPhase && (row.phase === "in_flight" || row.phase === "completed") ? row.phase : null,
    message: row.message,
  }));
}
