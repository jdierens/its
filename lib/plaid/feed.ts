import {
  CountryCode,
  Products,
  SandboxItemFireWebhookRequestWebhookCodeEnum,
  WebhookType,
  type AccountBase,
} from "plaid";
import { plaidApi } from "@/lib/plaid/client";
import {
  PLAID_HISTORY_DAYS,
  PLAID_SYNC_COUNT,
  PLAID_SYNC_PAGE_LIMIT,
  plaidConfigProblems,
  readPlaidConfig,
  type PlaidConfig,
} from "@/lib/plaid/config";
import { PlaidCallError, plaidSchemaMissing, readPlaidError } from "@/lib/plaid/errors";
import { mapAccount, mapTransaction, statementAmount, updateStatusLabel, type MappedAccount, type MappedTransaction } from "@/lib/plaid/map";
import { listAccounts, listItems, listLogs, listRecentTransactions, loadItem, loadItemByPlaidId, plaidDb } from "@/lib/plaid/store";
import {
  exposesSecret,
  publicItem,
  type AccountRow,
  type ItemRow,
  type PlaidAccountView,
  type PlaidStatus,
  type PlaidTransactionView,
  type TransactionRow,
} from "@/lib/plaid/types";
import { getServiceSupabase } from "@/lib/supabaseAdmin";

const ITEM_COLUMNS =
  "id, item_id, access_token, environment, institution_id, institution_name, status, error_code, error_message, transactions_cursor, transactions_update_status, consent_expiration_time, webhook_url, connected_by, connected_at, last_synced_at";

export type SyncReport = {
  id: string;
  institutionName: string | null;
  added: number;
  modified: number;
  removed: number;
  hasMore: boolean;
  updateStatus: string | null;
  message: string;
};

export async function plaidStatus(deniedMessage: string | null): Promise<PlaidStatus> {
  const config = readPlaidConfig();
  const base = emptyStatus(config);
  if (deniedMessage) return { ...base, denied: true, canEdit: false, message: deniedMessage };
  if (!getServiceSupabase()) {
    return { ...base, message: "Set SUPABASE_SERVICE_ROLE_KEY on the server to store the bank connection." };
  }
  try {
    const items = await listItems();
    if (items.missing) {
      return {
        ...base,
        available: false,
        message: "Apply the Plaid migration before connecting a bank.",
      };
    }
    const accounts = await listAccounts(items.rows.map((row) => row.id));
    const transactions = await listRecentTransactions(40);
    const logs = await listLogs(8);
    const byItem = new Map<string, PlaidAccountView[]>();
    for (const account of accounts) {
      const view = accountView(account);
      const list = byItem.get(account.plaid_item_id) ?? [];
      list.push(view);
      byItem.set(account.plaid_item_id, list);
    }
    const accountNames = new Map<string, { name: string | null; mask: string | null }>();
    for (const account of accounts) {
      accountNames.set(`${account.plaid_item_id}:${account.account_id}`, {
        name: account.name,
        mask: account.mask,
      });
    }
    const views = items.rows.map((row) => {
      const view = publicItem(row, byItem.get(row.id) ?? []);
      view.updateStatusLabel = updateStatusLabel(row.transactions_update_status);
      return view;
    });
    const status: PlaidStatus = {
      ...base,
      available: true,
      items: views,
      transactions: transactions.map((row) => transactionView(row, accountNames)),
      logs: logs.map((row) => ({
        id: row.id,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        entity: row.entity,
        direction: row.direction,
        status: row.status,
        message: row.message,
      })),
    };
    if (exposesSecret(status)) throw new Error("Bank feed status included a secret.");
    return status;
  } catch (error) {
    return { ...base, message: error instanceof Error ? error.message : "Could not read bank feeds." };
  }
}

export async function createLinkToken(input: { itemId: string | null }): Promise<{ linkToken: string; expiration: string }> {
  const config = requireConfig();
  const client = plaidApi(config);
  let accessToken: string | undefined;
  if (input.itemId) {
    const item = await requireItem(input.itemId, config);
    accessToken = item.access_token;
  }
  try {
    const response = await client.linkTokenCreate({
      user: { client_user_id: config.clientUserId },
      client_name: "ITS",
      language: "en",
      country_codes: [CountryCode.Us],
      ...(accessToken
        ? { access_token: accessToken }
        : {
            products: [Products.Transactions],
            transactions: { days_requested: PLAID_HISTORY_DAYS },
          }),
      ...(config.webhookUrl && !accessToken ? { webhook: config.webhookUrl } : {}),
      ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
    });
    return { linkToken: response.data.link_token, expiration: response.data.expiration };
  } catch (error) {
    throw asCallError(error);
  }
}

