-- One CDC cursor and last-sync time per contact type.
-- Syncing customers does not move the vendor cursor.
-- The previous cursor was the started_at of the latest successful entity=sync pull.
-- Both entities inherit that timestamp so the next sync stays incremental.
-- Deploying this repository does not run this file. It is applied separately.

create table public.qbo_sync_cursor (
  entity text primary key,
  cdc_since timestamptz,
  last_sync_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint qbo_sync_cursor_entity_known check (entity in ('customer', 'vendor'))
);

comment on table public.qbo_sync_cursor is
  'Per-entity QuickBooks CDC cursor and last sync time. Server-only.';

alter table public.qbo_sync_cursor enable row level security;

revoke all on table public.qbo_sync_cursor from public, anon, authenticated;
grant all on table public.qbo_sync_cursor to service_role;

insert into public.qbo_sync_cursor (entity, cdc_since, last_sync_at)
select kinds.entity, watermark.started_at, watermark.started_at
from (values ('customer'), ('vendor')) as kinds (entity)
left join lateral (
  select started_at
  from public.qbo_sync_log
  where entity = 'sync'
    and direction = 'pull'
    and status = 'ok'
  order by started_at desc
  limit 1
) as watermark on true;
