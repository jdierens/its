-- eBay order pull. One seed row gates the first history pull, and the
-- sync log may record an orders read. Deploying does not apply this file.

create table public.ebay_order_seed (
  id integer primary key,
  applied_at timestamptz not null default now(),
  linked integer not null default 0,
  skipped integer not null default 0,
  conflicts integer not null default 0,
  missing integer not null default 0,
  orders_watermark timestamptz,
  constraint ebay_order_seed_singleton check (id = 1),
  constraint ebay_order_seed_counts_check check (
    linked >= 0 and skipped >= 0 and conflicts >= 0 and missing >= 0
  )
);

comment on table public.ebay_order_seed is
  'One row after the legacy log map has filled ebay_order_id on existing sales orders. The order pull creates no drafts until this row exists. orders_watermark is the last successful pull.';

comment on column public.ebay_order_seed.orders_watermark is
  'Start of the last successful eBay order pull. Null until that pull finishes. A later pull reads orders changed since the day before this time.';

alter table public.ebay_order_seed enable row level security;

revoke all on table public.ebay_order_seed from public, anon, authenticated;
grant select, insert, update, delete on table public.ebay_order_seed to service_role;

create index sales_orders_ebay_sales_record_ref_idx
  on public.sales_orders (ebay_sales_record_ref)
  where ebay_sales_record_ref is not null;

alter table public.ebay_sync_log drop constraint ebay_sync_log_entity_known;
alter table public.ebay_sync_log add constraint ebay_sync_log_entity_known check (
  entity in ('connection', 'notification', 'test', 'listings', 'orders')
);

notify pgrst, 'reload schema';
