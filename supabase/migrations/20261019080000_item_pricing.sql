-- Item prices, quote history, buy/sell transactions, and the sales window.
-- Row level security stays off on items and on these new inventory tables.
-- The app has no login, so the anon key must read and write them.
-- Credential tables are unchanged and stay service-role only.
-- Deploying this repository does not run this file. It is applied separately.

alter table public.items
  add column ecommerce_price numeric(12, 2),
  add column ecommerce_price_updated_at timestamptz,
  add column market_price numeric(12, 2),
  add column market_price_updated_at timestamptz,
  add column msrp numeric(12, 2),
  add column msrp_updated_at timestamptz,
  add column pricing_checked_at timestamptz;

alter table public.items
  add constraint items_ecommerce_price_nonnegative check (ecommerce_price is null or ecommerce_price >= 0),
  add constraint items_market_price_nonnegative check (market_price is null or market_price >= 0),
  add constraint items_msrp_nonnegative check (msrp is null or msrp >= 0);

comment on column public.items.ecommerce_price is 'USD ecommerce price. Null until set.';
comment on column public.items.market_price is 'USD market price. Null until set.';
comment on column public.items.msrp is 'USD manufacturer suggested retail price. Null until set.';
comment on column public.items.pricing_checked_at is 'When Update pricing last looked up quotes for this item.';

create or replace function public.items_price_timestamps()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.ecommerce_price is not null then
      new.ecommerce_price_updated_at := coalesce(new.ecommerce_price_updated_at, now());
    end if;
    if new.market_price is not null then
      new.market_price_updated_at := coalesce(new.market_price_updated_at, now());
    end if;
    if new.msrp is not null then
      new.msrp_updated_at := coalesce(new.msrp_updated_at, now());
    end if;
    return new;
  end if;

  if new.ecommerce_price is distinct from old.ecommerce_price then
    new.ecommerce_price_updated_at := now();
  end if;
  if new.market_price is distinct from old.market_price then
    new.market_price_updated_at := now();
  end if;
  if new.msrp is distinct from old.msrp then
    new.msrp_updated_at := now();
  end if;
  return new;
end;
$$;

create trigger items_price_timestamps
  before insert or update of ecommerce_price, market_price, msrp on public.items
  for each row
  execute function public.items_price_timestamps();

create table public.price_quotes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  source text not null,
  price numeric(12, 2) not null,
  currency text not null default 'USD',
  qty numeric(12, 2),
  condition text,
  vendor_id uuid references public.vendors (id) on delete set null,
  seller_name text,
  url text,
  notes text,
  captured_at timestamptz not null default now(),
  captured_by text,
  raw jsonb,
  outlier boolean not null default false,
  constraint price_quotes_source_known check (
    source in (
      'ebay_listed',
      'ebay_sold',
      'brokerbin',
      'inbound_quote',
      'reseller_listed',
      'buyback',
      'manual'
    )
  ),
  constraint price_quotes_price_positive check (price > 0),
  constraint price_quotes_currency_present check (char_length(btrim(currency)) > 0),
  constraint price_quotes_qty_positive check (qty is null or qty > 0)
);

create index price_quotes_item_captured_idx
  on public.price_quotes (item_id, captured_at desc);

create index price_quotes_item_source_idx
  on public.price_quotes (item_id, source, captured_at desc);

comment on table public.price_quotes is
  'Price observations. Rows are history and are not overwritten.';
comment on column public.price_quotes.outlier is
  'True when the price is under 30% or over 300% of the median for its currency in that capture.';

create table public.item_transactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  type text not null,
  txn_date date not null,
  qty numeric(12, 2) not null,
  unit_price numeric(12, 2) not null,
  total numeric(12, 2) generated always as (round(qty * unit_price, 2)) stored,
  customer_id uuid references public.customers (id) on delete set null,
  vendor_id uuid references public.vendors (id) on delete set null,
  reference text,
  source text not null default 'manual',
  notes text,
  created_at timestamptz not null default now(),
  constraint item_transactions_type_known check (type in ('buy', 'sell')),
  constraint item_transactions_source_known check (source in ('manual', 'qbo', 'ebay')),
  constraint item_transactions_qty_positive check (qty > 0),
  constraint item_transactions_unit_price_nonnegative check (unit_price >= 0),
  constraint item_transactions_sell_party check (type <> 'sell' or vendor_id is null),
  constraint item_transactions_buy_party check (type <> 'buy' or customer_id is null)
);

create unique index item_transactions_source_ref_item
  on public.item_transactions (source, reference, item_id)
  where reference is not null and btrim(reference) <> '';

create index item_transactions_item_date_idx
  on public.item_transactions (item_id, txn_date desc, created_at desc);

comment on table public.item_transactions is
  'Buys and sells for an item. Future QuickBooks and eBay imports insert rows and rely on the source, reference, and item unique key.';
comment on column public.item_transactions.total is 'qty times unit_price, rounded to cents. Generated by the database.';

create table public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  constraint app_settings_key_present check (char_length(btrim(key)) > 0)
);

comment on table public.app_settings is
  'App key/value settings. Not credentials. pricing_sales_window_days is the sales window.';

insert into public.app_settings (key, value)
values ('pricing_sales_window_days', '90');

-- RLS stays off, matching items. These tables hold prices and settings, not tokens.
alter table public.price_quotes disable row level security;
alter table public.item_transactions disable row level security;
alter table public.app_settings disable row level security;

grant all on table public.price_quotes to anon, authenticated, service_role;
grant all on table public.item_transactions to anon, authenticated, service_role;
grant all on table public.app_settings to anon, authenticated, service_role;

revoke all on function public.items_price_timestamps() from public;
grant execute on function public.items_price_timestamps() to anon, authenticated, service_role;
