import type { SupabaseClient } from "@supabase/supabase-js";
import { discoverEndpoints, requestToken, ReconnectError, TokenRequestError, type TokenSet } from "@/lib/qbo/auth";
import { basicAuthHeader, readQboConfig, type QboConfig } from "@/lib/qbo/config";
import { writeSyncLog } from "@/lib/qbo/log";
import { RECONNECT_MESSAGE } from "@/lib/qbo/messages";
import { getServiceSupabase } from "@/lib/supabaseAdmin";

export type QboConnection = {
  id: string;
  realm_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string | null;
  needs_reconnect: boolean;
};

export type ConnectionState = {
  connected: boolean;
  needsReconnect: boolean;
  realmId: string | null;
  expiresAt: string | null;
};

const REFRESH_SKEW_MS = 60_000;
const CONNECTION_COLUMNS =
  "id, realm_id, access_token, refresh_token, expires_at, refresh_expires_at, needs_reconnect";

export async function loadConnection(): Promise<QboConnection | null> {
  const admin = getServiceSupabase();
  if (!admin) return null;
  const { data, error } = await admin
    .from("qbo_connection")
    .select(CONNECTION_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as QboConnection | null;
}

export async function connectionStatus(): Promise<ConnectionState> {
  const row = await loadConnection();
  if (!row) return { connected: false, needsReconnect: false, realmId: null, expiresAt: null };
  if (row.needs_reconnect) {
    return { connected: false, needsReconnect: true, realmId: row.realm_id, expiresAt: row.expires_at };
  }
  if (refreshTokenExpired(row)) {
    await flagReconnect(requireAdmin(), row, {
      code: "refresh_expired",
      intuitTid: null,
      detail: "Refresh token is past its expiry.",
    });
    return { connected: false, needsReconnect: true, realmId: row.realm_id, expiresAt: row.expires_at };
  }
  return { connected: true, needsReconnect: false, realmId: row.realm_id, expiresAt: row.expires_at };
}

export async function exchangeCode(code: string, realmId: string): Promise<void> {
  const config = requireConfig();
  const admin = requireAdmin();
  const tokens = await requestToken({
    config,
    fields: {
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    },
  });
  await replaceConnection(admin, tokens, realmId);
  await writeSyncLog({
    entity: "connection",
    direction: "oauth",
    status: "ok",
    message: `Connected QuickBooks company ${realmId}.`,
    detail: { realmId },
  });
}

export async function validAccessToken(): Promise<{ config: QboConfig; connection: QboConnection }> {
  const config = requireConfig();
  const current = await loadConnection();
  if (!current) throw new Error("QuickBooks is not connected.");
  if (current.needs_reconnect || refreshTokenExpired(current)) {
    if (!current.needs_reconnect && refreshTokenExpired(current)) {
      await flagReconnect(requireAdmin(), current, {
        code: "refresh_expired",
        intuitTid: null,
        detail: "Refresh token is past its expiry.",
      });
    }
    throw new ReconnectError(null);
  }
  if (Date.parse(current.expires_at) - Date.now() > REFRESH_SKEW_MS) {
    return { config, connection: current };
  }
  const connection = await refreshConnection(config, current);
  return { config, connection };
}

export async function forceRefreshAccessToken(): Promise<QboConnection> {
  const config = requireConfig();
  const current = await loadConnection();
  if (!current) throw new Error("QuickBooks is not connected.");
  if (current.needs_reconnect || refreshTokenExpired(current)) {
    if (!current.needs_reconnect) {
      await flagReconnect(requireAdmin(), current, {
        code: "refresh_expired",
        intuitTid: null,
        detail: "Refresh token is past its expiry.",
      });
    }
    throw new ReconnectError(null);
  }
  return refreshConnection(config, current);
}

export async function disconnectQuickBooks(): Promise<void> {
  const config = readQboConfig();
  const admin = requireAdmin();
  const current = await loadConnection();
  if (!current) return;

  if (config) {
    const revoked = await revokeToken(config, current.refresh_token);
    await writeSyncLog({
      entity: "connection",
      direction: "oauth",
      status: revoked.ok ? "ok" : "error",
      message: revoked.ok
        ? `Disconnected QuickBooks company ${current.realm_id}.`
        : `Disconnected locally. QuickBooks revoke failed: ${revoked.message}`,
      detail: { realmId: current.realm_id, intuitTid: revoked.intuitTid },
    });
  }

  const { error } = await admin.from("qbo_connection").delete().eq("id", current.id);
  if (error) throw new Error(error.message);
}

export async function authorizationRedirect(config: QboConfig, state: string): Promise<string> {
  const endpoints = await discoverEndpoints(config.environment);
  const url = new URL(endpoints.authorization_endpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function refreshConnection(config: QboConfig, current: QboConnection): Promise<QboConnection> {
  try {
    const tokens = await requestToken({
      config,
      fields: { grant_type: "refresh_token", refresh_token: current.refresh_token },
    });
    return await updateConnection(requireAdmin(), current.id, tokens, current.realm_id);
  } catch (error) {
    if (error instanceof TokenRequestError && error.code === "invalid_grant") {
      await flagReconnect(requireAdmin(), current, {
        code: "invalid_grant",
        intuitTid: error.intuitTid,
        detail: error.message,
      });
      throw new ReconnectError(error.intuitTid);
    }
    throw error;
  }
}

async function revokeToken(
  config: QboConfig,
  token: string,
): Promise<{ ok: boolean; message: string; intuitTid: string | null }> {
  try {
    const endpoints = await discoverEndpoints(config.environment);
    const response = await fetch(endpoints.revocation_endpoint, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(config),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(30_000),
    });
    const intuitTid = response.headers.get("intuit_tid");
    if (response.ok) return { ok: true, message: "", intuitTid };
    const body = (await response.json().catch(() => null)) as { error_description?: string; error?: string } | null;
    return {
      ok: false,
      message: body?.error_description || body?.error || `Revoke failed (${response.status}).`,
      intuitTid,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Revoke failed.", intuitTid: null };
  }
}

async function flagReconnect(
  admin: SupabaseClient,
  row: QboConnection,
  info: { code: string; intuitTid: string | null; detail: string },
): Promise<void> {
  const { error } = await admin
    .from("qbo_connection")
    .update({ needs_reconnect: true, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  await writeSyncLog({
    entity: "connection",
    direction: "oauth",
    status: "error",
    message: RECONNECT_MESSAGE,
    detail: { realmId: row.realm_id, code: info.code, intuitTid: info.intuitTid, detail: info.detail },
  });
}

async function replaceConnection(admin: SupabaseClient, tokens: TokenSet, realmId: string): Promise<void> {
  const removed = await admin.from("qbo_connection").delete().not("realm_id", "is", null);
  if (removed.error) throw new Error(removed.error.message);
  const inserted = await admin.from("qbo_connection").insert(tokenRow(tokens, realmId));
  if (inserted.error) throw new Error(inserted.error.message);
}

async function updateConnection(
  admin: SupabaseClient,
  id: string,
  tokens: TokenSet,
  realmId: string,
): Promise<QboConnection> {
  const updated = await admin
    .from("qbo_connection")
    .update(tokenRow(tokens, realmId))
    .eq("id", id)
    .select(CONNECTION_COLUMNS)
    .single();
  if (updated.error) throw new Error(updated.error.message);
  return updated.data as QboConnection;
}

function tokenRow(tokens: TokenSet, realmId: string) {
  const now = Date.now();
  return {
    realm_id: realmId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    refresh_expires_at: tokens.x_refresh_token_expires_in
      ? new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString()
      : null,
    needs_reconnect: false,
    updated_at: new Date(now).toISOString(),
  };
}

function refreshTokenExpired(row: QboConnection): boolean {
  if (!row.refresh_expires_at) return false;
  const expires = Date.parse(row.refresh_expires_at);
  return !Number.isNaN(expires) && expires <= Date.now();
}

function requireConfig(): QboConfig {
  const config = readQboConfig();
  if (!config) {
    throw new Error(
      "Set QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, and QBO_ENVIRONMENT.",
    );
  }
  return config;
}

function requireAdmin(): SupabaseClient {
  const admin = getServiceSupabase();
  if (!admin) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY on the server.");
  return admin;
}
