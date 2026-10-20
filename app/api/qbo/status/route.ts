import { NextResponse } from "next/server";
import { readQboConfig } from "@/lib/qbo/config";
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

async function readLogs() {
  try {
    const { data, error } = await (await getSupabase())
      .from("qbo_sync_log")
      .select("id, started_at, finished_at, entity, direction, status, message")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return [];
    return ((data ?? []) as LogRow[]).map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      entity: row.entity,
      direction: row.direction,
      status: row.status,
      message: row.message,
    }));
  } catch {
    return [];
  }
}
