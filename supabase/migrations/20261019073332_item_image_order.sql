-- Gallery order. sort_order already exists; backfill it from created_at.
-- The lowest sort_order is the primary photo.
--
-- Do not drop item_images.is_primary here. The deployed app still selects it.
-- The live apply of this migration (version 20261019073332) did drop the column.
-- The next migration, item_images_is_primary_compat, puts it back and keeps it
-- in sync. Leave that column in place.
--
-- TODO(after this photo release is deployed and the old app is gone): drop
-- is_primary, the item_images_sync_primary trigger, and its function.
-- Deploying this repository does not run this file. It is applied separately.

alter table public.item_images
  add column if not exists sort_order integer not null default 0;

with ranked as (
  select
    id,
    (row_number() over (partition by item_id order by created_at, id) - 1) as next_order
  from public.item_images
)
update public.item_images as images
set sort_order = ranked.next_order
from ranked
where images.id = ranked.id
  and images.sort_order is distinct from ranked.next_order;

-- The old row triggers wrote is_primary directly. The compatibility trigger
-- replaces them. These drops already ran on the live database.
drop trigger if exists item_images_keep_one_primary on public.item_images;
drop trigger if exists item_images_after_delete on public.item_images;
drop function if exists public.item_images_keep_one_primary();
drop function if exists public.item_images_after_delete();
drop index if exists public.item_images_one_primary_uidx;

comment on column public.item_images.sort_order is
  'Gallery order, starting at 0. The lowest sort_order is the primary photo.';

notify pgrst, 'reload schema';
