-- Item PDFs may be 25 MB (26214400 bytes). The attachments migration capped
-- the row and the item-documents bucket at 10 MB. Apply this by hand after
-- 20261028210000_item_attachments.sql. Deploying does not run this file.

alter table public.item_attachments
  drop constraint if exists item_attachments_size_check,
  add constraint item_attachments_size_check
    check (byte_size > 0 and byte_size <= 26214400);

update storage.buckets
set file_size_limit = 26214400
where id = 'item-documents';

notify pgrst, 'reload schema';
