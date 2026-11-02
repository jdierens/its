-- Pack a sales order that already shipped without a warehouse pack.
-- Historic and drop-ship orders are status shipped (or partially_shipped),
-- ship_date is set, so_shipments already exist, packed_at is null, and the
-- pick is finished. Packing those orders must not move status back to packing
-- or forward to packed: ship queues and the stage icons key off shipped.
-- Bins, weights, and assignments work while that status stays put.
-- Finish stores packed_at and leaves status, ship_date, and so_shipments alone.
-- Cancelled, invoiced, closed, and an order that is already packed stay closed.
-- Apply by hand on project fxsbpreasbdalwthyzvk after
-- supabase/migrations/20261028233000_sales_order_packing.sql.
-- Deploying does not run this file.

create or replace function public.so_packing_writable(p_status text, p_packed_at timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status = 'packing'
    or (
      p_status in ('shipped', 'partially_shipped')
      and p_packed_at is null
    );
$$;

comment on function public.so_packing_writable(text, timestamptz) is
  'True while packing is the open step, or the order already shipped and packed_at is still empty. Cancelled, invoiced, closed, and packed stay false. Shipped status itself is not a pack.';

revoke all on function public.so_packing_writable(text, timestamptz) from public, anon, authenticated;

create or replace function public.so_require_packing(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_packed timestamptz;
  v_block text;
begin
  select status, packed_at into v_status, v_packed
  from public.sales_orders
  where id = p_order
  for update;

  if not found then
    raise exception 'Sales order not found.'
      using errcode = 'P0002';
  end if;

  if not public.so_packing_writable(v_status, v_packed) then
    raise exception 'Packing is closed on this sales order.'
      using errcode = '22023';
  end if;

  -- A normal packing order was checked when it opened. A shipped order was
  -- not, so the pick still has to be finished before a bin can change.
  if v_status is distinct from 'packing' then
    v_block := public.so_pack_open_block(p_order);
    if v_block is not null then
      raise exception '%', v_block
        using errcode = '22023';
    end if;
  end if;
end;
$$;

comment on function public.so_require_packing(uuid) is
  'Locks the order and allows packing edits while status is packing, or while status is shipped or partially_shipped and packed_at is null. A shipped order also needs a finished pick. Does not change status, ship_date, or so_shipments.';

create or replace function public.so_package_contents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_kind text;
  v_type text;
  v_sku text;
  v_list uuid;
  v_picked numeric;
  v_packed numeric;
  v_room numeric;
begin
  select pkg.sales_order_id into v_order
  from public.so_packages pkg
  where pkg.id = new.package_id;

  if v_order is null then
    raise exception 'That shipping bin was not found.'
      using errcode = 'P0002';
  end if;

  perform public.so_require_packing(v_order);

  select l.line_kind, i.item_type, i.sku
  into v_kind, v_type, v_sku
  from public.so_line_allocations a
  join public.so_lines l on l.id = a.so_line_id
  join public.items i on i.id = a.item_id
  where a.id = new.allocation_id
    and l.sales_order_id = v_order;

  if not found or public.so_pick_sheet_place(v_kind, v_type) is distinct from 'pick' or v_sku = '4343' then
    raise exception 'Freight and service lines are not packed.'
      using errcode = '22023';
  end if;

  v_list := public.so_pack_pick_list(v_order);
  select coalesce(sum(qty_picked), 0) into v_picked
  from public.so_picks
  where pick_list_id = v_list
    and allocation_id = new.allocation_id;

  if v_picked <= 0 then
    raise exception 'That line was not picked.'
      using errcode = '22023';
  end if;

  select coalesce(sum(c.qty), 0) into v_packed
  from public.so_package_contents c
  join public.so_packages pkg on pkg.id = c.package_id
  where pkg.sales_order_id = v_order
    and c.allocation_id = new.allocation_id
    and c.id is distinct from new.id;

  v_room := v_picked - v_packed;
  if v_room < 1 or new.qty > v_room then
    if v_room < 1 then
      raise exception 'That line is already packed.'
        using errcode = '22023';
    end if;
    raise exception 'Only %s can go in that bin.', public.so_format_pack_qty(v_room)
      using errcode = '22023';
  end if;

  return new;
end;
$$;

comment on function public.so_package_contents_guard() is
  'A shipping bin can hold only a picked stock line, and not more than was picked. The order has to be open for packing.';

create or replace function public.sales_order_pack_sheet(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.sales_orders;
  v_customer text;
  v_list uuid;
  v_pick_status text;
  v_lines jsonb := '[]'::jsonb;
  v_bins jsonb := '[]'::jsonb;
  v_types jsonb;
  v_finish text;
  v_handoff text;
  v_editable boolean := false;
  r record;
begin
  select * into v_order from public.sales_orders where id = p_order;
  if not found then
    raise exception 'Sales order not found.'
      using errcode = 'P0002';
  end if;

  select display_name into v_customer
  from public.customers
  where id = v_order.customer_id;

  select id, status into v_list, v_pick_status
  from public.so_pick_lists
  where sales_order_id = p_order
    and status <> 'cancelled'
  order by created_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pkg.id,
    'number', pkg.box_number,
    'kind', coalesce(pkg.kind, 'box'),
    'type_id', pkg.packaging_type_id,
    'type_name', coalesce(t.name, 'Package'),
    'length_in', coalesce(pkg.length_in, 0),
    'width_in', coalesce(pkg.width_in, 0),
    'height_in', pkg.height_in,
    'weight_lb', pkg.weight_lb
  ) order by pkg.box_number), '[]'::jsonb)
  into v_bins
  from public.so_packages pkg
  left join public.packaging_types t on t.id = pkg.packaging_type_id
  where pkg.sales_order_id = p_order;

  for r in
    select
      a.id as allocation_id,
      l.line_no,
      coalesce(actual.sku, i.sku) as sku,
      coalesce(actual.name, i.name) as name,
      i.sku as planned_sku,
      (a.actual_item_id is not null and a.actual_item_id is distinct from a.item_id) as replaced,
      coalesce((
        select sum(p.qty_picked)
        from public.so_picks p
        where p.pick_list_id = v_list
          and p.allocation_id = a.id
      ), 0) as picked,
      coalesce((
        select sum(c.qty)
        from public.so_package_contents c
        join public.so_packages pkg on pkg.id = c.package_id
        where pkg.sales_order_id = p_order
          and c.allocation_id = a.id
      ), 0) as packed
    from public.so_lines l
    join public.so_line_allocations a on a.so_line_id = l.id
    join public.items i on i.id = a.item_id
    left join public.items actual on actual.id = a.actual_item_id
    where l.sales_order_id = p_order
      and public.so_pick_sheet_place(l.line_kind, i.item_type) = 'pick'
      and i.sku is distinct from '4343'
    order by l.line_no, a.alloc_no
  loop
    if r.picked <= 0 and r.packed <= 0 then
      continue;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'allocation_id', r.allocation_id,
      'line_no', r.line_no,
      'sku', r.sku,
      'name', r.name,
      'planned_sku', r.planned_sku,
      'replaced', r.replaced,
      'picked', r.picked,
      'packed', r.packed,
      'assignments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id,
          'bin_id', pkg.id,
          'bin_number', pkg.box_number,
          'kind', coalesce(pkg.kind, 'box'),
          'qty', c.qty
        ) order by pkg.box_number, c.id)
        from public.so_package_contents c
        join public.so_packages pkg on pkg.id = c.package_id
        where pkg.sales_order_id = p_order
          and c.allocation_id = r.allocation_id
          and c.qty > 0
      ), '[]'::jsonb)
    ));
  end loop;

  v_types := public.list_packaging_types();

  v_editable := public.so_packing_writable(v_order.status, v_order.packed_at);
  if v_editable and v_order.status is distinct from 'packing' then
    if public.so_pack_open_block(p_order) is not null then
      v_editable := false;
    end if;
  end if;

  v_finish := case
    when v_order.status = 'packed' or v_order.packed_at is not null then null
    when v_order.status in ('cancelled', 'closed', 'invoiced') then null
    else public.so_pack_finish_block(p_order)
  end;

  v_handoff := case
    when v_order.status = 'packed'
      then 'Packed. Shipping is next. Carrier labels and rate shopping are not on this screen.'
    else null
  end;

  return jsonb_build_object(
    'order_id', v_order.id,
    'so_number', v_order.so_number,
    'status', v_order.status,
    'packed_at', v_order.packed_at,
    'editable', v_editable,
    'customer', coalesce(v_customer, ''),
    'customer_po', v_order.customer_po,
    'pick_status', v_pick_status,
    'finish_block', v_finish,
    'handoff', v_handoff,
    'types', v_types,
    'bins', v_bins,
    'lines', v_lines
  );
