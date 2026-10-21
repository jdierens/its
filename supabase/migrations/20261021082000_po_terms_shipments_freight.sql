-- Terms list, freight-in, and shipment tracking on purchase orders that
-- already exist. Clears terms that are not in the list. Freight-in stays
-- null until someone enters it. Row level security on, service_role only.

update public.purchase_orders
set terms = null
where terms is not null
  and terms not in ('Net0', 'Net1', 'Net7', 'Net10', 'Net14', 'Net15', 'Net30');

alter table public.purchase_orders
  add column freight_in numeric(12, 2),
  add constraint purchase_orders_terms_check check (
    terms is null or terms in ('Net0', 'Net1', 'Net7', 'Net10', 'Net14', 'Net15', 'Net30')
  ),
  add constraint purchase_orders_freight_in_check check (freight_in is null or freight_in >= 0);

comment on column public.purchase_orders.terms is
  'One of Net0, Net1, Net7, Net10, Net14, Net15, Net30. Null on rows saved before the list existed.';

comment on column public.purchase_orders.freight_in is
  'USD freight-in, not yet allocated. Later split onto received units by line value (quantity times unit cost).';

create table public.po_shipments (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  carrier text not null,
  tracking_number text not null,
  operator_id uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  constraint po_shipments_carrier_check check (
    carrier in ('UPS', 'FedEx', 'USPS', 'DHL', 'Freight', 'Other')
  ),
  constraint po_shipments_tracking_check check (
    char_length(btrim(tracking_number)) > 0 and char_length(tracking_number) <= 40
  ),
  constraint po_shipments_order_tracking_unique unique (purchase_order_id, carrier, tracking_number)
);

comment on table public.po_shipments is
  'One tracking number on a purchase order. A later receipt references this row. Not money.';

create index po_shipments_order_idx on public.po_shipments (purchase_order_id, created_at);

create or replace function public.replace_po_shipments(
  p_order_id uuid,
  p_operator_id uuid,
  p_rows jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.purchase_orders where id = p_order_id) then
    raise exception 'Purchase order not found.';
  end if;

  -- Keep the id of a tracking number that stays, so a later receipt can keep pointing at it.
  delete from public.po_shipments as shipment
  where shipment.purchase_order_id = p_order_id
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as incoming
      where incoming->>'carrier' = shipment.carrier
        and incoming->>'trackingNumber' = shipment.tracking_number
    );

  insert into public.po_shipments (purchase_order_id, carrier, tracking_number, operator_id)
  select p_order_id, incoming->>'carrier', incoming->>'trackingNumber', p_operator_id
  from pg_catalog.jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as incoming
  where not exists (
    select 1
    from public.po_shipments as shipment
    where shipment.purchase_order_id = p_order_id
      and shipment.carrier = incoming->>'carrier'
      and shipment.tracking_number = incoming->>'trackingNumber'
  );
end;
$$;

comment on function public.replace_po_shipments(uuid, uuid, jsonb) is
  'Replaces tracking numbers on a purchase order and keeps the id of a number that stays. Allowed after the order is sent. The server checks who may call it.';

alter table public.po_shipments enable row level security;
revoke all on table public.po_shipments from public, anon, authenticated;
grant all on table public.po_shipments to service_role;

revoke all on function public.replace_po_shipments(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_po_shipments(uuid, uuid, jsonb) to service_role;
