"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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
  realmId: string | null;
  expiresAt: string | null;
  lastSyncAt: string | null;
  message: string | null;
  logs: LogEntry[];
};

const LOCAL_REDIRECT = "http://localhost:3000/api/qbo/callback";

export function IntegrationsPage() {
  const params = useSearchParams();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/qbo/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load QuickBooks status.");
    setStatus((await response.json()) as StatusResponse);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load QuickBooks status.");
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
      setNotice(body.message || (response.ok ? "Sync finished." : "Sync failed."));
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

  const queryError = params.get("error");
  const connectedFlash = params.get("connected") === "1";
  const configured = status?.configured === true;
  const connected = status?.connected === true;

  return (
    <main className="page">
      {queryError ? <p className="banner error">{queryError}</p> : null}
      {connectedFlash && connected ? <p className="banner ok">QuickBooks connected.</p> : null}
      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner ok">{notice}</p> : null}
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
              {configured && !connected ? (
                <a className="button" href="/api/qbo/connect">
                  Connect
                </a>
              ) : (
                <button type="button" disabled>
                  Connect
                </button>
              )}
              <button type="button" onClick={syncNow} disabled={!connected || busy !== null}>
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
