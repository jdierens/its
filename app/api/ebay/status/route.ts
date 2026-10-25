import { NextRequest, NextResponse } from "next/server";
import { readEbayConfig } from "@/lib/ebay/config";
import { listingsSummary } from "@/lib/ebay/listings";
import { orderPullSummary } from "@/lib/ebay/orders";
import { publicOrigin } from "@/lib/ebay/origin";
import { connectionStatus } from "@/lib/ebay/oauth";
import { stockSettingsWritable } from "@/lib/stockAccess";
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

export async function GET(request: NextRequest) {
  const config = readEbayConfig();
  const serviceRole = Boolean(getServiceSupabase());
  const origin = publicOrigin(request);
  let connected = false;
  let needsReconnect = false;
  let environment = config?.environment ?? null;
  let username: string | null = null;
  let ebayUserId: string | null = null;
  let expiresAt: string | null = null;
  let message: string | null = null;
  let listings = { available: false, active: null as number | null, unmatched: null as number | null, fetchedAt: null as string | null };
  let orders = {
    available: false,
    seeded: false,
    seededAt: null as string | null,
    linked: null as number | null,
    watermark: null as string | null,
  };
  let canRefreshListings = false;

  if (!serviceRole) {
    message = "Set SUPABASE_SERVICE_ROLE_KEY on the server to read the eBay connection.";
  } else {
    try {
      const status = await connectionStatus();
      connected = status.connected;
      needsReconnect = status.needsReconnect;
      environment = status.environment ?? environment;
      username = status.username;
      ebayUserId = status.ebayUserId;
      expiresAt = status.expiresAt;
    } catch (error) {
      message = error instanceof Error ? error.message : "Could not read the eBay connection.";
    }
    try {
      listings = await listingsSummary();
    } catch (error) {
      if (!message) message = error instanceof Error ? error.message : "Could not read eBay listings.";
    }
    try {
      orders = await orderPullSummary();
    } catch (error) {
      if (!message) message = error instanceof Error ? error.message : "Could not read the eBay order pull.";
    }
  }

  canRefreshListings = await stockSettingsWritable();

  return NextResponse.json(
    {
      configured: Boolean(config),
      environment,
      ruName: config?.ruName ?? null,
      serviceRole,
      connected,
      needsReconnect,
      username,
      ebayUserId,
      expiresAt,
      listings,
      orders,
      canRefreshListings,
      acceptUrl: `${origin}/api/ebay/callback`,
      deletionUrl: `${origin}/api/ebay/account-deletion`,
      message,
      logs: await readLogs(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function readLogs() {
  try {
    const { data, error } = await (await getSupabase())
      .from("ebay_sync_log")
      .select("id, started_at, finished_at, entity, direction, status, message")
      .order("created_at", { ascending: false })
      .limit(8);
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
