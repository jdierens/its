import type { SupabaseClient } from "@supabase/supabase-js";
import { ReconnectError, requestToken, TokenRequestError, type TokenSet } from "@/lib/ebay/auth";
import { readEbayConfig, type EbayConfig } from "@/lib/ebay/config";
import { EBAY_SCOPES, privilegeUrl, tokenUrl, userUrl, type EbayEnvironment } from "@/lib/ebay/endpoints";
import { ebayRead } from "@/lib/ebay/http";
import { writeEbayLog } from "@/lib/ebay/log";
import { RECONNECT_MESSAGE } from "@/lib/ebay/messages";
import { getServiceSupabase } from "@/lib/supabaseAdmin";

export type EbayConnection = {
  id: string;
  environment: EbayEnvironment;
  ebay_user_id: string | null;
  username: string | null;
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string | null;
  scopes: string | null;
  needs_reconnect: boolean;
};

export type ConnectionState = {
  connected: boolean;
  needsReconnect: boolean;
  environment: EbayEnvironment | null;
  username: string | null;
  ebayUserId: string | null;
  expiresAt: string | null;
};

const REFRESH_SKEW_MS = 60_000;
const CONNECTION_COLUMNS =
  "id, environment, ebay_user_id, username, access_token, access_expires_at, refresh_token, refresh_expires_at, scopes, needs_reconnect";

