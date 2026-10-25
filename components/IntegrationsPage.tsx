"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Building, Cable, Contact, List, Plug, RefreshCw, Unplug } from "lucide-react";
import { PageToolbar, ToolbarButton, ToolbarSeparator } from "@/components/PageToolbar";
import { isDirty } from "@/lib/formDirty";
import { RECONNECT_MESSAGE as EBAY_RECONNECT_MESSAGE } from "@/lib/ebay/messages";
import { RECONNECT_MESSAGE } from "@/lib/qbo/messages";
import { INTEGRATIONS, integrationReturnHref } from "@/lib/integrations";
import { runSyncRequests, type SyncChunk } from "@/lib/qbo/pull";
import {
  type SyncDirection,
  type SyncEntity,
} from "@/lib/qbo/syncOptions";

type IntegrationFocus = "overview" | "quickbooks" | "ebay";

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
  listings: {
    available: boolean;
    active: number | null;
    unmatched: number | null;
    fetchedAt: string | null;
  };
  orders?: {
    available: boolean;
    seeded: boolean;
    seededAt: string | null;
    linked: number | null;
    assigned: number | null;
    watermark: string | null;
  };
  canRefreshListings: boolean;
  message: string | null;
  logs: LogEntry[];
};

const STORAGE_KEY = "its.qbo.sync";
const DEFAULT_ENTITIES: SyncEntity[] = ["customer", "vendor"];

const LOCAL_REDIRECT = "http://localhost:3000/api/qbo/callback";

