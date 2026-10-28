"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plug, RefreshCw } from "lucide-react";
import { usePlaidLink } from "react-plaid-link";
import { PageToolbar, ToolbarButton } from "@/components/PageToolbar";
import { formatMoney } from "@/lib/pricing/quotes";
import type { PlaidItemView, PlaidStatus } from "@/lib/plaid/types";

const LINK_TOKEN_KEY = "its.plaid.linkToken";

export function BankFeedsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const oauthReturn = params.get("oauth_state_id");
  const [status, setStatus] = useState<PlaidStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [oauthRedirect, setOauthRedirect] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    const response = await fetch("/api/plaid/status", { cache: "no-store" });
    const body = (await response.json()) as PlaidStatus & { message?: string };
    if (response.status === 401) throw new Error(body.message || "Sign in required.");
    if (!response.ok) throw new Error(body.message || "Could not load bank feeds.");
    setStatus(body);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load bank feeds.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (!oauthReturn) return;
    setOauthRedirect(window.location.href);
    const stored = window.localStorage.getItem(LINK_TOKEN_KEY);
    if (!stored) {
      setError("The bank sign-in expired. Connect again.");
      return;
    }
    setLinkToken(stored);
    setAutoOpen(true);
  }, [oauthReturn]);

  async function startLink(itemId?: string) {
    setBusy(itemId ? `repair:${itemId}` : "link");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemId ? { itemId } : {}),
      });
      const body = (await response.json()) as { linkToken?: string; message?: string };
      if (!response.ok || !body.linkToken) throw new Error(body.message || "Could not start Plaid Link.");
      window.localStorage.setItem(LINK_TOKEN_KEY, body.linkToken);
      setLinkToken(body.linkToken);
      setAutoOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Plaid Link.");
      setBusy(null);
    }
  }

  async function onLinked(publicToken: string | null) {
    window.localStorage.removeItem(LINK_TOKEN_KEY);
    setLinkToken(null);
    setAutoOpen(false);
    if (oauthReturn) router.replace("/admin/integrations/plaid");
    if (!publicToken) {
      setError("Plaid did not return a public token.");
      setBusy(null);
      return;
    }
    setBusy("exchange");
    try {
      const response = await fetch("/api/plaid/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicToken }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(body.message || "Could not connect the bank.");
      setNotice("Bank connected.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect the bank.");
    } finally {
      setBusy(null);
    }
  }

  function onLinkExit(linkError: { display_message?: string | null; error_message?: string | null } | null) {
    if (linkError) setError(linkError.display_message || linkError.error_message || "Plaid Link closed.");
    if (!oauthReturn) {
      setLinkToken(null);
      setAutoOpen(false);
    }
    setBusy(null);
  }

  async function sync(id?: string) {
    setBusy(id ? `sync:${id}` : "sync");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/plaid/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : {}),
      });
      const body = (await response.json()) as { message?: string; reports?: { message: string }[] };
      if (!response.ok) throw new Error(body.message || "Bank sync failed.");
      setNotice(body.reports?.map((report) => report.message).join(" ") || body.message || "Sync finished.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bank sync failed.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(item: PlaidItemView) {
    if (!window.confirm(`Disconnect ${item.institutionName || "this bank"}? Stored transactions for it are deleted.`)) return;
    setBusy(`disconnect:${item.id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/plaid/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(body.message || "Could not disconnect the bank.");
      setNotice(body.message || "Disconnected.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect the bank.");
    } finally {
      setBusy(null);
    }
  }

  async function fireWebhook(id: string) {
    setBusy(`webhook:${id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/plaid/sandbox-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(body.message || "Could not fire the sandbox webhook.");
      setNotice(body.message || "Plaid queued a sandbox webhook.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fire the sandbox webhook.");
    } finally {
      setBusy(null);
    }
  }

  const configured = status?.configured === true;
  const canEdit = status?.canEdit === true && status?.denied !== true;
  const connected = (status?.items.length ?? 0) > 0;

  return (
    <main className="page">
      <PageToolbar dirty={false} saving={false} saved={false} onSave={() => undefined} listen={false} showSave={false}>
        <ToolbarButton
          icon={Plug}
          label="Connect bank"
          busy={busy === "link" || busy === "exchange"}
          disabled={!configured || !canEdit || status?.available === false || busy !== null}
          onClick={() => void startLink()}
        />
        <ToolbarButton
          icon={RefreshCw}
          label="Sync transactions"
          busy={busy === "sync"}
          disabled={!connected || !canEdit || busy !== null}
          onClick={() => void sync()}
        />
      </PageToolbar>
      {linkToken ? (
        <PlaidLinkSession
          token={linkToken}
          receivedRedirectUri={oauthRedirect}
          autoOpen={autoOpen}
          onSuccess={(publicToken) => void onLinked(publicToken)}
          onExit={onLinkExit}
        />
      ) : null}
      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner ok">{notice}</p> : null}
      {status?.denied ? <p className="banner error">{status.message}</p> : null}
      {status && !status.configured && !status.denied ? (
        <p className="banner warn" role="status">
          Add Plaid credentials. Set PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV (sandbox or production) on the server.
          The page keeps working without them.
        </p>
      ) : null}
      <section className="card integration-card">
        <h2>Bank feeds (Plaid)</h2>
        {loading ? <p className="muted">Loading bank feeds…</p> : null}
        {status ? (
          <>
            <p className="integration-status">
              <span className={`sync-pill ${connected ? "synced" : "local"}`}>
                {connected ? `${status.items.length} connected` : "Not connected"}
              </span>
              {status.environment ? <span className={`env-badge ${status.environment}`}>{status.environment}</span> : null}
            </p>
            {status.message && !status.denied ? <p className="banner error">{status.message}</p> : null}
            {!status.available ? <p className="hint">The Plaid tables are not in the database yet.</p> : null}
            <p className="hint">
              Link asks for Transactions in the US, including Bank of America. Sandbox can also use a test bank such as
              First Platypus Bank with username <code>user_good</code> and password <code>pass_good</code>. About{" "}
              {status.historyDays} days of history are requested. Money out is shown as a negative amount.
            </p>
            {status.environment === "sandbox" ? (
              <p className="hint">
                Sandbox Items are free test data. Production Trial, for a US or Canada team created on or after 15 Apr
                2026, covers up to 10 live Items. One Item is one bank login.
              </p>
            ) : null}
            {status.redirectUri ? (
              <p className="hint">
                OAuth redirect URI to register in the Plaid dashboard: <code>{status.redirectUri}</code>
              </p>
            ) : (
              <p className="hint">
                Bank of America uses OAuth. Set PLAID_REDIRECT_URI to this page and register that exact URL in the Plaid
                dashboard before connecting it. Sandbox test banks work without that URI.
              </p>
            )}
            {status.webhookUrl ? (
              <p className="hint">
                Webhook: <code>{status.webhookUrl}</code>
              </p>
            ) : (
              <p className="hint">Set PLAID_WEBHOOK_URL to the https address of /api/plaid/webhook when Plaid should push updates.</p>
            )}
            <p className="hint">Connect, sync, and disconnect stay in this page. The access token never comes back to the browser.</p>
          </>
        ) : null}
      </section>
      {status && status.items.length > 0 ? (
        <section className="card integration-card">
          <h2>Connected institutions</h2>
          {status.items.map((item) => (
            <article key={item.id} className="plaid-item">
              <div className="integration-status">
                <strong>{item.institutionName || item.institutionId || "Bank"}</strong>
                <span className={`sync-pill ${item.status === "active" ? "synced" : "local"}`}>{item.status === "login_required" ? "Login required" : item.status}</span>
                <span className={`env-badge ${item.environment}`}>{item.environment}</span>
              </div>
              <dl className="integration-facts">
                <div>
                  <dt>Last sync</dt>
                  <dd>{item.lastSyncedAt ? formatWhen(item.lastSyncedAt) : "Never"}</dd>
                </div>
                <div>
                  <dt>Connected</dt>
                  <dd>{formatWhen(item.connectedAt)}</dd>
                </div>
                <div>
                  <dt>History</dt>
                  <dd>{item.updateStatusLabel || "—"}</dd>
                </div>
              </dl>
              {item.errorMessage ? <p className="banner error">{item.errorMessage}</p> : null}
              {item.accounts.length > 0 ? (
                <ul className="plaid-accounts">
                  {item.accounts.map((account) => (
                    <li key={account.id}>
                      <span>{account.name || account.officialName || "Account"}</span>
                      {account.mask ? <span className="muted"> ···{account.mask}</span> : null}
                      <span className="muted">
                        {" "}
                        {account.subtype || account.accountType || ""}
                      </span>
                      <span>
                        {" "}
                        {formatMoney(account.currentBalance, account.currencyCode || "USD")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No accounts stored yet.</p>
              )}
              {canEdit ? (
                <p className="plaid-actions">
                  <button type="button" className="secondary" disabled={busy !== null} onClick={() => void sync(item.id)}>
                    {busy === `sync:${item.id}` ? "Syncing…" : "Sync"}
                  </button>
                  {item.status === "login_required" ? (
                    <button type="button" className="secondary" disabled={busy !== null} onClick={() => void startLink(item.id)}>
                      {busy === `repair:${item.id}` ? "Opening Link…" : "Repair connection"}
                    </button>
                  ) : null}
                  {status.environment === "sandbox" && item.environment === "sandbox" ? (
                    <button type="button" className="secondary" disabled={busy !== null} onClick={() => void fireWebhook(item.id)}>
                      {busy === `webhook:${item.id}` ? "Firing webhook…" : "Fire sandbox webhook"}
                    </button>
                  ) : null}
                  <button type="button" className="secondary" disabled={busy !== null} onClick={() => void disconnect(item)}>
                    {busy === `disconnect:${item.id}` ? "Disconnecting…" : "Disconnect"}
                  </button>
                </p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      <section className="card integration-card">
        <h2>Recent transactions</h2>
        {status && status.transactions.length > 0 ? (
          <div className="plaid-table-wrap">
            <table className="log-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Name</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {status.transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{transaction.postedOn}</td>
                    <td>
                      {transaction.accountName || "Account"}
                      {transaction.mask ? ` ···${transaction.mask}` : ""}
                    </td>
                    <td>
                      {transaction.merchantName || transaction.name || "—"}
                      {transaction.pending ? " (pending)" : ""}
                    </td>
                    <td>{formatMoney(transaction.statementAmount, transaction.currencyCode || "USD")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No transactions stored yet.</p>
        )}
      </section>
      <section className="card integration-card">
        <h2>Recent log</h2>
        {status && status.logs.length > 0 ? (
          <table className="log-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {status.logs.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatWhen(entry.startedAt)}</td>
                  <td>{entry.status}</td>
                  <td>{entry.message || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No Plaid activity yet.</p>
        )}
      </section>
    </main>
  );
}

function PlaidLinkSession({
  token,
  receivedRedirectUri,
  autoOpen,
  onSuccess,
  onExit,
}: {
  token: string;
  receivedRedirectUri?: string;
  autoOpen: boolean;
  onSuccess: (publicToken: string | null) => void;
  onExit: (error: { display_message?: string | null; error_message?: string | null } | null) => void;
}) {
  const { open, ready } = usePlaidLink({
    token,
    receivedRedirectUri,
    onSuccess: (publicToken) => onSuccess(publicToken),
    onExit: (error) => onExit(error),
  });

  useEffect(() => {
    if (ready && autoOpen) open();
  }, [ready, autoOpen, open]);

  return null;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
