-- Temporary compatibility: deployed app (v0.13) still reads item_images.is_primary.
-- Derived from sort_order (first image = primary). Drop once the photo-order PR is merged and deployed.
-- Applied on fxsbpreasbdalwthyzvk as version 20261019073625.
-- TODO(after this photo release is deployed): drop is_primary and item_images_sync_primary.
alter table public.item_images add column if not exists is_primary boolean not null default false;

create or replace function public.item_images_sync_primary()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  update public.item_images i
     set is_primary = (i.id = f.first_id)
    from (
      select distinct on (item_id) item_id, id as first_id
        from public.item_images
       order by item_id, sort_order nulls last, created_at, id
    ) f
   where i.item_id = f.item_id
     and i.is_primary is distinct from (i.id = f.first_id);
  return null;
end;
$$;

drop trigger if exists item_images_sync_primary on public.item_images;
create trigger item_images_sync_primary
after insert or update or delete on public.item_images
for each statement execute function public.item_images_sync_primary();

-- backfill
update public.item_images i
   set is_primary = (i.id = f.first_id)
  from (
    select distinct on (item_id) item_id, id as first_id
      from public.item_images
     order by item_id, sort_order nulls last, created_at, id
  ) f
 where i.item_id = f.item_id;
