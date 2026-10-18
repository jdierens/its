-- Edited photos are new gallery rows. They point at the original and never replace it.
-- The bucket limit is 10 MB so a high-quality JPEG of at least 1600 px can upload.

alter table public.item_images
  add column source_image_id uuid references public.item_images (id) on delete set null;

create index item_images_source_image_id_idx
  on public.item_images (source_image_id);

comment on column public.item_images.source_image_id is
  'The gallery photo this image was edited from. Null for a direct upload.';

update storage.buckets
set file_size_limit = 10485760
where id = 'item-images';

notify pgrst, 'reload schema';
