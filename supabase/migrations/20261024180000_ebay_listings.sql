-- Active eBay listings read from the Trading API. One row per variation when a
-- listing has variations, otherwise one row with variation_sku null.
-- item_id is set during the pull by matching variation_sku, or sku when there
-- is no variation, to items.sku. Unmatched rows stay, with item_id null.
-- RLS is on with no policies. Only the service role can read or write.
-- Deploying this repository does not run this file. Apply it separately.

create table public.ebay_listings (
  id uuid primary key default gen_random_uuid(),
  ebay_item_id text not null,
  sku text,
  variation_sku text,
  variation_key text generated always as (coalesce(variation_sku, '')) stored,
  title text,
  quantity_available integer,
  listing_status text not null,
  listing_url text,
  item_id uuid references public.items (id) on delete set null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ebay_listings_item_id_not_blank check (char_length(btrim(ebay_item_id)) > 0),
  constraint ebay_listings_status_not_blank check (char_length(btrim(listing_status)) > 0),
  constraint ebay_listings_item_variation_key unique (ebay_item_id, variation_key)
);

comment on table public.ebay_listings is
  'Active eBay listings. RLS is enabled with no policies. Only the service role can read this table. No prices are stored.';

comment on column public.ebay_listings.sku is
  'Custom label on the listing. Matching uses variation_sku when that is set.';

comment on column public.ebay_listings.variation_sku is
  'Variation custom label. Null when the listing has no variations.';

comment on column public.ebay_listings.variation_key is
  'Stored coalesce(variation_sku, '''') so the unique key can be used for upsert.';

comment on column public.ebay_listings.item_id is
  'Item whose SKU matched this row during the last listings pull. Null when nothing matched.';

create index ebay_listings_item_id_idx on public.ebay_listings (item_id);
create index ebay_listings_status_fetched_idx on public.ebay_listings (listing_status, fetched_at);

alter table public.ebay_listings enable row level security;

revoke all on table public.ebay_listings from public, anon, authenticated;
grant all on table public.ebay_listings to service_role;

alter table public.ebay_sync_log drop constraint ebay_sync_log_entity_known;
alter table public.ebay_sync_log add constraint ebay_sync_log_entity_known check (
  entity in ('connection', 'notification', 'test', 'listings')
);

notify pgrst, 'reload schema';
