-- Plaid bank feeds. Access tokens stay server-only.
-- plaid_items follows ebay_connection and qbo_connection: row level security is
-- on, there are no policies, and anon/authenticated grants are revoked. Only
-- the service role, used by server route handlers, can read or write tokens.
-- Accounts, transactions, and the sync log use the same grants. The browser
-- never selects these tables. Staff and admin reach them through route handlers
-- after the app checks the signed-in role.
-- Deploying this repository does not run this file. Apply it by hand on
-- project fxsbpreasbdalwthyzvk.

create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  access_token text not null,
  environment text not null,
  institution_id text,
  institution_name text,
  status text not null default 'active',
  error_code text,
  error_message text,
  transactions_cursor text,
  transactions_update_status text,
  consent_expiration_time timestamptz,
  webhook_url text,
  connected_by text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint plaid_items_item_id_key unique (item_id),
  constraint plaid_items_item_id_not_blank check (char_length(btrim(item_id)) > 0),
  constraint plaid_items_access_token_not_blank check (char_length(btrim(access_token)) > 0),
  constraint plaid_items_environment_known check (environment in ('sandbox', 'production')),
  constraint plaid_items_status_known check (status in ('active', 'error', 'login_required')),
  constraint plaid_items_update_status_known check (
    transactions_update_status is null
    or transactions_update_status in (
      'TRANSACTIONS_UPDATE_STATUS_UNKNOWN',
      'NOT_READY',
      'INITIAL_UPDATE_COMPLETE',
      'HISTORICAL_UPDATE_COMPLETE'
    )
  )
);

comment on table public.plaid_items is
  'Plaid Items and access tokens. RLS is enabled with no policies. Only the service role can read this table. Do not select access_token into a browser response.';

comment on column public.plaid_items.access_token is
  'Plaid access token. Server only. Never return this column to the browser.';

comment on column public.plaid_items.transactions_cursor is
  'Cursor from /transactions/sync. Empty until the first sync page returns one.';

comment on column public.plaid_items.status is
  'active, error, or login_required. login_required means Link update mode.';

alter table public.plaid_items enable row level security;

revoke all on table public.plaid_items from public, anon, authenticated;
grant all on table public.plaid_items to service_role;

create table public.plaid_accounts (
  id uuid primary key default gen_random_uuid(),
  plaid_item_id uuid not null references public.plaid_items (id) on delete cascade,
  account_id text not null,
  name text,
  official_name text,
  mask text,
  account_type text,
  subtype text,
  currency_code text,
  current_balance numeric(14, 2),
  available_balance numeric(14, 2),
  updated_at timestamptz not null default now(),
  constraint plaid_accounts_item_account_key unique (plaid_item_id, account_id),
  constraint plaid_accounts_account_id_not_blank check (char_length(btrim(account_id)) > 0)
);

create index plaid_accounts_item_idx on public.plaid_accounts (plaid_item_id);

comment on table public.plaid_accounts is
  'Accounts on a Plaid Item. Balances come from /accounts/get and /transactions/sync. No routing or account numbers.';

alter table public.plaid_accounts enable row level security;

revoke all on table public.plaid_accounts from public, anon, authenticated;
grant all on table public.plaid_accounts to service_role;

create table public.plaid_transactions (
  id uuid primary key default gen_random_uuid(),
  plaid_item_id uuid not null references public.plaid_items (id) on delete cascade,
  plaid_account_id uuid references public.plaid_accounts (id) on delete set null,
  transaction_id text not null,
  account_id text not null,
  amount numeric(14, 2) not null,
  currency_code text,
  posted_on date not null,
  name text,
  merchant_name text,
  pending boolean not null default false,
  payment_channel text,
  category jsonb,
  updated_at timestamptz not null default now(),
  constraint plaid_transactions_transaction_id_key unique (transaction_id),
  constraint plaid_transactions_transaction_id_not_blank check (char_length(btrim(transaction_id)) > 0),
  constraint plaid_transactions_account_id_not_blank check (char_length(btrim(account_id)) > 0)
);

create index plaid_transactions_item_idx on public.plaid_transactions (plaid_item_id);
create index plaid_transactions_account_idx on public.plaid_transactions (plaid_account_id);
create index plaid_transactions_item_posted_idx on public.plaid_transactions (plaid_item_id, posted_on desc);

comment on table public.plaid_transactions is
  'Transactions from /transactions/sync. amount uses Plaid sign: positive is money out, negative is money in. The raw Plaid payload is not stored.';

comment on column public.plaid_transactions.amount is
  'Plaid amount. Positive when money leaves the account. Negative when money arrives.';

alter table public.plaid_transactions enable row level security;

revoke all on table public.plaid_transactions from public, anon, authenticated;
grant all on table public.plaid_transactions to service_role;

create table public.plaid_sync_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  entity text not null,
  direction text not null,
  status text not null,
  message text,
  detail jsonb,
  created_at timestamptz not null default now(),
  constraint plaid_sync_log_entity_known check (
    entity in ('connection', 'item', 'sync', 'webhook')
  ),
  constraint plaid_sync_log_direction_known check (
    direction in ('link', 'sync', 'webhook', 'remove')
  ),
  constraint plaid_sync_log_status_known check (status in ('ok', 'error'))
);

create index plaid_sync_log_created_at_idx on public.plaid_sync_log (created_at desc);

comment on table public.plaid_sync_log is
  'Plaid connection and sync events. Do not store access tokens, public tokens, or link tokens.';

alter table public.plaid_sync_log enable row level security;

revoke all on table public.plaid_sync_log from public, anon, authenticated;
grant all on table public.plaid_sync_log to service_role;

notify pgrst, 'reload schema';
