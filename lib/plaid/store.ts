import type { SupabaseClient } from "@supabase/supabase-js";
import { plaidSchemaMissing } from "@/lib/plaid/errors";
import type { AccountRow, ItemRow, TransactionRow } from "@/lib/plaid/types";
import { requireServiceSupabase } from "@/lib/supabaseAdmin";

export function plaidDb(): SupabaseClient {
  return requireServiceSupabase();
}

export async function listItems(): Promise<{ rows: ItemRow[]; missing: boolean }> {
  const { data, error } = await plaidDb()
    .from("plaid_items")
    .select(
      "id, item_id, access_token, environment, institution_id, institution_name, status, error_code, error_message, transactions_cursor, transactions_update_status, consent_expiration_time, webhook_url, connected_by, connected_at, last_synced_at",
    )
    .order("connected_at", { ascending: false });
  if (error) {
    if (plaidSchemaMissing(error)) return { rows: [], missing: true };
    throw new Error(error.message);
  }
  return { rows: (data ?? []) as ItemRow[], missing: false };
}

export async function loadItem(id: string): Promise<ItemRow | null> {
  const { data, error } = await plaidDb()
    .from("plaid_items")
    .select(
      "id, item_id, access_token, environment, institution_id, institution_name, status, error_code, error_message, transactions_cursor, transactions_update_status, consent_expiration_time, webhook_url, connected_by, connected_at, last_synced_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (plaidSchemaMissing(error)) throw new Error("Apply the Plaid migration before connecting a bank.");
    throw new Error(error.message);
  }
  return (data as ItemRow | null) ?? null;
}

export async function loadItemByPlaidId(itemId: string): Promise<ItemRow | null> {
  const { data, error } = await plaidDb()
    .from("plaid_items")
    .select(
      "id, item_id, access_token, environment, institution_id, institution_name, status, error_code, error_message, transactions_cursor, transactions_update_status, consent_expiration_time, webhook_url, connected_by, connected_at, last_synced_at",
    )
    .eq("item_id", itemId)
    .maybeSingle();
  if (error) {
    if (plaidSchemaMissing(error)) return null;
    throw new Error(error.message);
  }
  return (data as ItemRow | null) ?? null;
}

export async function listAccounts(itemIds: string[]): Promise<AccountRow[]> {
  if (itemIds.length === 0) return [];
  const { data, error } = await plaidDb()
    .from("plaid_accounts")
    .select(
      "id, plaid_item_id, account_id, name, official_name, mask, account_type, subtype, currency_code, current_balance, available_balance",
    )
    .in("plaid_item_id", itemIds)
    .order("name", { ascending: true });
  if (error) {
    if (plaidSchemaMissing(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as AccountRow[];
}

export async function listRecentTransactions(limit: number): Promise<TransactionRow[]> {
  const { data, error } = await plaidDb()
    .from("plaid_transactions")
    .select(
      "id, plaid_item_id, account_id, amount, currency_code, posted_on, name, merchant_name, pending, payment_channel, category",
    )
    .order("posted_on", { ascending: false })
    .limit(limit);
  if (error) {
    if (plaidSchemaMissing(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as TransactionRow[];
}

export async function listLogs(limit: number): Promise<
  {
    id: string;
    started_at: string;
    finished_at: string | null;
    entity: string;
    direction: string;
    status: string;
    message: string | null;
  }[]
> {
  const { data, error } = await plaidDb()
    .from("plaid_sync_log")
    .select("id, started_at, finished_at, entity, direction, status, message")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (plaidSchemaMissing(error)) return [];
    return [];
  }
  return (data ?? []) as {
    id: string;
    started_at: string;
    finished_at: string | null;
    entity: string;
    direction: string;
    status: string;
    message: string | null;
  }[];
}
