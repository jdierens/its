-- Packing stays a row per shipping bin. A finished pack can still be corrected.
-- Finish still stores packed_at. A correction that leaves the pack incomplete
-- reopens it: supabase/migrations/20261106010000_pack_edit_after_finish.sql
-- clears packed_at, and this sheet still reports that finish block. An order
-- that is shipped or partially shipped keeps that status, the ship date, and
-- the shipment rows. Cancelled, invoiced, and closed stay closed.
-- A picked serial can be placed in a bin. The serial is resolved to the pick
-- line that already recorded it. This does not create an item.
-- Duplicate copies one complete bin into the next bin number: same type, size,
-- and weight, and the same item quantities when that much is still unpacked.
-- Serial numbers already in the source bin stay there. The copy takes the next
-- unpacked serials of that item when the pick has them.
-- Apply by hand on project fxsbpreasbdalwthyzvk after
-- supabase/migrations/20261106010000_pack_edit_after_finish.sql.
-- Deploying does not run this file.

create or replace function public.so_packing_writable(p_status text, p_packed_at timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('packing', 'packed', 'shipped', 'partially_shipped');
$$;

comment on function public.so_packing_writable(text, timestamptz) is
  'True while a pack can be corrected: packing, packed, shipped, or partially shipped. packed_at does not lock the sheet. Cancelled, invoiced, closed, and every earlier status stay false. Shipped status is not changed by a pack edit.';

revoke all on function public.so_packing_writable(text, timestamptz) from public, anon, authenticated;

alter table public.so_units drop constraint if exists so_units_package_fkey;

alter table public.so_units
  add constraint so_units_package_fkey
  foreign key (package_id) references public.so_packages (id) on delete set null;

create index if not exists so_units_package_idx
  on public.so_units (package_id)
  where package_id is not null;

comment on column public.so_units.package_id is
  'Shipping bin this picked serial was packed into. Null until the pack sheet assigns it. Deleting the bin returns the serial to the unpacked pick.';

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
      'serials', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', u.id,
          'serial', u.serial_number,
          'package_id', u.package_id
        ) order by u.scanned_at, u.serial_number, u.id)
        from public.so_units u
        join public.so_picks pk on pk.id = u.pick_id
        where pk.pick_list_id = v_list
          and pk.allocation_id = r.allocation_id
          and nullif(btrim(u.serial_number), '') is not null
      ), '[]'::jsonb),
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
    when v_order.status in ('cancelled', 'closed', 'invoiced') then null
    when public.so_packing_writable(v_order.status, v_order.packed_at)
      or v_order.status in ('shipped', 'partially_shipped')
      then public.so_pack_finish_block(p_order)
    else null
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
  'Shipping bins, picked stock lines, and picked serials for one sales order. editable stays true after packing finishes, including a shipped order, while the pick is still finished. finish_block says what is incomplete, including on a pack that was finished. A shipped order stays shipped. Cancelled, invoiced, and closed stay closed. Freight, fees, services, and unpicked lines are left off. No prices.';

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
  v_packed timestamptz;
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
begin
  perform public.so_require_packing(p_order);

  select status, packed_at into v_status, v_packed
  from public.sales_orders
  where id = p_order;

  v_block := public.so_pack_finish_block(p_order);

  -- Already finished and still complete. Leave status and packed_at alone.
  if v_block is null and (
    v_status = 'packed'
    or (v_status in ('shipped', 'partially_shipped') and v_packed is not null)
  ) then
    return public.sales_order_pack_sheet(p_order);
  end if;

  if v_block is not null then
    raise exception '%', v_block
      using errcode = '22023';
  end if;

  -- shipped catch-up finish
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
  elsif v_status = 'packing' then
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
  else
    raise exception 'Packing is closed on this sales order.'
      using errcode = '22023';
  end if;

  return public.sales_order_pack_sheet(p_order);
end;
$$;

comment on function public.finish_sales_order_pack(uuid, text, uuid) is
  'Sets packed_at when every picked quantity is in a bin and every bin has a weight. An order still in packing becomes packed. An order that is already shipped or partially shipped keeps that status. Finishing again, while the pack is still complete, changes nothing. ship_date and so_shipments are not updated. Does not buy a label or choose a carrier.';

