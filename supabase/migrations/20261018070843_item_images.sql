-- Item photos in a private Storage bucket.
-- The item_images table has row level security off, matching the other
-- inventory tables. Storage objects keep their own policies, which is how
-- Supabase Storage enforces access. Those policies are limited to the
-- item-images bucket and to read, upload, and delete. Listing the bucket
-- and updating objects are not allowed.
-- Deploying this repository does not run this file; it is applied separately.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-images',
  'item-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "item_images_read" on storage.objects;
drop policy if exists "item_images_insert" on storage.objects;
drop policy if exists "item_images_delete" on storage.objects;

-- Download, signed URLs, and image info. delete/delete_many are included
-- so the Storage API can see an object while removing it. Listing is excluded.
create policy "item_images_read"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'item-images'
  and storage.allow_any_operation(array[
    'storage.object.get_authenticated',
    'storage.object.get_authenticated_info',
    'object.get_authenticated_info',
    'storage.object.sign',
    'storage.object.sign_many',
    'storage.object.info_authenticated',
    'storage.object.delete',
    'storage.object.delete_many'
  ])
);

create policy "item_images_insert"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'item-images');

create policy "item_images_delete"
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'item-images');

create table if not exists public.item_images (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  storage_path text not null,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint item_images_storage_path_not_blank check (length(btrim(storage_path)) > 0),
  constraint item_images_storage_path_unique unique (storage_path)
);

create unique index if not exists item_images_one_primary_uidx
  on public.item_images (item_id)
  where is_primary;

create index if not exists item_images_item_sort_idx
  on public.item_images (item_id, sort_order, created_at);

comment on table public.item_images is
  'Photos for an item. Files live in the item-images storage bucket under <item_id>/<image_id>.';

-- Row level security stays off, matching the other inventory tables.
grant all on table public.item_images to anon, authenticated, service_role;

create or replace function public.item_images_keep_one_primary()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_primary
      or not exists (
        select 1
        from public.item_images
        where item_id = new.item_id
          and is_primary
      )
    then
      update public.item_images
      set is_primary = false
      where item_id = new.item_id
        and is_primary;

      new.is_primary := true;
    end if;

    return new;
  end if;

  if new.is_primary and not old.is_primary then
    update public.item_images
    set is_primary = false
    where item_id = new.item_id
      and id <> new.id
      and is_primary;
  end if;

  return new;
end;
$$;

-- Storage rejects DELETE on storage.objects ("use the Storage API").
-- The app removes the file with storage.remove, then deletes this row.
-- This trigger only keeps a single primary image.
create or replace function public.item_images_after_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.is_primary then
    update public.item_images
    set is_primary = true
    where id = (
      select id
      from public.item_images
      where item_id = old.item_id
      order by sort_order, created_at, id
      limit 1
    );
  end if;

  return old;
end;
$$;

drop trigger if exists item_images_keep_one_primary on public.item_images;
create trigger item_images_keep_one_primary
before insert or update of is_primary on public.item_images
for each row
execute function public.item_images_keep_one_primary();

drop trigger if exists item_images_after_delete on public.item_images;
create trigger item_images_after_delete
after delete on public.item_images
for each row
execute function public.item_images_after_delete();

notify pgrst, 'reload schema';
