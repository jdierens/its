-- QuickBooks Online customers, vendors, and the server-only token store.
-- customers, vendors, and qbo_sync_log follow the other app tables: row level
-- security stays off because this app has no login and the anon key is the client.
-- qbo_connection is the exception. It holds OAuth tokens, so RLS is on and there
-- are no policies. Grants for anon and authenticated are revoked. Only the
-- service role, used by server route handlers, can read or write tokens.
-- Deploying this repository does not run this file; it is applied separately.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  company_name text,
  given_name text,
  family_name text,
  primary_email text,
  phone text,
  billing_address jsonb,
  shipping_address jsonb,
  tax_id text,
  notes text,
  active boolean not null default true,
  qbo_id text,
  qbo_sync_token text,
  qbo_last_updated timestamptz,
  local_updated_at timestamptz not null default now(),
  sync_status text not null default 'local',
  created_at timestamptz not null default now(),
  constraint customers_display_name_not_blank check (char_length(btrim(display_name)) > 0),
  constraint customers_sync_status_known check (
    sync_status in ('local', 'pending', 'synced', 'error', 'conflict')
  )
);

create unique index customers_qbo_id_key on public.customers (qbo_id);
create index customers_sync_status_idx on public.customers (sync_status);
create index customers_display_name_idx on public.customers (lower(display_name));

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  company_name text,
  given_name text,
  family_name text,
  primary_email text,
  phone text,
  billing_address jsonb,
  shipping_address jsonb,
  tax_id text,
  notes text,
  active boolean not null default true,
  qbo_id text,
  qbo_sync_token text,
  qbo_last_updated timestamptz,
  local_updated_at timestamptz not null default now(),
  sync_status text not null default 'local',
  created_at timestamptz not null default now(),
  constraint vendors_display_name_not_blank check (char_length(btrim(display_name)) > 0),
  constraint vendors_sync_status_known check (
    sync_status in ('local', 'pending', 'synced', 'error', 'conflict')
  )
);

create unique index vendors_qbo_id_key on public.vendors (qbo_id);
create index vendors_sync_status_idx on public.vendors (sync_status);
create index vendors_display_name_idx on public.vendors (lower(display_name));

comment on column public.customers.billing_address is
  'Postal address: line1, line2, city, countrySubDivisionCode, postalCode, country.';
comment on column public.customers.tax_id is
  'Sent to QuickBooks as Customer.ResaleNum.';
comment on column public.vendors.tax_id is
  'Sent to QuickBooks as Vendor.TaxIdentifier.';
comment on column public.customers.sync_status is
  'local, pending, synced, error, or conflict. conflict means QuickBooks was kept.';

create table public.qbo_connection (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  connected_by text,
  updated_at timestamptz not null default now(),
  constraint qbo_connection_realm_id_not_blank check (char_length(btrim(realm_id)) > 0)
);

comment on table public.qbo_connection is
  'QuickBooks OAuth tokens. RLS is enabled with no policies. Only the service role can read this table.';

alter table public.qbo_connection enable row level security;

revoke all on table public.qbo_connection from public, anon, authenticated;
grant all on table public.qbo_connection to service_role;

create table public.qbo_sync_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  entity text not null,
  direction text not null,
  status text not null,
  message text,
  detail jsonb,
  created_at timestamptz not null default now(),
  constraint qbo_sync_log_entity_known check (
    entity in ('customer', 'vendor', 'connection', 'sync')
  ),
  constraint qbo_sync_log_direction_known check (
    direction in ('pull', 'push', 'oauth')
  ),
  constraint qbo_sync_log_status_known check (status in ('ok', 'error'))
);

create index qbo_sync_log_created_at_idx on public.qbo_sync_log (created_at desc);
create index qbo_sync_log_pull_watermark_idx
  on public.qbo_sync_log (started_at desc)
  where entity = 'sync' and direction = 'pull' and status = 'ok';

comment on table public.qbo_sync_log is
  'Sync and OAuth outcomes. Messages must not include tokens or full QuickBooks payloads.';

alter table public.customers disable row level security;
alter table public.vendors disable row level security;
alter table public.qbo_sync_log disable row level security;

create or replace function public.contacts_touch_local_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.local_updated_at := pg_catalog.now();
  return new;
end;
$$;

comment on function public.contacts_touch_local_updated_at() is
  'Sets local_updated_at on customer and vendor updates. Not used for authorization.';

revoke all on function public.contacts_touch_local_updated_at() from public, anon, authenticated;

create trigger customers_touch_local_updated_at
before update on public.customers
for each row
execute function public.contacts_touch_local_updated_at();

create trigger vendors_touch_local_updated_at
before update on public.vendors
for each row
execute function public.contacts_touch_local_updated_at();

notify pgrst, 'reload schema';