create or replace function public.remove_pack_assignment(
  p_content uuid,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_package uuid;
  v_allocation uuid;
begin
  perform public.operator_initials(p_initials);
  perform public.so_known_operator(p_operator);

  select pkg.sales_order_id, c.package_id, c.allocation_id
  into v_order, v_package, v_allocation
  from public.so_package_contents c
  join public.so_packages pkg on pkg.id = c.package_id
  where c.id = p_content
  for update of pkg;

  if v_order is null then
    raise exception 'That packed quantity was not found.'
      using errcode = 'P0002';
  end if;

  perform public.so_require_packing(v_order);

  update public.so_units u
  set package_id = null
  from public.so_picks p
  where u.pick_id = p.id
    and u.package_id = v_package
    and p.allocation_id = v_allocation;

  delete from public.so_package_contents where id = p_content;
  return public.sales_order_pack_sheet(v_order);
end;
$$;

comment on function public.remove_pack_assignment(uuid, text, uuid) is
  'Takes a packed quantity back out of a shipping bin and returns any serials in that quantity to the unpacked pick.';

create or replace function public.release_pack_item_qty(
  p_content uuid,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_package uuid;
  v_allocation uuid;
  v_qty numeric;
  v_serials integer;
begin
  perform public.operator_initials(p_initials);
  perform public.so_known_operator(p_operator);

  select pkg.sales_order_id, c.package_id, c.allocation_id, c.qty
  into v_order, v_package, v_allocation, v_qty
  from public.so_package_contents c
  join public.so_packages pkg on pkg.id = c.package_id
  where c.id = p_content
  for update of pkg;

  if v_order is null then
    raise exception 'That packed quantity was not found.'
      using errcode = 'P0002';
  end if;

  perform public.so_require_packing(v_order);

  select count(*)::integer into v_serials
  from public.so_units u
  join public.so_picks p on p.id = u.pick_id
  where u.package_id = v_package
    and p.allocation_id = v_allocation;

  if v_serials <= 0 then
    delete from public.so_package_contents where id = p_content;
  elsif v_qty > v_serials then
    update public.so_package_contents
    set qty = v_serials
    where id = p_content;
  else
    raise exception 'That quantity is packed by serial. Remove the serial.'
      using errcode = '22023';
  end if;

  return public.sales_order_pack_sheet(v_order);
end;
$$;

comment on function public.release_pack_item_qty(uuid, text, uuid) is
  'Removes the item quantity in a bin that is not tied to a serial. Serials in that bin stay packed.';

create or replace function public.assign_pack_serial(
  p_package uuid,
  p_serial text,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_list uuid;
  v_serial text := nullif(btrim(p_serial), '');
  v_count integer;
  v_unit uuid;
  v_unit_package uuid;
  v_allocation uuid;
  v_box integer;
  v_kind text;
  v_label text;
begin
  perform public.operator_initials(p_initials);
  perform public.so_known_operator(p_operator);

  if v_serial is null then
    raise exception 'Enter a serial.'
      using errcode = '22023';
  end if;

  select sales_order_id into v_order
  from public.so_packages
  where id = p_package
  for update;

  if v_order is null then
    raise exception 'That shipping bin was not found.'
      using errcode = 'P0002';
  end if;

  perform public.so_require_packing(v_order);
  v_list := public.so_pack_pick_list(v_order);

  select count(*)::integer into v_count
  from public.so_units u
  join public.so_picks p on p.id = u.pick_id
  where p.pick_list_id = v_list
    and lower(btrim(u.serial_number)) = lower(v_serial);

  if v_count = 0 then
    raise exception 'That serial is not on this pick.'
      using errcode = '22023';
  end if;
  if v_count > 1 then
    raise exception 'That serial matches more than one picked item.'
      using errcode = '22023';
  end if;

  select u.id, u.package_id, p.allocation_id
  into v_unit, v_unit_package, v_allocation
  from public.so_units u
  join public.so_picks p on p.id = u.pick_id
  where p.pick_list_id = v_list
    and lower(btrim(u.serial_number)) = lower(v_serial)
  for update of u;

  if v_unit_package = p_package then
    raise exception 'That serial is already in this bin.'
      using errcode = '22023';
  end if;

  if v_unit_package is not null then
    select pkg.box_number, coalesce(pkg.kind, 'box')
    into v_box, v_kind
    from public.so_packages pkg
    where pkg.id = v_unit_package;
    v_label := case when v_kind = 'pallet' then 'Pallet ' else 'Box ' end || v_box::text;
    raise exception 'That serial is already in %.', v_label
      using errcode = '22023';
  end if;

  update public.so_package_contents
  set qty = qty + 1
  where package_id = p_package
    and allocation_id = v_allocation;

  if not found then
    insert into public.so_package_contents (package_id, allocation_id, qty)
    values (p_package, v_allocation, 1);
  end if;

  update public.so_units
  set package_id = p_package
  where id = v_unit;

  return public.sales_order_pack_sheet(v_order);
end;
$$;

comment on function public.assign_pack_serial(uuid, text, text, uuid) is
  'Packs one picked serial into a shipping bin. The item and the quantity come from the pick that recorded the serial. Does not create an item or a serial.';

create or replace function public.remove_pack_serial(
  p_unit uuid,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_package uuid;
  v_allocation uuid;
  v_content uuid;
  v_qty numeric;
begin
  perform public.operator_initials(p_initials);
  perform public.so_known_operator(p_operator);

  select pl.sales_order_id, u.package_id, p.allocation_id
  into v_order, v_package, v_allocation
  from public.so_units u
  join public.so_picks p on p.id = u.pick_id
  join public.so_pick_lists pl on pl.id = p.pick_list_id
  where u.id = p_unit;

  if v_order is null then
    raise exception 'That serial was not found.'
      using errcode = 'P0002';
  end if;

  perform public.so_require_packing(v_order);

  select package_id into v_package
  from public.so_units
  where id = p_unit
  for update;

  if v_package is null then
    raise exception 'That serial is not in a bin.'
      using errcode = '22023';
  end if;

  select c.id, c.qty into v_content, v_qty
  from public.so_package_contents c
  where c.package_id = v_package
    and c.allocation_id = v_allocation
  for update;

  if v_content is null then
    update public.so_units set package_id = null where id = p_unit;
    return public.sales_order_pack_sheet(v_order);
  end if;

  if v_qty <= 1 then
    delete from public.so_package_contents where id = v_content;
  else
    update public.so_package_contents
    set qty = qty - 1
    where id = v_content;
  end if;

  update public.so_units
  set package_id = null
  where id = p_unit;

  return public.sales_order_pack_sheet(v_order);
end;
$$;

comment on function public.remove_pack_serial(uuid, text, uuid) is
  'Takes one serial out of its shipping bin and reduces that bin quantity by one.';

create or replace function public.duplicate_shipping_bin(
  p_package uuid,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.so_packages;
  v_order uuid;
  v_list uuid;
  v_number integer;
  v_new uuid;
  v_label text;
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
  v_sku text;
  v_picked numeric;
  v_packed numeric;
  v_room numeric;
  v_unpacked integer;
  v_take integer;
  r record;
begin
  select * into v_src
  from public.so_packages
  where id = p_package
  for update;

  if not found then
    raise exception 'That shipping bin was not found.'
      using errcode = 'P0002';
  end if;

  v_order := v_src.sales_order_id;
  perform public.so_require_packing(v_order);
  v_list := public.so_pack_pick_list(v_order);
  v_label := case when v_src.kind = 'pallet' then 'Pallet ' else 'Box ' end || v_src.box_number::text;

  if v_src.weight_lb is null or v_src.weight_lb <= 0 then
    raise exception '% needs a weight before it can be duplicated.', v_label
      using errcode = '22023';
  end if;
  if v_src.height_in is null or v_src.height_in <= 0 then
    raise exception '% needs a height before it can be duplicated.', v_label
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.so_package_contents
    where package_id = p_package
      and qty > 0
  ) then
    raise exception '% needs contents before it can be duplicated.', v_label
      using errcode = '22023';
  end if;

  select coalesce(min(n), 1) into v_number
  from generate_series(
    1,
    coalesce((select max(box_number) from public.so_packages where sales_order_id = v_order), 0) + 1
  ) as n
  where not exists (
    select 1
    from public.so_packages
    where sales_order_id = v_order
      and box_number = n
  );

  insert into public.so_packages (
    sales_order_id, box_number, length_in, width_in, height_in, weight_lb,
    packaging_type_id, kind, operator_id, operator_label
  ) values (
    v_order, v_number, v_src.length_in, v_src.width_in, v_src.height_in, v_src.weight_lb,
    v_src.packaging_type_id, v_src.kind, v_operator, v_initials
  )
  returning id into v_new;

  for r in
    select c.allocation_id, c.qty
    from public.so_package_contents c
    where c.package_id = p_package
      and c.qty > 0
    order by c.id
  loop
    if r.allocation_id is null then
      raise exception 'That packed quantity is not on a picked line.'
        using errcode = '22023';
    end if;

    select coalesce(actual.sku, i.sku) into v_sku
    from public.so_line_allocations a
    join public.items i on i.id = a.item_id
    left join public.items actual on actual.id = a.actual_item_id
    where a.id = r.allocation_id;

    if v_sku is null then
      raise exception 'That packed quantity is not on a picked line.'
        using errcode = '22023';
    end if;

    select coalesce(sum(p.qty_picked), 0) into v_picked
    from public.so_picks p
    where p.pick_list_id = v_list
      and p.allocation_id = r.allocation_id;

    select coalesce(sum(c.qty), 0) into v_packed
    from public.so_package_contents c
    join public.so_packages pkg on pkg.id = c.package_id
    where pkg.sales_order_id = v_order
      and c.allocation_id = r.allocation_id;

    v_room := v_picked - v_packed;
    if v_room < r.qty then
      raise exception 'Only % of % can go in the next bin.', public.so_format_pack_qty(v_room), v_sku
        using errcode = '22023';
    end if;

    insert into public.so_package_contents (package_id, allocation_id, qty)
    values (v_new, r.allocation_id, r.qty);

    select count(*)::integer into v_unpacked
    from public.so_units u
    join public.so_picks p on p.id = u.pick_id
    where p.pick_list_id = v_list
      and p.allocation_id = r.allocation_id
      and u.package_id is null;

    v_take := least(trunc(r.qty)::integer, v_unpacked);
    if v_take > 0 then
      update public.so_units u
      set package_id = v_new
      from (
        select next_unit.id
        from public.so_units next_unit
        join public.so_picks p on p.id = next_unit.pick_id
        where p.pick_list_id = v_list
          and p.allocation_id = r.allocation_id
          and next_unit.package_id is null
        order by next_unit.scanned_at, next_unit.id
        limit v_take
      ) next_units
      where u.id = next_units.id;
    end if;
  end loop;

  return public.sales_order_pack_sheet(v_order);
end;
$$;

comment on function public.duplicate_shipping_bin(uuid, text, uuid) is
  'Copies a complete shipping bin to the next bin number. Weight, size, and item quantities are copied when the unpacked pick still has that quantity. Serials already in the source stay there. The copy uses the next unpacked serials of the same picked item when they exist.';

revoke all on function public.sales_order_pack_sheet(uuid) from public, anon, authenticated;
revoke all on function public.finish_sales_order_pack(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.remove_pack_assignment(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.release_pack_item_qty(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.assign_pack_serial(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.remove_pack_serial(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.duplicate_shipping_bin(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.sales_order_pack_sheet(uuid) to service_role;
grant execute on function public.finish_sales_order_pack(uuid, text, uuid) to service_role;
grant execute on function public.remove_pack_assignment(uuid, text, uuid) to service_role;
grant execute on function public.release_pack_item_qty(uuid, text, uuid) to service_role;
grant execute on function public.assign_pack_serial(uuid, text, text, uuid) to service_role;
grant execute on function public.remove_pack_serial(uuid, text, uuid) to service_role;
grant execute on function public.duplicate_shipping_bin(uuid, text, uuid) to service_role;
