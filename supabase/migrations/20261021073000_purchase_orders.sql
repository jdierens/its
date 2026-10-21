-- Known-line purchase orders and the inventory movement ledger.
-- Receiving, putaway, and status changes are later. This migration only
-- creates the tables those steps will write.
-- Row level security on, service_role only. No anon or authenticated grant.

create table public.po_counter (
  id smallint primary key,
  next_number bigint not null,
  constraint po_counter_singleton check (id = 1),
  constraint po_counter_next_positive check (next_number >= 1)
);

insert into public.po_counter (id, next_number) values (1, 1);

comment on table public.po_counter is
  'Next purchase-order number. Locked with SELECT FOR UPDATE when a number is reserved.';

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  vendor_id uuid not null references public.vendors (id),
  project_id uuid,
  purpose text not null default 'purchase',
  status text not null default 'draft',
  fulfillment text not null default 'warehouse',
  currency text not null default 'USD',
  terms text,
  ordered_on date,
  expected_on date,
  sent_at timestamptz,
  closed_at timestamptz,
  ship_to jsonb,
  notes text,
  qbo_po_id text,
  qbo_doc_number text,
  operator_id uuid references public.app_users (id),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint purchase_orders_number_unique unique (number),
  constraint purchase_orders_purpose_check check (purpose in ('purchase', 'settlement', 'buyout')),
  constraint purchase_orders_status_check check (
    status in ('draft', 'open', 'partially_received', 'received', 'closed', 'cancelled')
  ),
  constraint purchase_orders_fulfillment_check check (fulfillment in ('warehouse', 'drop_ship')),
  constraint purchase_orders_currency_check check (char_length(btrim(currency)) > 0)
);

comment on table public.purchase_orders is
  'Purchase orders. Phase 1 creates and sends known-line drafts. operator_id is the session user, set by the server.';

create index purchase_orders_vendor_idx on public.purchase_orders (vendor_id);
create index purchase_orders_status_idx on public.purchase_orders (status, created_at desc);

create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  line_no integer not null,
  line_kind text not null default 'known',
  item_id uuid references public.items (id),
  description text,
  qty_ordered numeric(12, 2),
  unit_cost numeric(12, 2),
  total_cost numeric(12, 2),
  condition text,
  condition_note text,
  grade text,
  unit text,
  constraint po_lines_order_line_unique unique (purchase_order_id, line_no),
  constraint po_lines_line_no_positive check (line_no > 0),
  constraint po_lines_kind_check check (line_kind in ('known', 'lot')),
  constraint po_lines_condition_check check (condition is null or condition in ('New', 'Used')),
  constraint po_lines_unit_cost_nonnegative check (unit_cost is null or unit_cost >= 0),
  constraint po_lines_total_cost_nonnegative check (total_cost is null or total_cost >= 0),
  constraint po_lines_known_check check (
    line_kind <> 'known'
    or (
      qty_ordered > 0
      and total_cost is null
      and (item_id is not null or nullif(btrim(description), '') is not null)
    )
  ),
  constraint po_lines_lot_check check (
    line_kind <> 'lot'
    or (
      item_id is null
      and qty_ordered is null
      and unit_cost is null
      and total_cost is not null
      and nullif(btrim(description), '') is not null
    )
  )
);

comment on table public.po_lines is
  'Purchase-order lines. Known lines have a quantity and a unit cost. Lot lines are stored for a later phase.';

create index po_lines_order_idx on public.po_lines (purchase_order_id, line_no);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.items (id),
  project_id uuid,
  intake_line_id uuid,
  unit_id uuid,
  bin_id uuid references public.bins (id),
  direction text not null,
  qty numeric(12, 2) not null,
  ownership text not null default 'owned',
  stock_status text not null default 'available',
  transfer_id uuid,
  ref_type text not null,
  ref_id uuid,
  ref_label text,
  source_movement_id uuid references public.inventory_movements (id),
  operator_id uuid references public.app_users (id),
  operator_label text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  notes text,
  reason text,
  constraint inventory_movements_direction_check check (direction in ('in', 'out')),
  constraint inventory_movements_qty_positive check (qty > 0),
  constraint inventory_movements_ownership_check check (ownership in ('owned', 'consigned')),
  constraint inventory_movements_status_check check (
    stock_status in ('available', 'damaged', 'quarantine', 'hold')
  ),
  constraint inventory_movements_ref_type_check check (
    ref_type in (
      'project', 'purchase_receipt', 'putaway', 'status_change', 'sales_order', 'rma',
      'vendor_return', 'adjustment', 'cycle_count', 'opening_balance', 'scrap', 'internal_use'
    )
  ),
  constraint inventory_movements_reason_check check (
    ref_type <> 'status_change' or nullif(btrim(reason), '') is not null
  )
);

comment on table public.inventory_movements is
  'IN/OUT ledger. items.quantity will cache the identified sum. stock_status splits a bin balance. Phase 1 creates the table and does not post rows.';

create index inventory_movements_item_idx on public.inventory_movements (item_id);
create index inventory_movements_bin_idx on public.inventory_movements (bin_id);

create or replace function public.reserve_purchase_order_number()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  issued bigint;
begin
  select next_number
    into issued
  from public.po_counter
  where id = 1
  for update;

  update public.po_counter
  set next_number = issued + 1
  where id = 1;

  return 'PO-' || issued::text;
end;
$$;

comment on function public.reserve_purchase_order_number() is
  'Locks the purchase-order counter and returns the next PO- number.';

create or replace function public.write_known_purchase_order(
  p_id uuid,
  p_vendor_id uuid,
  p_fulfillment text,
  p_terms text,
  p_ordered_on date,
  p_expected_on date,
  p_notes text,
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
      terms, ordered_on, expected_on, notes, operator_id, occurred_at
    ) values (
      v_number, p_vendor_id, 'purchase', 'draft', p_fulfillment, 'USD',
      nullif(btrim(p_terms), ''), p_ordered_on, p_expected_on, nullif(btrim(p_notes), ''),
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
      notes = nullif(btrim(p_notes), '')
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
      qty_ordered, unit_cost, condition, unit
    ) values (
      v_id,
      n,
      'known',
      nullif(line->>'itemId', '')::uuid,
      nullif(btrim(line->>'description'), ''),
      (line->>'qty')::numeric,
      (line->>'unitCost')::numeric,
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

comment on function public.write_known_purchase_order(uuid, uuid, text, text, date, date, text, uuid, jsonb) is
  'Creates or replaces a draft known-line purchase order in one transaction. The server checks who may call it.';

alter table public.po_counter enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.po_lines enable row level security;
alter table public.inventory_movements enable row level security;

revoke all on table public.po_counter from public, anon, authenticated;
revoke all on table public.purchase_orders from public, anon, authenticated;
revoke all on table public.po_lines from public, anon, authenticated;
revoke all on table public.inventory_movements from public, anon, authenticated;

grant all on table public.po_counter to service_role;
grant all on table public.purchase_orders to service_role;
grant all on table public.po_lines to service_role;
grant all on table public.inventory_movements to service_role;

revoke all on function public.reserve_purchase_order_number() from public, anon, authenticated;
revoke all on function public.write_known_purchase_order(uuid, uuid, text, text, date, date, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_purchase_order_number() to service_role;
grant execute on function public.write_known_purchase_order(uuid, uuid, text, text, date, date, text, uuid, jsonb) to service_role;
