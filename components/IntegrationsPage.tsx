"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { RECONNECT_MESSAGE as EBAY_RECONNECT_MESSAGE } from "@/lib/ebay/messages";
import { RECONNECT_MESSAGE } from "@/lib/qbo/messages";

type LogEntry = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  entity: string;
  direction: string;
  status: string;
  message: string | null;
};

type StatusResponse = {
  configured: boolean;
  environment: "sandbox" | "production" | null;
  redirectUri: string | null;
  serviceRole: boolean;
  connected: boolean;
  needsReconnect: boolean;
  realmId: string | null;
  expiresAt: string | null;
  lastSyncAt: string | null;
  message: string | null;
  logs: LogEntry[];
};

type EbayStatus = {
  configured: boolean;
  environment: "sandbox" | "production" | null;
  ruName: string | null;
  serviceRole: boolean;
  connected: boolean;
  needsReconnect: boolean;
  username: string | null;
  ebayUserId: string | null;
  expiresAt: string | null;
  acceptUrl: string;
  deletionUrl: string;
  message: string | null;
  logs: LogEntry[];
};

const LOCAL_REDIRECT = "http://localhost:3000/api/qbo/callback";

export function IntegrationsPage() {
  const params = useSearchParams();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [ebay, setEbay] = useState<EbayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ebayError, setEbayError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sync" | "disconnect" | "ebay-test" | "ebay-disconnect" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ebayNotice, setEbayNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [qboResponse, ebayResponse] = await Promise.all([
      fetch("/api/qbo/status", { cache: "no-store" }),
      fetch("/api/ebay/status", { cache: "no-store" }),
    ]);
    if (!qboResponse.ok) throw new Error("Could not load QuickBooks status.");
    if (!ebayResponse.ok) throw new Error("Could not load eBay status.");
    setStatus((await qboResponse.json()) as StatusResponse);
    setEbay((await ebayResponse.json()) as EbayStatus);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load integrations.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function syncNow() {
    setBusy("sync");
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/qbo/sync", { method: "POST" });
      const body = (await response.json()) as { message?: string };
      if (body.message === RECONNECT_MESSAGE) setError(RECONNECT_MESSAGE);
      else setNotice(body.message || (response.ok ? "Sync finished." : "Sync failed."));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/qbo/disconnect", { method: "POST" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Disconnect failed.");
      setNotice("QuickBooks disconnected.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed.");
    } finally {
      setBusy(null);
    }
  }

  async function testEbay() {
    setBusy("ebay-test");
    setEbayNotice(null);
    setEbayError(null);
    try {
      const response = await fetch("/api/ebay/test", { method: "POST" });
      const body = (await response.json()) as { message?: string };
      if (body.message === EBAY_RECONNECT_MESSAGE) setEbayError(EBAY_RECONNECT_MESSAGE);
      else if (!response.ok) setEbayError(body.message || "eBay connection test failed.");
      else setEbayNotice(body.message || "eBay accepted the token.");
      await load();
    } catch (err) {
      setEbayError(err instanceof Error ? err.message : "eBay connection test failed.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnectEbay() {
    setBusy("ebay-disconnect");
    setEbayNotice(null);
    setEbayError(null);
    try {
      const response = await fetch("/api/ebay/disconnect", { method: "POST" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Disconnect failed.");
      setEbayNotice("eBay disconnected.");
      await load();
    } catch (err) {
      setEbayError(err instanceof Error ? err.message : "Disconnect failed.");
    } finally {
      setBusy(null);
    }
  }

  const queryError = params.get("error");
  const ebayQueryError = params.get("ebay_error");
  const connectedFlash = params.get("connected") === "1";
  const ebayConnectedFlash = params.get("ebay_connected") === "1";
  const configured = status?.configured === true;
  const connected = status?.connected === true;
  const needsReconnect = status?.needsReconnect === true;
  const ebayConfigured = ebay?.configured === true;
  const ebayConnected = ebay?.connected === true;
  const ebayNeedsReconnect = ebay?.needsReconnect === true;

  return (
    <main className="page">
      {queryError ? <p className="banner error">{queryError}</p> : null}
      {ebayQueryError ? <p className="banner error">{ebayQueryError}</p> : null}
      {connectedFlash && connected ? <p className="banner ok">QuickBooks connected.</p> : null}
      {ebayConnectedFlash && ebayConnected ? <p className="banner ok">eBay connected.</p> : null}
      {error ? <p className="banner error">{error}</p> : null}
      {ebayError ? <p className="banner error">{ebayError}</p> : null}
      {notice ? <p className="banner ok">{notice}</p> : null}
      {ebayNotice ? <p className="banner ok">{ebayNotice}</p> : null}
      <div className="integration-grid">
        <section className="card integration-card">
          <h2>QuickBooks Online</h2>
          {loading ? <p className="muted">Loading connection…</p> : null}
          {status ? (
            <>
              <p className="integration-status">
                <span className={`sync-pill ${connected ? "synced" : "local"}`}>
                  {connected ? "Connected" : "Not connected"}
                </span>
                {status.environment ? <span className="muted">{status.environment}</span> : null}
              </p>
              <dl className="integration-facts">
                <div>
                  <dt>Company ID</dt>
                  <dd>{status.realmId ?? "—"}</dd>
                </div>
                <div>
                  <dt>Access token expires</dt>
                  <dd>{status.expiresAt ? formatWhen(status.expiresAt) : "—"}</dd>
                </div>
                <div>
                  <dt>Last sync</dt>
                  <dd>{status.lastSyncAt ? formatWhen(status.lastSyncAt) : "Never"}</dd>
                </div>
              </dl>
              {needsReconnect ? <p className="banner error">{RECONNECT_MESSAGE}</p> : null}
              {status.message ? <p className="banner error">{status.message}</p> : null}
              {!configured ? (
                <p className="hint">
                  Set QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, and QBO_ENVIRONMENT
                  (sandbox or production) in .env.local. These stay on the server.
                </p>
              ) : null}
              <p className="hint">
                Register this redirect URI in the Intuit app:{" "}
                <code>{status.redirectUri || LOCAL_REDIRECT}</code>
              </p>
              <div className="actions">
                {configured && needsReconnect ? (
                  <a className="button" href="/api/qbo/connect">
                    Reconnect
                  </a>
                ) : configured && !connected ? (
                  <a className="button" href="/api/qbo/connect">
                    Connect
                  </a>
                ) : (
                  <button type="button" disabled>
                    Connect
                  </button>
                )}
                <button type="button" onClick={syncNow} disabled={(!connected && !needsReconnect) || busy !== null}>
                  {busy === "sync" ? "Syncing…" : "Sync now"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={disconnect}
                  disabled={!connected || busy !== null}
                >
                  {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            </>
          ) : null}
        </section>
        <section className="card integration-card">
          <h2>eBay</h2>
          {loading ? <p className="muted">Loading connection…</p> : null}
          {ebay ? (
            <>
              <p className="integration-status">
                <span className={`sync-pill ${ebayConnected ? "synced" : "local"}`}>
                  {ebayConnected ? "Connected" : "Not connected"}
                </span>
                {ebay.environment ? (
                  <span className={`env-badge ${ebay.environment}`}>{ebay.environment}</span>
                ) : null}
              </p>
              <dl className="integration-facts">
                <div>
                  <dt>Account</dt>
                  <dd>{ebay.username ?? "—"}</dd>
                </div>
                <div>
                  <dt>Access token expires</dt>
                  <dd>{ebay.expiresAt ? formatWhen(ebay.expiresAt) : "—"}</dd>
                </div>
                <div>
                  <dt>eBay user id</dt>
                  <dd>{ebay.ebayUserId ?? "—"}</dd>
                </div>
              </dl>
              {ebayNeedsReconnect ? <p className="banner error">{EBAY_RECONNECT_MESSAGE}</p> : null}
              {ebay.message ? <p className="banner error">{ebay.message}</p> : null}
              {!ebayConfigured ? (
                <p className="hint">
                  Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME, and EBAY_ENVIRONMENT
                  (sandbox or production) in .env.local. These stay on the server.
                </p>
              ) : null}
              <p className="hint">
                Auth Accepted URL for the RuName: <code>{ebay.acceptUrl}</code>
              </p>
              <p className="hint">
                Marketplace account deletion endpoint: <code>{ebay.deletionUrl}</code>
              </p>
              {ebay.ruName ? (
                <p className="hint">
                  OAuth redirect uses RuName <code>{ebay.ruName}</code>, not the URL above.
                </p>
              ) : null}
              <div className="actions">
                {ebayConfigured && ebayNeedsReconnect ? (
                  <a className="button" href="/api/ebay/connect">
                    Reconnect
                  </a>
                ) : ebayConfigured && !ebayConnected ? (
                  <a className="button" href="/api/ebay/connect">
                    Connect
                  </a>
                ) : (
                  <button type="button" disabled>
                    Connect
                  </button>
                )}
                <button type="button" onClick={testEbay} disabled={!ebayConnected || busy !== null}>
                  {busy === "ebay-test" ? "Testing…" : "Test connection"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={disconnectEbay}
                  disabled={(!ebayConnected && !ebayNeedsReconnect) || busy !== null}
                >
                  {busy === "ebay-disconnect" ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
              <h3>Recent log</h3>
              {ebay.logs.length > 0 ? (
                <table className="log-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Status</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ebay.logs.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatWhen(entry.startedAt)}</td>
                        <td>{entry.status}</td>
                        <td>{entry.message || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">No eBay activity yet.</p>
              )}
            </>
          ) : null}
        </section>
      </div>
      <section className="card integration-card">
        <h2>Recent sync log</h2>
        {status && status.logs.length > 0 ? (
          <table className="log-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Entity</th>
                <th>Direction</th>
                <th>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {status.logs.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatWhen(entry.startedAt)}</td>
                  <td>{entry.entity}</td>
                  <td>{entry.direction}</td>
                  <td>{entry.status}</td>
                  <td>{entry.message || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No sync activity yet.</p>
        )}
      </section>
    </main>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
