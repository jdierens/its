-- PDF documents on an inventory item: product brief, data sheet, manual, or other.
-- Bytes live in the private item-documents bucket at {item id}/{file id}.pdf.
-- Row level security is on. There are no policies. anon and authenticated
-- cannot read or write the table. The service role, used by server actions
-- after the app checks the signed-in user, bypasses that and storage policies.
-- No public URL is issued. Deploying this repository does not run this file.
-- Apply it by hand on project fxsbpreasbdalwthyzvk.

create table public.item_attachments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  kind text not null,
  file_name text not null,
  storage_path text not null,
  byte_size integer not null,
  operator_id uuid references public.app_users (id),
  operator_label text,
  created_at timestamptz not null default now(),
  constraint item_attachments_kind_check check (
    kind in ('product_brief', 'data_sheet', 'manual', 'other')
  ),
  constraint item_attachments_name_check check (
    char_length(btrim(file_name)) > 0 and char_length(file_name) <= 180
  ),
  constraint item_attachments_size_check check (byte_size > 0 and byte_size <= 10485760),
  constraint item_attachments_path_unique unique (storage_path),
  constraint item_attachments_path_check check (
    storage_path = item_id::text || '/' || id::text || '.pdf'
  )
);

comment on table public.item_attachments is
  'PDF files on an item: product brief, data sheet, manual, or other. Bytes live in the private item-documents bucket at {item}/{id}.pdf.';

create index item_attachments_item_idx on public.item_attachments (item_id, created_at);

alter table public.item_attachments enable row level security;
revoke all on table public.item_attachments from public, anon, authenticated;
grant all on table public.item_attachments to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-documents',
  'item-documents',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
