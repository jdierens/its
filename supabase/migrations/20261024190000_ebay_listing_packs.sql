-- Pack size on an eBay listing. 20261024180000_ebay_listings.sql is already
-- applied. This file only adds columns.
-- base_sku is set when the custom label is <SKU>-<n>PK and that full label is
-- not itself an item. pack_qty is 1 for a normal listing.
-- Deploying this repository does not run this file. Apply it separately.

alter table public.ebay_listings
  add column base_sku text,
  add column pack_qty integer not null default 1;

alter table public.ebay_listings
  add constraint ebay_listings_pack_qty_at_least_one check (pack_qty >= 1);

comment on column public.ebay_listings.base_sku is
  'Item SKU inside a pack label such as 12345-4PK. Null when the full custom label matched an item.';

comment on column public.ebay_listings.pack_qty is
  'Units of the matched item in this listing. 1 unless the label matched <SKU>-<n>PK.';

notify pgrst, 'reload schema';