end;
$$;

comment on function public.sales_order_pack_sheet(uuid) is
  'Shipping bins and the picked stock lines for one sales order. editable is true when bins can still be changed. Freight, fees, services, and unpicked lines are left off. No prices.';

create or replace function public.finish_sales_order_pack(
  p_order uuid,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block text;
  v_status text;
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
begin
  perform public.so_require_packing(p_order);

  select status into v_status
  from public.sales_orders
  where id = p_order;

  v_block := public.so_pack_finish_block(p_order);
  if v_block is not null then
    raise exception '%', v_block
      using errcode = '22023';
  end if;

  if v_status in ('shipped', 'partially_shipped') then
    update public.sales_orders
    set packed_at = now(),
        updated_at = now()
    where id = p_order;

    perform public.log_so_event(
      p_order,
      'pack_finished',
      v_status,
      v_status,
      'Packed after shipping. Status stays ' || v_status || '.',
      v_operator,
      v_initials
    );
  else
    update public.sales_orders
    set status = 'packed',
        packed_at = now(),
        updated_at = now()
    where id = p_order;

    perform public.log_so_event(
      p_order,
      'pack_finished',
      'packing',
      'packed',
      null,
      v_operator,
      v_initials
    );
  end if;

  return public.sales_order_pack_sheet(p_order);
end;
$$;

comment on function public.finish_sales_order_pack(uuid, text, uuid) is
  'Sets packed_at when every picked quantity is in a bin and every bin has a weight. An order still in packing becomes packed. An order that is already shipped or partially shipped keeps that status. ship_date and so_shipments are not updated. Does not buy a label or choose a carrier.';

comment on function public.open_sales_order_pack(uuid, text, uuid) is
  'Opens packing after the pick is finished and sets a picking order to packing. Opening it again returns the same sheet. A packed order stays packed. Shipped and partially shipped orders are returned unchanged so the bins can be recorded without leaving that status. Cancelled is refused. Invoiced and closed are returned without opening packing.';

revoke all on function public.so_require_packing(uuid) from public, anon, authenticated;
revoke all on function public.so_package_contents_guard() from public, anon, authenticated;
revoke all on function public.sales_order_pack_sheet(uuid) from public, anon, authenticated;
revoke all on function public.finish_sales_order_pack(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.so_package_contents_guard() to service_role;
grant execute on function public.sales_order_pack_sheet(uuid) to service_role;
grant execute on function public.finish_sales_order_pack(uuid, text, uuid) to service_role;
