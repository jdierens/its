-- Picture and hand match for the listings browser.
-- 20261024180000_ebay_listings.sql is already applied.
-- 20261024190000_ebay_listing_packs.sql may or may not be applied. This file
-- does not depend on it.
-- Deploying this repository does not run this file. Apply it separately.

alter table public.ebay_listings
  add column picture_url text,
  add column matched_manually boolean not null default false;

comment on column public.ebay_listings.picture_url is
  'https picture from the eBay listing when the pull included one. Null when eBay sent no picture.';

comment on column public.ebay_listings.matched_manually is
  'True when an admin set item_id from the listings browser. A later pull keeps that item when the custom label still matches no SKU.';

notify pgrst, 'reload schema';
