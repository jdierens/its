-- Migration: price_quotes_research
-- Let price_quotes hold market research for parts not yet in items, with
-- identifying fields, a normalized part number, shipping, and sold-vs-asking.
-- Table has 0 rows today. Revised per Elon's review (2026-10-23):
--   1) condition stays raw free text; new condition_class carries the check.
--   2) before-insert trigger backfills part_number from the linked item so
--      ON DELETE SET NULL never violates the item-or-part check.
--   3) generated part_number_norm (upper, strip whitespace, '-' and '/'),
--      with btree + trigram indexes on it.

alter table public.price_quotes alter column item_id drop not null;

alter table public.price_quotes drop constraint price_quotes_item_id_fkey;
alter table public.price_quotes
  add constraint price_quotes_item_id_fkey
  foreign key (item_id) references public.items (id) on delete set null;

alter table public.price_quotes
  add column part_number text,
  add column part_number_norm text generated always as
    (nullif(regexp_replace(upper(part_number), '[[:space:]/-]', '', 'g'), '')) stored,
  add column manufacturer_id uuid references public.manufacturers (id) on delete set null,
  add column manufacturer_name text,
  add column model text,
  add column taxonomy_id uuid references public.taxonomies (id) on delete set null,
  add column condition_class text,
  add column condition_note text,
  add column listing_type text,
  add column shipping numeric(12, 2),
  add column listing_date date;

alter table public.price_quotes drop constraint price_quotes_source_known;
alter table public.price_quotes
  add constraint price_quotes_source_known check (
    source in ('ebay_listed','ebay_sold','brokerbin','inbound_quote',
               'reseller_listed','buyback','manual','web_listed')),
  add constraint price_quotes_item_or_part check (
    item_id is not null or char_length(btrim(coalesce(part_number, ''))) > 0),
  add constraint price_quotes_condition_class_known check (
    condition_class is null or condition_class in
      ('New','New Open Box','Refurbished','Used','For Parts')),
  add constraint price_quotes_listing_type_known check (
    listing_type is null or listing_type in ('asking','sold','quote','offer')),
  add constraint price_quotes_shipping_nonnegative check (shipping is null or shipping >= 0),
  add constraint price_quotes_url_http check (
    url is null or url ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$');

-- Backfill part_number from the linked item (part_number, then
-- oem_part_number, then model) when the insert leaves it empty.
create or replace function public.price_quotes_fill_part_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.item_id is not null
     and char_length(btrim(coalesce(new.part_number, ''))) = 0 then
    select coalesce(nullif(btrim(i.part_number), ''),
                    nullif(btrim(i.oem_part_number), ''),
                    nullif(btrim(i.model), ''))
      into new.part_number
      from public.items i
     where i.id = new.item_id;
  end if;
  return new;
end;
$$;

comment on function public.price_quotes_fill_part_number() is
  'Before insert on price_quotes: copies part number from the linked item when none is given, so rows keep an identifier if the item is later deleted.';

create trigger price_quotes_fill_part_number
  before insert on public.price_quotes
  for each row execute function public.price_quotes_fill_part_number();

create index price_quotes_part_number_norm_idx
  on public.price_quotes (part_number_norm, captured_at desc);
create index price_quotes_part_number_norm_trgm_idx
  on public.price_quotes using gin (part_number_norm extensions.gin_trgm_ops);
create index price_quotes_taxonomy_captured_idx
  on public.price_quotes (taxonomy_id, captured_at desc);
create index price_quotes_unlinked_idx
  on public.price_quotes (captured_at desc) where item_id is null;
create index price_quotes_vendor_idx on public.price_quotes (vendor_id);
create index price_quotes_manufacturer_idx on public.price_quotes (manufacturer_id);

comment on column public.price_quotes.item_id is 'ITS item, when matched. Null for research on a part not yet in items; part_number is then required. Link only when exactly one item matches part_number_norm (items.part_number first, then oem_part_number, normalized the same way).';
comment on column public.price_quotes.price is 'Unit price, excluding shipping, in currency.';
comment on column public.price_quotes.qty is 'Units in the listing or lot. Lot total is price * qty.';
comment on column public.price_quotes.shipping is 'Shipping for the whole listing, in currency. Null when unknown; 0 when free.';
comment on column public.price_quotes.part_number is 'MPN or part number as seen at the source; backfilled from the item on insert when empty.';
comment on column public.price_quotes.part_number_norm is 'Generated: part_number uppercased with whitespace, "-" and "/" removed. Use for matching.';
comment on column public.price_quotes.condition is 'Raw condition text as seen at the source (e.g. eBay "Pre-Owned"). Unconstrained.';
comment on column public.price_quotes.condition_class is 'Normalized condition: New, New Open Box, Refurbished, Used, For Parts.';
comment on column public.price_quotes.manufacturer_name is 'Manufacturer as seen at the source. manufacturer_id is the controlled match.';
comment on column public.price_quotes.taxonomy_id is 'Category such as server, memory, HDD, SSD, NIC, HBA, switch, CPU.';
comment on column public.price_quotes.listing_type is 'asking (listed), sold (completed sale), quote (vendor quote), offer.';
comment on column public.price_quotes.listing_date is 'Date the listing sold or ended, when the source shows it. captured_at is when we saw it.';
comment on column public.price_quotes.captured_by is 'Free-text label of who captured it, e.g. Benjamin.';

-- RLS stays enabled with no policies; only service_role has grants. Unchanged.

-- ITS rule: new functions are callable by service_role only.
revoke all on function public.price_quotes_fill_part_number() from public, anon, authenticated;
grant execute on function public.price_quotes_fill_part_number() to service_role;