export function IntegrationsPage({ focus = "overview" }: { focus?: IntegrationFocus }) {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [ebay, setEbay] = useState<EbayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ebayError, setEbayError] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "sync" | "customer" | "vendor" | "disconnect" | "ebay-test" | "ebay-disconnect" | "ebay-listings" | "ebay-orders" | "ebay-seed" | "ebay-backfill" | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ebayNotice, setEbayNotice] = useState<string | null>(null);
  const [seedFile, setSeedFile] = useState<File | null>(null);
  const [seedInputKey, setSeedInputKey] = useState(0);
  const [entities, setEntities] = useState<SyncEntity[]>(DEFAULT_ENTITIES);
  const [direction, setDirection] = useState<SyncDirection>("both");
  const [full, setFull] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [choiceReady, setChoiceReady] = useState(false);
  const [baseline, setBaseline] = useState<{
    entities: SyncEntity[];
    direction: SyncDirection;
    full: boolean;
  } | null>(null);
  const [choiceSaved, setChoiceSaved] = useState(false);

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

  useEffect(() => {
    if (focus !== "overview") return;
    const target = integrationReturnHref(params);
    if (!target) return;
    const query = params.toString();
    router.replace(query ? `${target}?${query}` : target);
  }, [focus, params, router]);

  useEffect(() => {
    const choice = loadChoice();
    setEntities(choice.entities);
    setDirection(choice.direction);
    setFull(choice.full);
    setBaseline(choice);
    setChoiceReady(true);
  }, []);

  function choiceSnapshot(value: { entities: SyncEntity[]; direction: SyncDirection; full: boolean }) {
    return { entities: [...value.entities].sort(), direction: value.direction, full: value.full };
  }

  const choiceDirty =
    baseline !== null &&
    isDirty(choiceSnapshot({ entities, direction, full }), choiceSnapshot(baseline));

  function toggleEntity(entity: SyncEntity) {
    setChoiceSaved(false);
    setEntities((current) =>
      current.includes(entity) ? current.filter((item) => item !== entity) : [...current, entity],
    );
  }

  function saveChoices() {
    const next = { entities, direction, full };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setBaseline(next);
    setChoiceSaved(true);
  }

  async function run(selected: SyncEntity[], source: "sync" | SyncEntity) {
    setBusy(source);
    setNotice(null);
    setError(null);
    setResults(selected.map((entity) => (entity === "customer" ? "Customers … / …" : "Vendors … / …")));
    try {
      const outcome = await runSyncRequests({
        entities: selected,
        direction,
        full,
        onProgress: setResults,
        post: async (body) => {
          const response = await fetch("/api/qbo/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const payload = (await response.json()) as { entities?: SyncChunk[]; message?: string };
          return { ok: response.ok, status: response.status, body: payload };
        },
      });
      if (!outcome.ok) setError(outcome.message);
      else setNotice(outcome.lines.join(" ") || outcome.message || "Sync finished.");
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

  async function refreshEbayListings() {
    setBusy("ebay-listings");
    setEbayNotice(null);
    setEbayError(null);
    try {
      const response = await fetch("/api/ebay/listings", { method: "POST" });
      const body = (await response.json()) as { message?: string; active?: number; unmatched?: number };
      if (body.message === EBAY_RECONNECT_MESSAGE) setEbayError(EBAY_RECONNECT_MESSAGE);
      else if (!response.ok) setEbayError(body.message || "eBay listings could not be refreshed.");
      else {
        const active = body.active ?? 0;
        const unmatched = body.unmatched ?? 0;
        setEbayNotice(`Fetched ${active} active listings. ${unmatched} do not match an item SKU.`);
      }
      await load();
    } catch (err) {
      setEbayError(err instanceof Error ? err.message : "eBay listings could not be refreshed.");
    } finally {
      setBusy(null);
    }
  }

  async function pullEbayOrders() {
    setBusy("ebay-orders");
    setEbayNotice(null);
    setEbayError(null);
    try {
      const response = await fetch("/api/ebay/orders", { method: "POST" });
      const body = (await response.json()) as { message?: string };
      if (body.message === EBAY_RECONNECT_MESSAGE) setEbayError(EBAY_RECONNECT_MESSAGE);
      else if (!response.ok) setEbayError(body.message || "eBay orders could not be pulled.");
      else setEbayNotice(body.message || "eBay orders pulled.");
      await load();
    } catch (err) {
      setEbayError(err instanceof Error ? err.message : "eBay orders could not be pulled.");
    } finally {
      setBusy(null);
    }
  }

  async function applyEbaySeed(event: FormEvent) {
    event.preventDefault();
    if (!seedFile) return;
    setBusy("ebay-seed");
    setEbayNotice(null);
    setEbayError(null);
    try {
      const csv = await seedFile.text();
      const response = await fetch("/api/ebay/order-seed", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: csv,
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) setEbayError(body.message || "The log map could not be applied.");
      else {
        setEbayNotice(body.message || "Legacy log map applied.");
        setSeedFile(null);
        setSeedInputKey((key) => key + 1);
      }
      await load();
    } catch (err) {
      setEbayError(err instanceof Error ? err.message : "The log map could not be applied.");
    } finally {
      setBusy(null);
    }
  }

  async function assignLegacySoNumbers() {
    setBusy("ebay-backfill");
    setEbayNotice(null);
    setEbayError(null);
    try {
      const response = await fetch("/api/ebay/order-seed/backfill", { method: "POST" });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) setEbayError(body.message || "Legacy SO numbers could not be assigned.");
      else setEbayNotice(body.message || "Legacy SO numbers assigned.");
      await load();
    } catch (err) {
      setEbayError(err instanceof Error ? err.message : "Legacy SO numbers could not be assigned.");
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

  const qboConnectLabel = needsReconnect ? "Reconnect QuickBooks" : "Connect QuickBooks";
  const ebayConnectLabel = ebayNeedsReconnect ? "Reconnect eBay" : "Connect eBay";
  const canSync = (connected || needsReconnect) && busy === null;
  const qboConnectHref = configured && (needsReconnect || !connected) ? "/api/qbo/connect" : undefined;
  const ebayConnectHref = ebayConfigured && (ebayNeedsReconnect || !ebayConnected) ? "/api/ebay/connect" : undefined;

  if (focus === "overview") {
    const declined = params.get("error_description") || params.get("error");
    return (
      <main className="page">
        <p className="page-note">
          Each connection has its own page. Google and BrokerBin can be added the same way.
        </p>
        {declined ? (
          <p className="banner error" role="alert">
            {declined}
          </p>
        ) : null}
        <div className="integration-list">
          {INTEGRATIONS.map((entry) => (
            <section className="card integration-card" key={entry.id}>
              <h2>{entry.label}</h2>
              <p className="hint">{entry.description}</p>
              {entry.id === "quickbooks" && status ? (
                <p className="integration-status">
                  <span className={`sync-pill ${connected ? "synced" : "local"}`}>
                    {connected ? "Connected" : "Not connected"}
                  </span>
                </p>
              ) : null}
              {entry.id === "ebay" && ebay ? (
                <p className="integration-status">
                  <span className={`sync-pill ${ebayConnected ? "synced" : "local"}`}>
                    {ebayConnected ? "Connected" : "Not connected"}
                  </span>
                </p>
              ) : null}
              {entry.href ? (
                <p>
                  <Link href={entry.href}>Open {entry.label}</Link>
                </p>
              ) : (
                <p className="muted">Coming soon</p>
              )}
            </section>
          ))}
        </div>
      </main>
    );
  }

  function runSync(selected: SyncEntity[], source: "sync" | SyncEntity) {
    if (choiceDirty) {
      if (!window.confirm("Save sync choices first?")) return;
      saveChoices();
    }
    void run(selected, source);
  }

  return (
    <main className="page">
      <PageToolbar
        dirty={focus === "quickbooks" && choiceDirty}
        saving={false}
        saved={choiceSaved}
        disabled={!choiceReady}
        listen={focus === "quickbooks"}
        showSave={focus === "quickbooks"}
        onSave={saveChoices}
      >
        {focus === "quickbooks" ? (
          <>
            <ToolbarButton
              icon={RefreshCw}
              label="Start sync"
              busy={busy === "sync"}
              disabled={entities.length === 0 || !canSync}
              onClick={() => runSync(entities, "sync")}
            />
            <ToolbarButton
              icon={Contact}
              label="Sync customers"
              busy={busy === "customer"}
              disabled={!canSync}
              onClick={() => runSync(["customer"], "customer")}
            />
            <ToolbarButton
              icon={Building}
              label="Sync vendors"
              busy={busy === "vendor"}
              disabled={!canSync}
              onClick={() => runSync(["vendor"], "vendor")}
            />
            <ToolbarSeparator />
            <ToolbarButton icon={Plug} label={qboConnectLabel} href={qboConnectHref} disabled={!qboConnectHref || busy !== null} />
            <ToolbarButton
              icon={Unplug}
              label="Disconnect QuickBooks"
              danger
              busy={busy === "disconnect"}
              disabled={!connected || busy !== null}
              onClick={() => {
                if (!window.confirm("Disconnect QuickBooks?")) return;
                void disconnect();
              }}
            />
          </>
        ) : null}
        {focus === "ebay" ? (
          <ToolbarButton icon={Plug} label={ebayConnectLabel} href={ebayConnectHref} disabled={!ebayConnectHref || busy !== null} />
        ) : null}
        {focus === "ebay" ? (
          <ToolbarButton icon={List} label="Browse listings" href="/admin/integrations/ebay/listings" />
        ) : null}
        {focus === "ebay" && ebay?.canRefreshListings ? (
          <button
            type="button"
            className="secondary toolbar-text"
            disabled={!ebayConnected || busy !== null}
            onClick={() => void refreshEbayListings()}
          >
            {busy === "ebay-listings" ? "Refreshing listings…" : "Refresh listings"}
          </button>
        ) : null}
        {focus === "ebay" && ebay?.canRefreshListings ? (
          <button
            type="button"
            className="secondary toolbar-text"
            disabled={!ebayConnected || !ebay.orders?.seeded || busy !== null}
            onClick={() => void pullEbayOrders()}
          >
            {busy === "ebay-orders" ? "Pulling orders…" : "Pull orders"}
          </button>
        ) : null}
        <ToolbarButton
          icon={Cable}
          label="Test eBay connection"
          busy={busy === "ebay-test"}
          disabled={!ebayConnected || busy !== null}
          onClick={() => void testEbay()}
        />
        <ToolbarButton
          icon={Unplug}
          label="Disconnect eBay"
          danger
          busy={busy === "ebay-disconnect"}
          disabled={(!ebayConnected && !ebayNeedsReconnect) || busy !== null}
          onClick={() => {
            if (!window.confirm("Disconnect eBay?")) return;
            void disconnectEbay();
          }}
        />
      </PageToolbar>
      {focus === "quickbooks" && queryError ? <p className="banner error">{queryError}</p> : null}
      {focus === "ebay" && ebayQueryError ? <p className="banner error">{ebayQueryError}</p> : null}
      {focus === "quickbooks" && connectedFlash && connected ? <p className="banner ok">QuickBooks connected.</p> : null}
      {focus === "ebay" && ebayConnectedFlash && ebayConnected ? <p className="banner ok">eBay connected.</p> : null}
      {focus === "quickbooks" && error ? <p className="banner error">{error}</p> : null}
      {focus === "ebay" && ebayError ? <p className="banner error">{ebayError}</p> : null}
      {focus === "quickbooks" && notice ? <p className="banner ok">{notice}</p> : null}
      {focus === "ebay" && ebayNotice ? <p className="banner ok">{ebayNotice}</p> : null}
      <div className="integration-grid">
        {focus === "quickbooks" ? <section className="card integration-card">
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
              <p className="hint">Connect, reconnect, and disconnect are in the toolbar.</p>
            </>
          ) : null}
        </section> : null}
        {focus === "ebay" ? <section className="card integration-card">
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
                <div>
                  <dt>Active listings</dt>
                  <dd>{ebay.listings?.available ? ebay.listings.active ?? 0 : "—"}</dd>
                </div>
                <div>
                  <dt>Unmatched SKUs</dt>
                  <dd>{ebay.listings?.available ? ebay.listings.unmatched ?? 0 : "—"}</dd>
                </div>
                <div>
                  <dt>Listings fetched</dt>
                  <dd>{ebay.listings?.fetchedAt ? formatWhen(ebay.listings.fetchedAt) : "Never"}</dd>
                </div>
                <div>
                  <dt>Orders pulled</dt>
                  <dd>{ebay.orders?.watermark ? formatWhen(ebay.orders.watermark) : "Never"}</dd>
                </div>
              </dl>
              {ebay.listings && !ebay.listings.available ? (
                <p className="hint">The listings table is not in the database yet.</p>
              ) : null}
              {ebay.orders && !ebay.orders.available ? (
                <p className="hint">Apply the eBay order migration before seeding or pulling orders.</p>
              ) : null}
              {ebay.orders?.available ? (
                <p className="hint">
                  {ebay.orders.seeded
                    ? `Legacy log map applied${ebay.orders.seededAt ? ` ${formatWhen(ebay.orders.seededAt)}` : ""}. ${ebay.orders.linked ?? 0} sales ${(ebay.orders.linked ?? 0) === 1 ? "order" : "orders"} linked.${ebay.orders.assigned == null ? "" : ` ${ebay.orders.assigned} draft ${(ebay.orders.assigned ?? 0) === 1 ? "order was" : "orders were"} given a legacy SO number.`}`
                    : "Legacy log map is not applied. Pull orders stays off until it is, so history does not create a second draft."}
                </p>
              ) : null}
              {ebay.canRefreshListings && ebay.orders?.available ? (
                <form className="ebay-order-seed" onSubmit={(event) => void applyEbaySeed(event)}>
                  <label>
                    Legacy log CSV
                    <input
                      key={seedInputKey}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(event) => setSeedFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <button type="submit" className="secondary" disabled={!seedFile || busy !== null}>
                    {busy === "ebay-seed" ? "Applying log map…" : "Apply log map"}
                  </button>
                </form>
              ) : null}
              {ebay.canRefreshListings && ebay.orders?.seeded ? (
                <p>
                  <button type="button" className="secondary" disabled={busy !== null} onClick={() => void assignLegacySoNumbers()}>
                    {busy === "ebay-backfill" ? "Assigning SO numbers…" : "Assign legacy SO numbers"}
                  </button>
                </p>
              ) : null}
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
              <p className="hint">
                <Link href="/admin/integrations/ebay/listings">Browse listings</Link> shows every active listing.
                Match a row when its custom label is not an item. Connect, refresh listings, pull orders, test, and disconnect are in the toolbar. Refresh reads listings and does not change anything on eBay. Pull orders creates draft sales orders, dated 1 Jan 2026 or later, under the eBay customer. It does not approve them or assign an SO number.
              </p>
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
        </section> : null}
      </div>
      {focus === "quickbooks" ? <section className="card integration-card">
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
              onChange={() => {
              setChoiceSaved(false);
              setDirection("pull");
            }}
            />
            Pull from QuickBooks
          </label>
          <label className="check">
            <input
              type="radio"
              name="qbo-direction"
              checked={direction === "push"}
              onChange={() => {
              setChoiceSaved(false);
              setDirection("push");
            }}
            />
            Push ITS changes
          </label>
          <label className="check">
            <input
              type="radio"
              name="qbo-direction"
              checked={direction === "both"}
              onChange={() => {
              setChoiceSaved(false);
              setDirection("both");
            }}
            />
            Both
          </label>
        </fieldset>
        <label className="check">
          <input
          type="checkbox"
          checked={full}
          onChange={(event) => {
            setChoiceSaved(false);
            setFull(event.target.checked);
          }}
        />
          Full resync
        </label>
        <p className="hint">
          A long pull continues on its own. The line shows how many records are in, such as Customers
          3,500 / 8,000. Leave this page open until it finishes. An interrupted pull continues from the
          last saved page and does not create a second copy. Full resync reads every record when no
          pull is already in progress. The other entity&apos;s cursor stays put. Save in the toolbar
          remembers this choice.
        </p>
        {results.length > 0 ? (
          <ul className="sync-results">
            {results.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </section> : null}
      {focus === "quickbooks" ? <section className="card integration-card">
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
      </section> : null}
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