export async function exchangePublicToken(publicToken: string, connectedBy: string | null): Promise<{ id: string }> {
  const config = requireConfig();
  const client = plaidApi(config);
  let accessToken = "";
  let itemId = "";
  try {
    const exchanged = await client.itemPublicTokenExchange({ public_token: publicToken });
    accessToken = exchanged.data.access_token;
    itemId = exchanged.data.item_id;
  } catch (error) {
    throw asCallError(error);
  }
  const saved = await rememberItem({
    itemId,
    accessToken,
    environment: config.environment,
    connectedBy,
    webhookUrl: config.webhookUrl,
  });
  try {
    await refreshInstitution(config, saved);
    await syncItem(saved.id);
  } catch (error) {
    const parsed = readPlaidError(error);
    await markItemError(saved.id, parsed.code, parsed.message);
    await writeLog({
      entity: "sync",
      direction: "sync",
      status: "error",
      message: parsed.message,
      detail: { itemId, code: parsed.code },
    });
  }
  await writeLog({
    entity: "connection",
    direction: "link",
    status: "ok",
    message: "Bank connected.",
    detail: { itemId },
  });
  return { id: saved.id };
}

export async function syncItem(id: string): Promise<SyncReport> {
  const config = requireConfig();
  const item = await requireItem(id, config);
  return syncStoredItem(config, item);
}

export async function syncAll(): Promise<SyncReport[]> {
  const config = requireConfig();
  const listed = await listItems();
  if (listed.missing) throw new Error("Apply the Plaid migration before syncing.");
  const reports: SyncReport[] = [];
  for (const item of listed.rows) {
    if (item.environment !== config.environment) continue;
    reports.push(await syncStoredItem(config, item));
  }
  return reports;
}

export async function syncByPlaidItemId(itemId: string): Promise<void> {
  const config = readPlaidConfig();
  if (!config || !getServiceSupabase()) return;
  const item = await loadItemByPlaidId(itemId);
  if (!item || item.environment !== config.environment) return;
  await syncStoredItem(config, item);
}

export async function disconnectItem(id: string): Promise<string> {
  const config = requireConfig();
  const item = await loadItem(id);
  if (!item) return "That bank connection is already gone.";
  const name = item.institution_name || "bank";
  if (item.environment !== config.environment) {
    await plaidDb().from("plaid_items").delete().eq("id", item.id);
    const message = `${name} was connected in ${item.environment}. PLAID_ENV is ${config.environment}, so Plaid was not asked to remove it. The local copy was deleted. Remove the Item in the Plaid dashboard if it is still billed.`;
    await writeLog({ entity: "item", direction: "remove", status: "ok", message, detail: { itemId: item.item_id } });
    return message;
  }
  try {
    await plaidApi(config).itemRemove({ access_token: item.access_token });
  } catch (error) {
    const parsed = readPlaidError(error);
    if (parsed.code !== "ITEM_NOT_FOUND" && parsed.code !== "INVALID_ACCESS_TOKEN") {
      throw new PlaidCallError(parsed.message, parsed.code);
    }
  }
  const { error } = await plaidDb().from("plaid_items").delete().eq("id", item.id);
  if (error) throw new Error(error.message);
  const message = `Disconnected ${name}.`;
  await writeLog({ entity: "item", direction: "remove", status: "ok", message, detail: { itemId: item.item_id } });
  return message;
}

export async function fireSandboxWebhook(id: string): Promise<string> {
  const config = requireConfig();
  if (config.environment !== "sandbox") throw new Error("Sandbox webhooks are only fired when PLAID_ENV is sandbox.");
  if (!config.webhookUrl) throw new Error("Set PLAID_WEBHOOK_URL to an https address Plaid can reach.");
  const item = await requireItem(id, config);
  try {
    const response = await plaidApi(config).sandboxItemFireWebhook({
      access_token: item.access_token,
      webhook_type: WebhookType.Transactions,
      webhook_code: SandboxItemFireWebhookRequestWebhookCodeEnum.SyncUpdatesAvailable,
    });
    const message = response.data.webhook_fired
      ? "Plaid queued a sandbox webhook. It arrives only if PLAID_WEBHOOK_URL is public."
      : "Plaid did not fire the sandbox webhook.";
    await writeLog({
      entity: "webhook",
      direction: "webhook",
      status: response.data.webhook_fired ? "ok" : "error",
      message,
      detail: { itemId: item.item_id, requestId: response.data.request_id },
    });
    return message;
  } catch (error) {
    throw asCallError(error);
  }
}

