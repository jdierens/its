-- eBay seller connection. Tokens stay server-only.
-- ebay_connection follows qbo_connection: row level security is on, there are
-- no policies, and anon/authenticated grants are revoked. Only the service role,
-- used by server route handlers, can read or write tokens.
-- ebay_sync_log follows qbo_sync_log: row level security stays off so Admin >
-- Integrations can show recent events. Messages must not include tokens or
-- buyer personal data.
-- Deploying this repository does not run this file; it is applied separately.

create table public.ebay_connection (
  id uuid primary key default gen_random_uuid(),
  environment text not null,
  ebay_user_id text,
  username text,
  access_token text not null,
  access_expires_at timestamptz not null,
  refresh_token text not null,
  refresh_expires_at timestamptz,
  scopes text,
  needs_reconnect boolean not null default false,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_connection_environment_known check (environment in ('sandbox', 'production')),
  constraint ebay_connection_access_token_not_blank check (char_length(btrim(access_token)) > 0),
  constraint ebay_connection_refresh_token_not_blank check (char_length(btrim(refresh_token)) > 0)
);

comment on table public.ebay_connection is
  'eBay OAuth tokens. RLS is enabled with no policies. Only the service role can read this table.';

comment on column public.ebay_connection.needs_reconnect is
  'Set when the refresh token is rejected or past its expiry. The seller must connect again.';

alter table public.ebay_connection enable row level security;

revoke all on table public.ebay_connection from public, anon, authenticated;
grant all on table public.ebay_connection to service_role;

create table public.ebay_sync_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  entity text not null,
  direction text not null,
  status text not null,
  message text,
  detail jsonb,
  created_at timestamptz not null default now(),
  constraint ebay_sync_log_entity_known check (
    entity in ('connection', 'notification', 'test')
  ),
  constraint ebay_sync_log_direction_known check (
    direction in ('oauth', 'notification', 'read')
  ),
  constraint ebay_sync_log_status_known check (status in ('ok', 'error'))
);

create index ebay_sync_log_created_at_idx on public.ebay_sync_log (created_at desc);

comment on table public.ebay_sync_log is
  'eBay connection events. Detail may include rlogid and X-EBAY-C-REQUEST-ID. Do not store tokens or buyer personal data.';

alter table public.ebay_sync_log disable row level security;

notify pgrst, 'reload schema';
