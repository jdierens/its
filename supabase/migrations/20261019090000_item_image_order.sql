-- Gallery order is the only primary-photo rule.
-- sort_order already exists. This backfills it from created_at and drops is_primary.
-- The lowest sort_order is the primary photo. Row level security stays off.
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

drop trigger if exists item_images_keep_one_primary on public.item_images;
drop trigger if exists item_images_after_delete on public.item_images;
drop function if exists public.item_images_keep_one_primary();
drop function if exists public.item_images_after_delete();
drop index if exists public.item_images_one_primary_uidx;

alter table public.item_images
  drop column if exists is_primary;

comment on column public.item_images.sort_order is
  'Gallery order, starting at 0. The lowest sort_order is the primary photo.';

notify pgrst, 'reload schema';