export async function noteItemWebhook(input: {
  itemId: string;
  code: string;
  errorCode: string | null;
  errorMessage: string | null;
}): Promise<"sync" | "ignore"> {
  const item = await loadItemByPlaidId(input.itemId);
  if (!item) {
    await writeLog({
      entity: "webhook",
      direction: "webhook",
      status: "ok",
      message: `Ignored ${input.code} for an unknown Item.`,
      detail: { itemId: input.itemId },
    });
    return "ignore";
  }
  if (input.code === "ERROR" || input.code === "USER_PERMISSION_REVOKED" || input.code === "PENDING_DISCONNECT") {
    const login = input.errorCode === "ITEM_LOGIN_REQUIRED" || input.code === "USER_PERMISSION_REVOKED";
    await markItemError(item.id, input.errorCode ?? input.code, input.errorMessage ?? input.code);
    if (login) {
      await plaidDb().from("plaid_items").update({ status: "login_required", updated_at: new Date().toISOString() }).eq("id", item.id);
    }
  }
  if (input.code === "LOGIN_REPAIRED") {
    await plaidDb()
      .from("plaid_items")
      .update({ status: "active", error_code: null, error_message: null, updated_at: new Date().toISOString() })
      .eq("id", item.id);
  }
  await writeLog({
    entity: "webhook",
    direction: "webhook",
    status: input.code === "ERROR" ? "error" : "ok",
    message: input.errorMessage ? `${input.code}: ${input.errorMessage}` : `Plaid webhook ${input.code}.`,
    detail: { itemId: input.itemId, code: input.code, errorCode: input.errorCode },
  });
  if (input.code === "SYNC_UPDATES_AVAILABLE" || input.code === "LOGIN_REPAIRED" || input.code === "DEFAULT_UPDATE") {
    return "sync";
  }
  return "ignore";
}

