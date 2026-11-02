-- Automatic post-upload processing for one gallery row.
-- storage_path is what search and listings read. It stays the upload until the
-- pipeline finishes, then points at the processed JPEG.
-- original_storage_path keeps the upload.
-- Existing photos are ready so this file does not reprocess them.
-- Apply by hand on project fxsbpreasbdalwthyzvk before the photo-processing release.
-- Deploying does not run this file. Applying it first is safe: the deployed app
-- does not read these columns.

alter table public.item_images
  add column processing_status text not null default 'ready',
  add column original_storage_path text,
  add column processing_error text,
  add column processing_started_at timestamptz,
  add column processed_at timestamptz;

alter table public.item_images
  add constraint item_images_processing_status_check
  check (processing_status in ('pending', 'processing', 'ready', 'failed'));

alter table public.item_images
  add constraint item_images_original_storage_path_not_blank
  check (original_storage_path is null or length(btrim(original_storage_path)) > 0);

alter table public.item_images
  add constraint item_images_processing_error_length
  check (processing_error is null or char_length(processing_error) <= 300);

create unique index item_images_original_storage_path_uidx
  on public.item_images (original_storage_path)
  where original_storage_path is not null;

create index item_images_processing_open_idx
  on public.item_images (processing_started_at)
  where processing_status in ('pending', 'processing', 'failed');

comment on column public.item_images.processing_status is
  'pending: uploaded, pipeline not finished. processing: a browser claimed it. ready: storage_path is the photo search and listings use. failed: the original stays visible.';

comment on column public.item_images.original_storage_path is
  'The uploaded file. Null on photos saved before automatic processing. storage_path matches it until the processed JPEG is saved.';

comment on column public.item_images.processed_at is
  'When automatic processing last saved the JPEG in storage_path. Null if this row was not produced by that pipeline.';

notify pgrst, 'reload schema';