export async function loadConnection(): Promise<EbayConnection | null> {
  const admin = getServiceSupabase();
  if (!admin) return null;
  const { data, error } = await admin
    .from("ebay_connection")
    .select(CONNECTION_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as EbayConnection | null;
}

export async function connectionStatus(): Promise<ConnectionState> {
  const row = await loadConnection();
  if (!row) {
    return { connected: false, needsReconnect: false, environment: null, username: null, ebayUserId: null, expiresAt: null };
  }
  if (row.needs_reconnect) return disconnected(row, true);
  if (refreshTokenExpired(row)) {
    await flagReconnect(requireAdmin(), row, {
      code: "refresh_expired",
      rlogid: null,
      requestId: null,
      detail: "Refresh token is past its expiry.",
    });
    return disconnected(row, true);
  }
  return {
    connected: true,
    needsReconnect: false,
    environment: row.environment,
    username: row.username,
    ebayUserId: row.ebay_user_id,
    expiresAt: row.access_expires_at,
  };
}

export async function exchangeCode(code: string): Promise<void> {
  const config = requireConfig();
  const admin = requireAdmin();
  const tokens = await requestToken({
    config,
    tokenEndpoint: tokenUrl(config.environment),
    fields: {
      grant_type: "authorization_code",
      code,
      redirect_uri: config.ruName,
    },
  });
  const accessToken = tokens.access_token;
  const identity = await ebayRead<{ userId?: string; username?: string }>({
    url: userUrl(config.environment),
    token: accessToken,
  });
  const ebayUserId = identity.ok ? textOrNull(identity.body.userId) : null;
  const username = identity.ok ? textOrNull(identity.body.username) : null;
  await replaceConnection(admin, config.environment, tokens, ebayUserId, username);
  if (!identity.ok) {
    await writeEbayLog({
      entity: "connection",
      direction: "oauth",
      status: "error",
      message: `Connected eBay, but the account name could not be read. ${identity.message}`,
      detail: { rlogid: identity.rlogid, requestId: identity.requestId },
    });
    return;
  }
  await writeEbayLog({
    entity: "connection",
    direction: "oauth",
    status: "ok",
    message: username ? `Connected eBay account ${username}.` : "Connected eBay account.",
    detail: { username, ebayUserId, rlogid: identity.rlogid, requestId: identity.requestId },
  });
}

export async function validAccessToken(): Promise<{ config: EbayConfig; connection: EbayConnection }> {
  const config = requireConfig();
  const current = await requireRow();
  if (current.needs_reconnect || refreshTokenExpired(current)) {
    if (!current.needs_reconnect && refreshTokenExpired(current)) {
      await flagReconnect(requireAdmin(), current, {
        code: "refresh_expired",
        rlogid: null,
        requestId: null,
        detail: "Refresh token is past its expiry.",
      });
    }
    throw new ReconnectError(null);
  }
  if (Date.parse(current.access_expires_at) - Date.now() > REFRESH_SKEW_MS) {
    return { config, connection: current };
  }
  const connection = await refreshConnection(config, current);
  return { config, connection };
}

export async function forceRefreshAccessToken(): Promise<EbayConnection> {
  const config = requireConfig();
  const current = await requireRow();
  if (current.needs_reconnect || refreshTokenExpired(current)) {
    if (!current.needs_reconnect) {
      await flagReconnect(requireAdmin(), current, {
        code: "refresh_expired",
        rlogid: null,
        requestId: null,
        detail: "Refresh token is past its expiry.",
      });
    }
    throw new ReconnectError(null);
  }
  return refreshConnection(config, current);
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  const { connection } = await validAccessToken();
  const result = await ebayRead<{ sellerRegistrationCompleted?: boolean }>({
    url: privilegeUrl(connection.environment),
    token: connection.access_token,
    marketplace: true,
    refresh: async () => (await forceRefreshAccessToken()).access_token,
  });
  if (result.ok) {
    const registered = result.body.sellerRegistrationCompleted === true;
    const message = registered
      ? "eBay accepted the token. Seller registration is complete."
      : "eBay accepted the token.";
    await writeEbayLog({
      entity: "test",
      direction: "read",
      status: "ok",
      message,
      detail: { rlogid: result.rlogid, requestId: result.requestId },
    });
    return { ok: true, message };
  }
  await writeEbayLog({
    entity: "test",
    direction: "read",
    status: "error",
    message: result.message,
    detail: { rlogid: result.rlogid, requestId: result.requestId },
  });
  return { ok: false, message: result.message };
}

export async function disconnectEbay(): Promise<void> {
  const admin = requireAdmin();
  const current = await loadConnection();
  if (!current) return;
  const { error } = await admin.from("ebay_connection").delete().eq("id", current.id);
  if (error) throw new Error(error.message);
  await writeEbayLog({
    entity: "connection",
    direction: "oauth",
    status: "ok",
    message: current.username
      ? `Disconnected eBay account ${current.username}.`
      : "Disconnected eBay.",
    detail: { username: current.username },
  });
}

async function refreshConnection(config: EbayConfig, current: EbayConnection): Promise<EbayConnection> {
  try {
    const tokens = await requestToken({
      config,
      tokenEndpoint: tokenUrl(current.environment),
      fields: {
        grant_type: "refresh_token",
        refresh_token: current.refresh_token,
        scope: current.scopes || EBAY_SCOPES,
      },
    });
    return await updateConnection(requireAdmin(), current, tokens);
  } catch (error) {
    if (error instanceof TokenRequestError && error.code === "invalid_grant") {
      await flagReconnect(requireAdmin(), current, {
        code: "invalid_grant",
        rlogid: error.rlogid,
        requestId: error.requestId,
        detail: error.message,
      });
      throw new ReconnectError(error.rlogid, error.requestId);
    }
    throw error;
  }
}

async function flagReconnect(
  admin: SupabaseClient,
  row: EbayConnection,
  info: { code: string; rlogid: string | null; requestId: string | null; detail: string },
): Promise<void> {
  const { error } = await admin
    .from("ebay_connection")
    .update({ needs_reconnect: true, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  await writeEbayLog({
    entity: "connection",
    direction: "oauth",
    status: "error",
    message: RECONNECT_MESSAGE,
    detail: {
      username: row.username,
      code: info.code,
      rlogid: info.rlogid,
      requestId: info.requestId,
      detail: info.detail.slice(0, 300),
    },
  });
}

async function replaceConnection(
  admin: SupabaseClient,
  environment: EbayEnvironment,
  tokens: TokenSet,
  ebayUserId: string | null,
  username: string | null,
): Promise<void> {
  const removed = await admin.from("ebay_connection").delete().not("id", "is", null);
  if (removed.error) throw new Error(removed.error.message);
  const now = Date.now();
  const inserted = await admin.from("ebay_connection").insert({
    ...tokenFields(tokens, now),
    environment,
    ebay_user_id: ebayUserId,
    username,
    scopes: EBAY_SCOPES,
    connected_at: new Date(now).toISOString(),
  });
  if (inserted.error) throw new Error(inserted.error.message);
}

async function updateConnection(
  admin: SupabaseClient,
  current: EbayConnection,
  tokens: TokenSet,
): Promise<EbayConnection> {
  const now = Date.now();
  const updated = await admin
    .from("ebay_connection")
    .update({
      access_token: tokens.access_token,
      access_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
      refresh_token: tokens.refresh_token || current.refresh_token,
      refresh_expires_at: tokens.refresh_token_expires_in
        ? new Date(now + tokens.refresh_token_expires_in * 1000).toISOString()
        : current.refresh_expires_at,
      needs_reconnect: false,
      updated_at: new Date(now).toISOString(),
    })
    .eq("id", current.id)
    .select(CONNECTION_COLUMNS)
    .single();
  if (updated.error) throw new Error(updated.error.message);
  return updated.data as EbayConnection;
}

function tokenFields(tokens: TokenSet, now: number) {
  if (!tokens.refresh_token) throw new Error("eBay did not return a refresh token.");
  return {
    access_token: tokens.access_token,
    access_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    refresh_token: tokens.refresh_token,
    refresh_expires_at: tokens.refresh_token_expires_in
      ? new Date(now + tokens.refresh_token_expires_in * 1000).toISOString()
      : null,
    needs_reconnect: false,
    updated_at: new Date(now).toISOString(),
  };
}

function disconnected(row: EbayConnection, needsReconnect: boolean): ConnectionState {
  return {
    connected: false,
    needsReconnect,
    environment: row.environment,
    username: row.username,
    ebayUserId: row.ebay_user_id,
    expiresAt: row.access_expires_at,
  };
}

function refreshTokenExpired(row: EbayConnection): boolean {
  if (!row.refresh_expires_at) return false;
  const expires = Date.parse(row.refresh_expires_at);
  return !Number.isNaN(expires) && expires <= Date.now();
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function requireRow(): Promise<EbayConnection> {
  const current = await loadConnection();
  if (!current) throw new Error("eBay is not connected.");
  return current;
}

function requireConfig(): EbayConfig {
  const config = readEbayConfig();
  if (!config) {
    throw new Error("Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME, and EBAY_ENVIRONMENT.");
  }
  return config;
}

function requireAdmin(): SupabaseClient {
  const admin = getServiceSupabase();
  if (!admin) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY on the server.");
  return admin;
}