async function syncStoredItem(config: PlaidConfig, item: ItemRow): Promise<SyncReport> {
  const client = plaidApi(config);
  const started = item.transactions_cursor?.trim() || undefined;
  let cursor = started;
  let added = 0;
  let modified = 0;
  let removed = 0;
  let hasMore = true;
  let pages = 0;
  let restarted = false;
  let updateStatus: string | null = item.transactions_update_status;
  try {
    await refreshAccounts(config, item);
    while (hasMore && pages < PLAID_SYNC_PAGE_LIMIT) {
      let response;
      try {
        response = await client.transactionsSync({
          access_token: item.access_token,
          count: PLAID_SYNC_COUNT,
          ...(cursor ? { cursor } : {}),
        });
      } catch (error) {
        const parsed = readPlaidError(error);
        if (parsed.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && !restarted) {
          restarted = true;
          cursor = started;
          added = 0;
          modified = 0;
          removed = 0;
          pages = 0;
          hasMore = true;
          continue;
        }
        throw error;
      }
      const pageAdded = response.data.added.map(mapTransaction).filter((row): row is MappedTransaction => row !== null);
      const pageModified = response.data.modified.map(mapTransaction).filter((row): row is MappedTransaction => row !== null);
      const pageRemoved = response.data.removed
        .map((row) => (typeof row.transaction_id === "string" ? row.transaction_id : ""))
        .filter((id) => id.length > 0);
      await applyTransactions(item.id, [...pageAdded, ...pageModified], pageRemoved);
      added += pageAdded.length;
      modified += pageModified.length;
      removed += pageRemoved.length;
      const next = response.data.next_cursor.trim();
      if (next) cursor = next;
      hasMore = response.data.has_more;
      updateStatus = response.data.transactions_update_status;
      pages += 1;
      if (response.data.accounts.length > 0) await upsertAccounts(item.id, response.data.accounts);
    }
  } catch (error) {
    const parsed = readPlaidError(error);
    await markItemError(item.id, parsed.code, parsed.message);
    await writeLog({
      entity: "sync",
      direction: "sync",
      status: "error",
      message: parsed.message,
      detail: { itemId: item.item_id, code: parsed.code },
    });
    throw new PlaidCallError(parsed.message, parsed.code);
  }

  const finished = !hasMore;
  await plaidDb()
    .from("plaid_items")
    .update({
      transactions_cursor: cursor ?? null,
      transactions_update_status: updateStatus,
      last_synced_at: new Date().toISOString(),
      status: "active",
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  const label = updateStatusLabel(updateStatus);
  const message = finished
    ? `${item.institution_name || "Bank"}: ${added} new, ${modified} updated, ${removed} removed.${label ? ` ${label}` : ""}`
    : `${item.institution_name || "Bank"}: saved one batch. Sync again to continue.`;
  await writeLog({
    entity: "sync",
    direction: "sync",
    status: "ok",
    message,
    detail: { itemId: item.item_id, added, modified, removed, hasMore },
  });
  return {
    id: item.id,
    institutionName: item.institution_name,
    added,
    modified,
    removed,
    hasMore,
    updateStatus,
    message,
  };
}

async function refreshAccounts(config: PlaidConfig, item: ItemRow): Promise<void> {
  try {
    const response = await plaidApi(config).accountsGet({ access_token: item.access_token });
    await upsertAccounts(item.id, response.data.accounts);
  } catch (error) {
    const parsed = readPlaidError(error);
    if (parsed.code === "ITEM_LOGIN_REQUIRED") throw new PlaidCallError(parsed.message, parsed.code);
  }
}

async function refreshInstitution(config: PlaidConfig, item: ItemRow): Promise<void> {
  const response = await plaidApi(config).itemGet({ access_token: item.access_token });
  const remote = response.data.item;
  let name = text(remote.institution_name);
  const institutionId = text(remote.institution_id);
  if (!name && institutionId) {
    try {
      const institution = await plaidApi(config).institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      name = text(institution.data.institution.name);
    } catch {
      name = null;
    }
  }
  await plaidDb()
    .from("plaid_items")
    .update({
      institution_id: institutionId,
      institution_name: name,
      consent_expiration_time: text(remote.consent_expiration_time),
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  item.institution_id = institutionId;
  item.institution_name = name;
}

async function rememberItem(input: {
  itemId: string;
  accessToken: string;
  environment: string;
  connectedBy: string | null;
  webhookUrl: string | null;
}): Promise<ItemRow> {
  const now = new Date().toISOString();
  const existing = await loadItemByPlaidId(input.itemId);
  if (existing) {
    const { data, error } = await plaidDb()
      .from("plaid_items")
      .update({
        access_token: input.accessToken,
        environment: input.environment,
        status: "active",
        error_code: null,
        error_message: null,
        webhook_url: input.webhookUrl,
        updated_at: now,
      })
      .eq("id", existing.id)
      .select(ITEM_COLUMNS)
      .single();
    if (error) throw new Error(schemaOr(error));
    return data as ItemRow;
  }
  const { data, error } = await plaidDb()
    .from("plaid_items")
    .insert({
      item_id: input.itemId,
      access_token: input.accessToken,
      environment: input.environment,
      status: "active",
      webhook_url: input.webhookUrl,
      connected_by: input.connectedBy,
      connected_at: now,
      updated_at: now,
    })
    .select(ITEM_COLUMNS)
    .single();
  if (error || !data) {
    try {
      await plaidApi(requireConfig()).itemRemove({ access_token: input.accessToken });
    } catch {
      // The local insert failed. Removing the new Item avoids leaving a billed login we cannot store.
    }
    throw new Error(error ? schemaOr(error) : "Could not store the bank connection.");
  }
  return data as ItemRow;
}

async function upsertAccounts(itemId: string, accounts: AccountBase[]): Promise<void> {
  const mapped = accounts.map(mapAccount).filter((row): row is MappedAccount => row !== null);
  if (mapped.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await plaidDb().from("plaid_accounts").upsert(
    mapped.map((account) => ({
      plaid_item_id: itemId,
      account_id: account.accountId,
      name: account.name,
      official_name: account.officialName,
      mask: account.mask,
      account_type: account.accountType,
      subtype: account.subtype,
      currency_code: account.currencyCode,
      current_balance: account.currentBalance,
      available_balance: account.availableBalance,
      updated_at: now,
    })),
    { onConflict: "plaid_item_id,account_id" },
  );
  if (error) throw new Error(error.message);
}

async function applyTransactions(itemId: string, transactions: MappedTransaction[], removed: string[]): Promise<void> {
  const accounts = await listAccounts([itemId]);
  const accountIds = new Map(accounts.map((account) => [account.account_id, account.id]));
  if (transactions.length > 0) {
    const now = new Date().toISOString();
    const { error } = await plaidDb().from("plaid_transactions").upsert(
      transactions.map((transaction) => ({
        plaid_item_id: itemId,
        plaid_account_id: accountIds.get(transaction.accountId) ?? null,
        transaction_id: transaction.transactionId,
        account_id: transaction.accountId,
        amount: transaction.amount,
        currency_code: transaction.currencyCode,
        posted_on: transaction.postedOn,
        name: transaction.name,
        merchant_name: transaction.merchantName,
        pending: transaction.pending,
        payment_channel: transaction.paymentChannel,
        category: transaction.category,
        updated_at: now,
      })),
      { onConflict: "transaction_id" },
    );
    if (error) throw new Error(error.message);
  }
  if (removed.length > 0) {
    const { error } = await plaidDb()
      .from("plaid_transactions")
      .delete()
      .eq("plaid_item_id", itemId)
      .in("transaction_id", removed);
    if (error) throw new Error(error.message);
  }
}

async function markItemError(id: string, code: string | null, message: string): Promise<void> {
  const login = code === "ITEM_LOGIN_REQUIRED";
  await plaidDb()
    .from("plaid_items")
    .update({
      status: login ? "login_required" : "error",
      error_code: code,
      error_message: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

async function requireItem(id: string, config: PlaidConfig): Promise<ItemRow> {
  const item = await loadItem(id);
  if (!item) throw new Error("That bank connection was not found.");
  if (item.environment !== config.environment) {
    throw new Error(
      `This Item was connected in ${item.environment}. PLAID_ENV is ${config.environment}. Disconnect it, or switch PLAID_ENV, before using it.`,
    );
  }
  return item;
}

function requireConfig(): PlaidConfig {
  const config = readPlaidConfig();
  if (!config) throw new Error("Add Plaid credentials before connecting a bank.");
  if (!getServiceSupabase()) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY on the server.");
  return config;
}

function asCallError(error: unknown): PlaidCallError {
  const parsed = readPlaidError(error);
  return new PlaidCallError(parsed.message, parsed.code);
}

function schemaOr(error: { code?: string; message?: string }): string {
  if (plaidSchemaMissing(error)) return "Apply the Plaid migration before connecting a bank.";
  return error.message || "Could not store the bank connection.";
}

async function writeLog(entry: {
  entity: "connection" | "item" | "sync" | "webhook";
  direction: "link" | "sync" | "webhook" | "remove";
  status: "ok" | "error";
  message: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const detail = !entry.detail ? null : exposesSecret(entry.detail) ? { redacted: true } : entry.detail;
  const { error } = await plaidDb().from("plaid_sync_log").insert({
    entity: entry.entity,
    direction: entry.direction,
    status: entry.status,
    message: entry.message.slice(0, 500),
    detail,
    finished_at: new Date().toISOString(),
  });
  if (error && !plaidSchemaMissing(error)) {
    // A log failure should not hide the bank result.
  }
}

function emptyStatus(config: PlaidConfig | null): PlaidStatus {
  return {
    configured: Boolean(config),
    environment: config?.environment ?? null,
    serviceRole: Boolean(getServiceSupabase()),
    available: true,
    canEdit: true,
    denied: false,
    webhookUrl: config?.webhookUrl ?? null,
    redirectUri: config?.redirectUri ?? null,
    historyDays: PLAID_HISTORY_DAYS,
    message: plaidConfigProblems()[0] ?? null,
    items: [],
    transactions: [],
    logs: [],
  };
}

function accountView(row: AccountRow): PlaidAccountView {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    officialName: row.official_name,
    mask: row.mask,
    accountType: row.account_type,
    subtype: row.subtype,
    currencyCode: row.currency_code,
    currentBalance: numberOrNull(row.current_balance),
    availableBalance: numberOrNull(row.available_balance),
  };
}

function transactionView(
  row: TransactionRow,
  accounts: Map<string, { name: string | null; mask: string | null }>,
): PlaidTransactionView {
  const amount = numberOrNull(row.amount) ?? 0;
  const account = accounts.get(`${row.plaid_item_id}:${row.account_id}`);
  const category = row.category?.detailed || row.category?.primary || null;
  return {
    id: row.id,
    itemId: row.plaid_item_id,
    accountId: row.account_id,
    accountName: account?.name ?? null,
    mask: account?.mask ?? null,
    amount,
    statementAmount: statementAmount(amount),
    currencyCode: row.currency_code,
    postedOn: row.posted_on,
    name: row.name,
    merchantName: row.merchant_name,
    pending: row.pending,
    paymentChannel: row.payment_channel,
    category,
  };
}

function numberOrNull(value: number | string | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
