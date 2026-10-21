-- Purchase-order form: vendor notes, four-decimal unit price, line extension,
-- and private PDF attachments. Existing notes move to internal_notes.
-- Row level security on, service_role only. No anon or authenticated grant.
-- The po-documents bucket is private. No storage policy is added for anon
-- or authenticated. The service role already bypasses storage policies.

alter table public.purchase_orders rename column notes to internal_notes;

alter table public.purchase_orders add column vendor_notes text;

comment on column public.purchase_orders.internal_notes is
  'Never printed or sent to the vendor. The old notes column was renamed here, so existing text stays internal.';

comment on column public.purchase_orders.vendor_notes is
  'Printed or sent to the vendor. Not a price field.';

alter table public.po_lines
  alter column unit_cost type numeric(12, 4);

alter table public.po_lines
  add column ext_price numeric(12, 2);

update public.po_lines
set ext_price = round(qty_ordered * unit_cost, 2)
where line_kind = 'known'
  and qty_ordered is not null
  and unit_cost is not null
  and ext_price is null;

alter table public.po_lines
  add constraint po_lines_ext_price_nonnegative check (ext_price is null or ext_price >= 0);

alter table public.po_lines drop constraint po_lines_known_check;

alter table public.po_lines
  add constraint po_lines_known_check check (
    line_kind <> 'known'
    or (
      qty_ordered > 0
      and total_cost is null
      and unit_cost is not null
      and ext_price is not null
      and (item_id is not null or nullif(btrim(description), '') is not null)
      and abs(qty_ordered * unit_cost - ext_price) <= greatest(0.005, qty_ordered * 0.00005)
    )
  );

alter table public.po_lines drop constraint po_lines_lot_check;

alter table public.po_lines
  add constraint po_lines_lot_check check (
    line_kind <> 'lot'
    or (
      item_id is null
      and qty_ordered is null
      and unit_cost is null
      and ext_price is null
      and total_cost is not null
      and nullif(btrim(description), '') is not null
    )
  );

comment on column public.po_lines.unit_cost is
  'USD unit price, numeric(12,4). Four decimals keep a price back-calculated from the extension.';

comment on column public.po_lines.ext_price is
  'USD line extension, numeric(12,2). Must match quantity times unit cost within rounding.';

drop function public.write_known_purchase_order(uuid, uuid, text, text, date, date, text, uuid, jsonb);

create or replace function public.write_known_purchase_order(
  p_id uuid,
  p_vendor_id uuid,
  p_fulfillment text,
  p_terms text,
  p_ordered_on date,
  p_expected_on date,
  p_internal_notes text,
  p_vendor_notes text,
  p_operator_id uuid,
  p_lines jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_number text;
  line jsonb;
  n integer := 0;
begin
  if p_fulfillment not in ('warehouse', 'drop_ship') then
    raise exception 'Choose warehouse or drop ship.';
  end if;

  if p_id is null then
    v_number := public.reserve_purchase_order_number();
    insert into public.purchase_orders (
      number, vendor_id, purpose, status, fulfillment, currency,
      terms, ordered_on, expected_on, internal_notes, vendor_notes, operator_id, occurred_at
    ) values (
      v_number, p_vendor_id, 'purchase', 'draft', p_fulfillment, 'USD',
      nullif(btrim(p_terms), ''), p_ordered_on, p_expected_on,
      nullif(btrim(p_internal_notes), ''), nullif(btrim(p_vendor_notes), ''),
      p_operator_id, now()
    )
    returning id into v_id;
  else
    update public.purchase_orders
    set
      vendor_id = p_vendor_id,
      fulfillment = p_fulfillment,
      terms = nullif(btrim(p_terms), ''),
      ordered_on = p_ordered_on,
      expected_on = p_expected_on,
      internal_notes = nullif(btrim(p_internal_notes), ''),
      vendor_notes = nullif(btrim(p_vendor_notes), '')
    where id = p_id
      and status = 'draft'
      and purpose = 'purchase'
    returning id into v_id;

    if v_id is null then
      raise exception 'Only a draft purchase order can be edited.';
    end if;

    delete from public.po_lines where purchase_order_id = v_id;
  end if;

  for line in
    select value from pg_catalog.jsonb_array_elements(p_lines)
  loop
    n := n + 1;
    insert into public.po_lines (
      purchase_order_id, line_no, line_kind, item_id, description,
      qty_ordered, unit_cost, ext_price, condition, unit
    ) values (
      v_id,
      n,
      'known',
      nullif(line->>'itemId', '')::uuid,
      nullif(btrim(line->>'description'), ''),
      (line->>'qty')::numeric,
      (line->>'unitCost')::numeric,
      (line->>'extPrice')::numeric,
      nullif(line->>'condition', ''),
      coalesce(nullif(btrim(line->>'unit'), ''), 'Piece')
    );
  end loop;

  if n < 1 then
    raise exception 'Add a line.';
  end if;

  return v_id;
end;
$$;

comment on function public.write_known_purchase_order(uuid, uuid, text, text, date, date, text, text, uuid, jsonb) is
  'Creates or replaces a draft known-line purchase order in one transaction. The server checks who may call it.';

revoke all on function public.write_known_purchase_order(uuid, uuid, text, text, date, date, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.write_known_purchase_order(uuid, uuid, text, text, date, date, text, text, uuid, jsonb) to service_role;

create table public.po_attachments (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  kind text not null,
  file_name text not null,
  storage_path text not null,
  byte_size integer not null,
  operator_id uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  constraint po_attachments_kind_check check (
    kind in ('vendor_invoice', 'quote', 'order_confirmation', 'other')
  ),
  constraint po_attachments_name_check check (
    char_length(btrim(file_name)) > 0 and char_length(file_name) <= 180
  ),
  constraint po_attachments_size_check check (byte_size > 0 and byte_size <= 10485760),
  constraint po_attachments_path_unique unique (storage_path),
  constraint po_attachments_path_check check (
    storage_path = purchase_order_id::text || '/' || id::text || '.pdf'
  )
);

comment on table public.po_attachments is
  'PDF files on a purchase order: vendor invoice, quote, order confirmation, or other. Not customer documents. Bytes live in the private po-documents bucket.';

create index po_attachments_order_idx on public.po_attachments (purchase_order_id, created_at);

alter table public.po_attachments enable row level security;
revoke all on table public.po_attachments from public, anon, authenticated;
grant all on table public.po_attachments to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'po-documents',
  'po-documents',
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
