import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QBO_REVOKE_URL,
  QBO_TOKEN_URL,
  basicAuthHeader,
  readQboConfig,
  type QboConfig,
} from "@/lib/qbo/config";
import { writeSyncLog } from "@/lib/qbo/log";
import { getServiceSupabase } from "@/lib/supabaseAdmin";

export type QboConnection = {
  id: string;
  realm_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string | null;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
};

const REFRESH_SKEW_MS = 60_000;

export async function loadConnection(): Promise<QboConnection | null> {
  const admin = getServiceSupabase();
  if (!admin) return null;
  const { data, error } = await admin
    .from("qbo_connection")
    .select("id, realm_id, access_token, refresh_token, expires_at, refresh_expires_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as QboConnection | null;
}

export async function connectionStatus(): Promise<{
  connected: boolean;
  realmId: string | null;
  expiresAt: string | null;
}> {
  const row = await loadConnection();
  if (!row) return { connected: false, realmId: null, expiresAt: null };
  return { connected: true, realmId: row.realm_id, expiresAt: row.expires_at };
}

export async function exchangeCode(code: string, realmId: string): Promise<void> {
  const config = requireConfig();
  const admin = requireAdmin();
  const tokens = await requestToken(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
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
  const admin = requireAdmin();
  const current = await loadConnection();
  if (!current) throw new Error("QuickBooks is not connected.");
  if (Date.parse(current.expires_at) - Date.now() > REFRESH_SKEW_MS) {
    return { config, connection: current };
  }
  const tokens = await requestToken(config, {
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
  });
  const connection = await updateConnection(admin, current.id, tokens, current.realm_id);
  return { config, connection };
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
      detail: { realmId: current.realm_id },
    });
  }

  const { error } = await admin.from("qbo_connection").delete().eq("id", current.id);
  if (error) throw new Error(error.message);
}

async function requestToken(
  config: QboConfig,
  fields: Record<string, string>,
): Promise<Required<Pick<TokenResponse, "access_token" | "refresh_token" | "expires_in">> & TokenResponse> {
  const response = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => null)) as TokenResponse | null;
  if (!response.ok || !body?.access_token || !body.refresh_token || !body.expires_in) {
    const message = body?.error_description || body?.error || `QuickBooks token request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as Required<Pick<TokenResponse, "access_token" | "refresh_token" | "expires_in">> & TokenResponse;
}

async function revokeToken(config: QboConfig, token: string): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(QBO_REVOKE_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(config),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return { ok: true, message: "" };
    const body = (await response.json().catch(() => null)) as TokenResponse | null;
    return {
      ok: false,
      message: body?.error_description || body?.error || `Revoke failed (${response.status}).`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Revoke failed." };
  }
}

async function replaceConnection(
  admin: SupabaseClient,
  tokens: TokenResponse & { access_token: string; refresh_token: string; expires_in: number },
  realmId: string,
): Promise<void> {
  const removed = await admin.from("qbo_connection").delete().not("realm_id", "is", null);
  if (removed.error) throw new Error(removed.error.message);
  const row = tokenRow(tokens, realmId);
  const inserted = await admin.from("qbo_connection").insert(row);
  if (inserted.error) throw new Error(inserted.error.message);
}

async function updateConnection(
  admin: SupabaseClient,
  id: string,
  tokens: TokenResponse & { access_token: string; refresh_token: string; expires_in: number },
  realmId: string,
): Promise<QboConnection> {
  const row = tokenRow(tokens, realmId);
  const updated = await admin
    .from("qbo_connection")
    .update(row)
    .eq("id", id)
    .select("id, realm_id, access_token, refresh_token, expires_at, refresh_expires_at")
    .single();
  if (updated.error) throw new Error(updated.error.message);
  return updated.data as QboConnection;
}

function tokenRow(
  tokens: TokenResponse & { access_token: string; refresh_token: string; expires_in: number },
  realmId: string,
) {
  const now = Date.now();
  return {
    realm_id: realmId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    refresh_expires_at: tokens.x_refresh_token_expires_in
      ? new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString()
      : null,
    updated_at: new Date(now).toISOString(),
  };
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
