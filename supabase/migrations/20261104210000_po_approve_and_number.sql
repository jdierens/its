-- Purchase-order numbers follow the sales-order gate.
-- A draft stores a null number. Approve claims PO plus the integer, for
-- example PO6304, and moves the draft to open.
-- The suggestion is one past the highest PO number already stored. It does
-- not read po_counter.next_number, so a drifted counter cannot change it.
-- Claiming a number still moves the counter the way so_counter moves:
-- never backwards, and a number at or above it moves the counter past that
-- number.
-- Not applied here. Review and apply by hand on fxsbpreasbdalwthyzvk.

alter table public.purchase_orders alter column number drop not null;

comment on column public.purchase_orders.number is
  'PO plus the integer, for example PO6304. Null on a draft until approve claims it. Unique when set.';

create or replace function public.suggest_purchase_order_number()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  issued bigint;
begin
  perform 1
  from public.po_counter
  where id = 1
  for update;

  if not found then
    raise exception 'Purchase-order counter is missing.'
      using errcode = '55000';
  end if;

  select coalesce(max((substring(number from '^PO([0-9]+)$'))::bigint), 0) + 1
    into issued
  from public.purchase_orders
  where number ~ '^PO[0-9]+$';

  if issued is null or issued < 1 then
    issued := 1;
  end if;

  loop
    exit when not exists (
      select 1
      from public.purchase_orders
      where number = 'PO' || issued::text
    );
    issued := issued + 1;
  end loop;

  return issued;
end;
$$;

comment on function public.suggest_purchase_order_number() is
  'Locks po_counter and returns one past the highest purchase-order number already stored, as an integer. Does not read or move po_counter.next_number. A drifted counter does not change the suggestion.';

create or replace function public.reserve_purchase_order_number()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  issued bigint;
begin
  issued := public.suggest_purchase_order_number();

  update public.po_counter
  set next_number = greatest(next_number, issued + 1)
  where id = 1;

  return 'PO' || issued::text;
end;
$$;

comment on function public.reserve_purchase_order_number() is
  'Claims the suggested purchase-order number and moves po_counter to at least one past it. The counter never moves backwards. The app assigns numbers from approve_purchase_order instead.';

create or replace function public.approve_purchase_order(
  p_order uuid,
  p_operator_id uuid,
  p_number bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_number bigint;
begin
  select * into v_order
  from public.purchase_orders
  where id = p_order
  for update;

  if v_order.id is null then
    raise exception 'Purchase order not found.'
      using errcode = 'P0002';
  end if;
  if v_order.status <> 'draft' then
    raise exception 'Only a draft can be approved.'
      using errcode = '22023';
  end if;
  if v_order.vendor_id is null then
    raise exception 'Choose a vendor.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.po_lines where purchase_order_id = p_order
  ) then
    raise exception 'Add a line before approving.'
      using errcode = '22023';
  end if;

  perform 1
  from public.po_counter
  where id = 1
  for update;

  if not found then
    raise exception 'Purchase-order counter is missing.'
      using errcode = '55000';
  end if;

  if p_number is null then
    v_number := public.suggest_purchase_order_number();
  else
    if p_number < 1 then
      raise exception 'Enter a purchase order number.'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from public.purchase_orders
      where number = 'PO' || p_number::text
        and id is distinct from p_order
    ) then
      raise exception 'Purchase order number PO% is already used.', p_number
        using errcode = '23505';
    end if;
    v_number := p_number;
  end if;

  update public.po_counter
  set next_number = greatest(next_number, v_number + 1)
  where id = 1;

  update public.purchase_orders set
    number = 'PO' || v_number::text,
    status = 'open',
    sent_at = coalesce(sent_at, now()),
    operator_id = coalesce(p_operator_id, operator_id)
  where id = p_order;

  return jsonb_build_object(
    'id', p_order,
    'status', 'open',
    'number', 'PO' || v_number::text
  );
end;
$$;

comment on function public.approve_purchase_order(uuid, uuid, bigint) is
  'Approves a draft that has a vendor and at least one line. Sets status to open and assigns the purchase-order number under a lock on po_counter. Null uses one past the highest number already stored. A typed number must be unused on a different purchase order, so a draft that already holds a number can be approved as that number. The counter never moves backwards, and a number above it moves the counter past that number.';

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
  line jsonb;
  n integer := 0;
begin
  if p_fulfillment not in ('warehouse', 'drop_ship') then
    raise exception 'Choose warehouse or drop ship.';
  end if;

  if p_id is null then
    insert into public.purchase_orders (
      number, vendor_id, purpose, status, fulfillment, currency,
      terms, ordered_on, expected_on, internal_notes, vendor_notes, operator_id, occurred_at
    ) values (
      null, p_vendor_id, 'purchase', 'draft', p_fulfillment, 'USD',
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
  'Creates or replaces a draft known-line purchase order in one transaction. A new draft has no number. Approve assigns it. The server checks who may call it.';

revoke all on function public.suggest_purchase_order_number() from public, anon, authenticated;
revoke all on function public.approve_purchase_order(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.suggest_purchase_order_number() to service_role;
grant execute on function public.approve_purchase_order(uuid, uuid, bigint) to service_role;

notify pgrst, 'reload schema';
