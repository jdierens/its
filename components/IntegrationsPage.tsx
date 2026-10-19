"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { RECONNECT_MESSAGE } from "@/lib/qbo/messages";
import {
  formatEntityResult,
  type EntityCounts,
  type SyncDirection,
  type SyncEntity,
} from "@/lib/qbo/syncOptions";

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
  lastSync?: { customer: string | null; vendor: string | null };
  message: string | null;
  logs: LogEntry[];
};

type SyncResponse = {
  entities?: Array<EntityCounts & { entity: SyncEntity }>;
  message?: string;
};

const STORAGE_KEY = "its.qbo.sync";
const DEFAULT_ENTITIES: SyncEntity[] = ["customer", "vendor"];

const LOCAL_REDIRECT = "http://localhost:3000/api/qbo/callback";

export function IntegrationsPage() {
  const params = useSearchParams();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sync" | "customer" | "vendor" | "disconnect" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [entities, setEntities] = useState<SyncEntity[]>(DEFAULT_ENTITIES);
  const [direction, setDirection] = useState<SyncDirection>("both");
  const [full, setFull] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [choiceReady, setChoiceReady] = useState(false);

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

  useEffect(() => {
    const choice = loadChoice();
    setEntities(choice.entities);
    setDirection(choice.direction);
    setFull(choice.full);
    setChoiceReady(true);
  }, []);

  useEffect(() => {
    if (!choiceReady) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entities, direction, full }));
  }, [choiceReady, direction, entities, full]);

  function toggleEntity(entity: SyncEntity) {
    setEntities((current) =>
      current.includes(entity) ? current.filter((item) => item !== entity) : [...current, entity],
    );
  }

  async function run(selected: SyncEntity[], source: "sync" | SyncEntity) {
    setBusy(source);
    setNotice(null);
    setError(null);
    setResults(selected.map((entity) => (entity === "customer" ? "Customers: syncing…" : "Vendors: syncing…")));
    try {
      const response = await fetch("/api/qbo/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entities: selected, direction, full }),
      });
      const body = (await response.json()) as SyncResponse;
      const lines = (body.entities ?? []).map((result) => formatEntityResult(result.entity, result));
      setResults(lines);
      if (body.message === RECONNECT_MESSAGE) setError(RECONNECT_MESSAGE);
      else if (!response.ok) setError(body.message || "Sync failed.");
      else setNotice(lines.join(" ") || body.message || "Sync finished.");
      await load();
    } catch (err) {
      setResults([]);
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
  const needsReconnect = status?.needsReconnect === true;

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
                <dt>Customers last sync</dt>
                <dd>{status.lastSync?.customer ? formatWhen(status.lastSync.customer) : "Never"}</dd>
              </div>
              <div>
                <dt>Vendors last sync</dt>
                <dd>{status.lastSync?.vendor ? formatWhen(status.lastSync.vendor) : "Never"}</dd>
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
        <h2>Sync</h2>
        <div className="sync-choices">
          <label className="check">
            <input
              type="checkbox"
              checked={entities.includes("customer")}
              onChange={() => toggleEntity("customer")}
            />
            Customers
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={entities.includes("vendor")}
              onChange={() => toggleEntity("vendor")}
            />
            Vendors
          </label>
        </div>
        <fieldset className="sync-direction">
          <legend>Direction</legend>
          <label className="check">
            <input
              type="radio"
              name="qbo-direction"
              checked={direction === "pull"}
              onChange={() => setDirection("pull")}
            />
            Pull from QuickBooks
          </label>
          <label className="check">
            <input
              type="radio"
              name="qbo-direction"
              checked={direction === "push"}
              onChange={() => setDirection("push")}
            />
            Push ITS changes
          </label>
          <label className="check">
            <input
              type="radio"
              name="qbo-direction"
              checked={direction === "both"}
              onChange={() => setDirection("both")}
            />
            Both
          </label>
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={full} onChange={(event) => setFull(event.target.checked)} />
          Full resync
        </label>
        <p className="hint">
          Full resync ignores that entity&apos;s change cursor and reads every record. The other
          entity&apos;s cursor stays put. Leave it off for an incremental pull.
        </p>
        <div className="actions">
          <button
            type="button"
            onClick={() => void run(entities, "sync")}
            disabled={entities.length === 0 || (!connected && !needsReconnect) || busy !== null}
          >
            {busy === "sync" ? "Syncing…" : "Start sync"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void run(["customer"], "customer")}
            disabled={(!connected && !needsReconnect) || busy !== null}
          >
            {busy === "customer" ? "Syncing…" : "Sync customers"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void run(["vendor"], "vendor")}
            disabled={(!connected && !needsReconnect) || busy !== null}
          >
            {busy === "vendor" ? "Syncing…" : "Sync vendors"}
          </button>
        </div>
        {results.length > 0 ? (
          <ul className="sync-results">
            {results.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
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

function loadChoice(): { entities: SyncEntity[]; direction: SyncDirection; full: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { entities: DEFAULT_ENTITIES, direction: "both", full: false };
    const parsed = JSON.parse(raw) as { entities?: unknown; direction?: unknown; full?: unknown };
    const selected = Array.isArray(parsed.entities)
      ? parsed.entities.filter((entry): entry is SyncEntity => entry === "customer" || entry === "vendor")
      : [];
    const direction =
      parsed.direction === "pull" || parsed.direction === "push" || parsed.direction === "both"
        ? parsed.direction
        : "both";
    return {
      entities: selected.length > 0 ? selected : DEFAULT_ENTITIES,
      direction,
      full: parsed.full === true,
    };
  } catch {
    return { entities: DEFAULT_ENTITIES, direction: "both", full: false };
  }
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
