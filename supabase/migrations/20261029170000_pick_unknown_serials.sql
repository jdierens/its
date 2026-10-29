-- Unknown serials on a pick can be confirmed and added as Pulled.
-- Pulled matches a pick that has left the stock bin: issued, with no warehouse
-- bin, while the order is still on the staging label. When a staging bin is
-- already assigned and can take an owned piece, the unit is placed in that bin.
-- A serial-only pull still uses pick_sales_order_line and record_pick_serial.
-- No new columns. Apply by hand. Deploying does not run this file.

create or replace function public.record_pick_serial(
  p_pick uuid,
  p_serial text,
  p_initials text,
  p_operator uuid,
  p_coo text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
  v_serial text := public.normalize_serial(p_serial);
  v_coo text;
  v_order uuid;
  v_item uuid;
  v_sku text;
  v_qty numeric;
  v_from uuid;
  v_to uuid;
  v_attached integer;
  v_status text;
  v_unit uuid;
  v_unit_bin uuid;
  v_unit_cycle uuid;
  v_unit_pick uuid;
  v_stage_cycle uuid;
  v_stage_qty integer;
  v_stage_units integer;
  v_on_pick integer;
  v_swap uuid;
  v_swap_bin uuid;
  v_swap_cycle uuid;
  v_ref text;
begin
  select pl.sales_order_id, pl.status, p.item_id, p.qty_picked, p.from_bin_id, p.to_bin_id, i.sku
  into v_order, v_status, v_item, v_qty, v_from, v_to, v_sku
  from public.so_picks p
  join public.so_pick_lists pl on pl.id = p.pick_list_id
  left join public.items i on i.id = p.item_id
  where p.id = p_pick
  for update of p;

  if v_order is null then
    raise exception 'That pick was not found.'
      using errcode = 'P0002';
  end if;
  if v_status is distinct from 'open' then
    raise exception 'This pick sheet is already finished.'
      using errcode = '22023';
  end if;
  if coalesce(v_qty, 0) < 1 then
    raise exception 'Pick a quantity before scanning a serial.'
      using errcode = '22023';
  end if;
  if v_serial is null then
    raise exception 'Enter a serial.'
      using errcode = '22023';
  end if;
  if char_length(v_serial) > 80 then
    raise exception 'A serial is at most 80 characters.'
      using errcode = '22023';
  end if;
  if v_sku is not null and upper(v_serial) = upper(btrim(v_sku)) then
    raise exception 'That scan is the SKU, not a serial.'
      using errcode = '22023';
  end if;
  if v_serial ~ '^\d{1,5}-[A-Za-z]$' then
    raise exception 'That scan is a bin code, not a serial.'
      using errcode = '22023';
  end if;
  v_coo := public.normalize_country(p_coo);

  perform public.lock_item_units(v_item);
  if exists (
    select 1
    from public.so_units
    where item_id = v_item
      and lower(btrim(serial_number)) = lower(v_serial)
  ) then
    raise exception 'That serial is already recorded for this item.'
      using errcode = '22023';
  end if;

  select count(*) into v_attached from public.so_units where pick_id = p_pick;
  if v_attached >= v_qty then
    raise exception 'This pick already has a serial for each piece.'
      using errcode = '22023';
  end if;

  -- No warehouse staging bin: the piece is issued on the pick. That is Pulled.
  if v_to is null then
    select unit.id, unit.bin_id, unit.cycle_id, unit.pick_id, bin.reference
    into v_unit, v_unit_bin, v_unit_cycle, v_unit_pick, v_ref
    from public.stock_units unit
    left join public.bins bin on bin.id = unit.bin_id
    where unit.item_id = v_item
      and unit.serial_number is not null
      and lower(btrim(unit.serial_number)) = lower(v_serial)
    for update of unit;

    if v_unit is not null then
      if exists (select 1 from public.so_units where stock_unit_id = v_unit) then
        raise exception 'That serial is already recorded for this item.'
          using errcode = '22023';
      end if;
      if v_unit_pick is not null and v_unit_pick <> p_pick then
        raise exception 'That serial is on another pick.'
          using errcode = '22023';
      end if;
      if v_unit_bin is not null and (v_from is null or v_unit_bin is distinct from v_from) then
        raise exception 'That serial is in %.', coalesce(v_ref, 'another bin')
          using errcode = '22023';
      end if;

      if v_unit_bin is not null then
        select swap.id
        into v_swap
        from public.stock_units swap
        where swap.pick_id = p_pick
          and swap.status = 'issued'
          and swap.serial_number is null
          and swap.id <> v_unit
          and not exists (
            select 1 from public.so_units linked where linked.stock_unit_id = swap.id
          )
        order by swap.created_at, swap.id
        limit 1
        for update;

        select count(*) into v_on_pick
        from public.stock_units
        where pick_id = p_pick
          and item_id = v_item;

        if v_swap is null and v_on_pick >= v_qty then
          raise exception 'That serial is in % and this pick is already identified.', coalesce(v_ref, 'the source bin')
            using errcode = '22023';
        end if;

        if v_swap is not null then
          update public.stock_units
          set status = 'in_stock',
              bin_id = v_unit_bin,
              cycle_id = v_unit_cycle,
              pick_id = null
          where id = v_swap;
        end if;
      end if;

      update public.stock_units
      set status = 'issued',
          bin_id = null,
          cycle_id = null,
          pick_id = p_pick,
          country_of_origin = coalesce(v_coo, country_of_origin)
      where id = v_unit;
    else
      select unit.id
      into v_unit
      from public.stock_units unit
      where unit.pick_id = p_pick
        and unit.item_id = v_item
        and unit.status = 'issued'
        and unit.serial_number is null
        and not exists (
          select 1 from public.so_units linked where linked.stock_unit_id = unit.id
        )
      order by unit.created_at, unit.id
      limit 1
      for update;

      if v_unit is not null then
        update public.stock_units
        set serial_number = v_serial,
            serial_source = 'pick',
            country_of_origin = coalesce(v_coo, country_of_origin)
        where id = v_unit;
      else
        insert into public.stock_units (
          item_id, serial_number, serial_source, country_of_origin,
          bin_id, cycle_id, status, origin, pick_id
        ) values (
          v_item, v_serial, 'pick', v_coo, null, null, 'issued', 'pick', p_pick
        )
        returning id into v_unit;
      end if;
    end if;
  else
    select contents.cycle_id, contents.qty
    into v_stage_cycle, v_stage_qty
    from public.bin_contents contents
    join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
    where contents.bin_id = v_to
      and contents.item_id = v_item
    for update of contents;

    if v_stage_cycle is null then
      raise exception 'Staging no longer has that quantity.'
        using errcode = '22023';
    end if;

    select count(*) into v_stage_units
    from public.stock_units
    where cycle_id = v_stage_cycle
      and item_id = v_item
      and status = 'in_stock';

    select unit.id, unit.bin_id, unit.cycle_id, unit.pick_id, bin.reference
    into v_unit, v_unit_bin, v_unit_cycle, v_unit_pick, v_ref
    from public.stock_units unit
    left join public.bins bin on bin.id = unit.bin_id
    where unit.item_id = v_item
      and unit.serial_number is not null
      and lower(btrim(unit.serial_number)) = lower(v_serial)
    for update of unit;

    if v_unit is not null then
      if exists (select 1 from public.so_units where stock_unit_id = v_unit) then
        raise exception 'That serial is already recorded for this item.'
          using errcode = '22023';
      end if;
      if v_unit_pick is not null and v_unit_pick <> p_pick then
        raise exception 'That serial is on another pick.'
          using errcode = '22023';
      end if;
      if v_unit_bin is distinct from v_to and v_unit_bin is distinct from v_from then
        raise exception 'That serial is in %.', coalesce(v_ref, 'another bin')
          using errcode = '22023';
      end if;
      if v_unit_bin = v_from and v_unit_bin is distinct from v_to then
        if coalesce(v_stage_qty, 0) - coalesce(v_stage_units, 0) >= 1 then
          update public.stock_units
          set bin_id = v_to,
              cycle_id = v_stage_cycle,
              pick_id = p_pick,
              country_of_origin = coalesce(v_coo, country_of_origin)
          where id = v_unit;
        else
          select swap.id, swap.bin_id, swap.cycle_id
          into v_swap, v_swap_bin, v_swap_cycle
          from public.stock_units swap
          where swap.pick_id = p_pick
            and swap.status = 'in_stock'
            and swap.id <> v_unit
            and not exists (
              select 1 from public.so_units linked where linked.stock_unit_id = swap.id
            )
          order by (swap.serial_number is null) desc, swap.created_at, swap.id
          limit 1
          for update;
          if v_swap is null then
            raise exception 'That serial is in % and this pick is already identified.', coalesce(v_ref, 'the source bin')
              using errcode = '22023';
          end if;
          update public.stock_units
          set bin_id = v_unit_bin,
              cycle_id = v_unit_cycle,
              pick_id = null
          where id = v_swap;
          update public.stock_units
          set bin_id = v_swap_bin,
              cycle_id = v_swap_cycle,
              pick_id = p_pick,
              country_of_origin = coalesce(v_coo, country_of_origin)
          where id = v_unit;
        end if;
      else
        update public.stock_units
        set pick_id = p_pick,
            cycle_id = v_stage_cycle,
            bin_id = v_to,
            country_of_origin = coalesce(v_coo, country_of_origin)
        where id = v_unit;
      end if;
    else
      select unit.id
      into v_unit
      from public.stock_units unit
      where unit.pick_id = p_pick
        and unit.item_id = v_item
        and unit.status = 'in_stock'
        and unit.serial_number is null
        and not exists (
          select 1 from public.so_units linked where linked.stock_unit_id = unit.id
        )
      order by unit.created_at, unit.id
      limit 1
      for update;
      if v_unit is not null then
        update public.stock_units
        set serial_number = v_serial,
            serial_source = 'pick',
            country_of_origin = coalesce(v_coo, country_of_origin)
        where id = v_unit;
      else
        if coalesce(v_stage_qty, 0) - coalesce(v_stage_units, 0) < 1 then
          raise exception 'This pick already has a serial for each piece.'
            using errcode = '22023';
        end if;
        insert into public.stock_units (
          item_id, serial_number, serial_source, country_of_origin,
          bin_id, cycle_id, status, origin, pick_id
        ) values (
          v_item, v_serial, 'pick', v_coo, v_to, v_stage_cycle, 'in_stock', 'pick', p_pick
        )
        returning id into v_unit;
      end if;
    end if;
  end if;

  insert into public.so_units (
    pick_id, item_id, serial_number, country_of_origin, stock_unit_id, operator_id, operator_label
  )
  select p_pick, v_item, v_serial, unit.country_of_origin, unit.id, v_operator, v_initials
  from public.stock_units unit
  where unit.id = v_unit;

  return public.sales_order_pick_sheet(v_order);
exception
  when unique_violation then
    raise exception 'That serial is already recorded for this item.'
      using errcode = '22023';
end;
$$;

comment on function public.record_pick_serial(uuid, text, text, uuid, text) is
  'Attaches one optional serial to a pick and links it to a stock unit. A pick with no warehouse bin issues the unit on that pick (Pulled). A staging bin keeps the unit in that bin. Country of origin is optional. Finish does not require a serial.';


create or replace function public.record_pulled_serial(
  p_order uuid,
  p_allocation uuid,
  p_serial text,
  p_initials text,
  p_operator uuid,
  p_coo text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
  v_serial text := public.normalize_serial(p_serial);
  v_coo text;
  v_status text;
  v_list uuid;
  v_ordered numeric;
  v_item uuid;
  v_sku text;
  v_picked numeric;
  v_pick uuid;
  v_stage uuid;
  v_number bigint;
  v_target uuid;
  v_cycle uuid;
  v_unit uuid;
  v_transfer uuid;
  v_out uuid;
  v_in uuid;
begin
  if v_serial is null then
    raise exception 'Enter a serial.'
      using errcode = '22023';
  end if;
  if char_length(v_serial) > 80 then
    raise exception 'A serial is at most 80 characters.'
      using errcode = '22023';
  end if;
  if v_serial ~ '^\d{1,5}-[A-Za-z]$' then
    raise exception 'That scan is a bin code, not a serial.'
      using errcode = '22023';
  end if;
  v_coo := public.normalize_country(p_coo);

  select status, staging_bin_id, so_number
  into v_status, v_stage, v_number
  from public.sales_orders
  where id = p_order
  for update;

  if v_status is null then
    raise exception 'Sales order not found.'
      using errcode = 'P0002';
  end if;
  if v_status not in ('approved', 'picking') then
    raise exception 'Start from an approved sales order.'
      using errcode = '22023';
  end if;

  select id into v_list
  from public.so_pick_lists
  where sales_order_id = p_order
    and status = 'open'
  for update;
  if v_list is null then
    raise exception 'Open the pick sheet before recording a pick.'
      using errcode = '22023';
  end if;

  select a.qty, coalesce(a.actual_item_id, a.item_id)
  into v_ordered, v_item
  from public.so_line_allocations a
  join public.so_lines l on l.id = a.so_line_id
  join public.items i on i.id = a.item_id
  where a.id = p_allocation
    and l.sales_order_id = p_order
    and public.so_pick_sheet_place(l.line_kind, i.item_type) = 'pick';
  if v_item is null then
    raise exception 'That line is not picked.'
      using errcode = '22023';
  end if;
  select sku into v_sku from public.items where id = v_item;
  if v_sku is not null and upper(v_serial) = upper(btrim(v_sku)) then
    raise exception 'That scan is the SKU, not a serial.'
      using errcode = '22023';
  end if;

  perform public.lock_item_units(v_item);
  if exists (
    select 1
    from public.stock_units
    where item_id = v_item
      and serial_number is not null
      and lower(btrim(serial_number)) = lower(v_serial)
  ) or exists (
    select 1
    from public.so_units
    where item_id = v_item
      and lower(btrim(serial_number)) = lower(v_serial)
  ) then
    raise exception 'That serial is already recorded for this item.'
      using errcode = '22023';
  end if;

  select p.id
  into v_pick
  from public.so_picks p
  where p.pick_list_id = v_list
    and p.allocation_id = p_allocation
    and p.qty_picked > (
      select count(*) from public.so_units u where u.pick_id = p.id
    )
  order by p.picked_at nulls last, p.id
  limit 1
  for update;

  if v_pick is not null then
    return public.record_pick_serial(v_pick, v_serial, v_initials, v_operator, v_coo);
  end if;

  select coalesce(sum(qty_picked), 0) into v_picked
  from public.so_picks
  where pick_list_id = v_list
    and allocation_id = p_allocation;
  if v_picked + 1 > v_ordered then
    raise exception 'Only % still to pick.', greatest(v_ordered - v_picked, 0)
      using errcode = '22023';
  end if;

  v_target := null;
  v_cycle := null;
  if v_stage is not null then
    begin
      v_target := public.so_pick_target_bin(p_order, null, 'owned', v_initials);
      v_cycle := public.so_pick_open_cycle(v_target, null, 'owned', v_initials);
    exception
      when sqlstate '22023' or sqlstate '55000' then
        v_target := null;
        v_cycle := null;
    end;
  end if;

  if v_target is not null and v_cycle is not null then
    perform public.lock_bins(array[v_target]);
    perform public.adjust_bin_cycle_qty(v_cycle, v_target, v_item, 1);
    v_transfer := gen_random_uuid();

    insert into public.inventory_movements (
      item_id, bin_id, direction, qty, ownership, transfer_id, ref_type, ref_id, ref_label,
      operator_id, operator_label, notes, reason
    ) values (
      v_item, null, 'out', 1, 'owned', v_transfer, 'sales_order', p_order,
      'SO' || v_number::text, v_operator, v_initials, null, 'pulled serial'
    )
    returning id into v_out;

    insert into public.inventory_movements (
      item_id, bin_id, direction, qty, ownership, transfer_id, ref_type, ref_id, ref_label,
      source_movement_id, operator_id, operator_label, notes, reason
    ) values (
      v_item, v_target, 'in', 1, 'owned', v_transfer, 'sales_order', p_order,
      'SO' || v_number::text, v_out, v_operator, v_initials, null, 'pulled serial'
    )
    returning id into v_in;
  end if;

  insert into public.so_picks (
    pick_list_id, allocation_id, item_id, from_bin_id, to_bin_id,
    qty_asked, qty_picked, short, project, ownership,
    operator_id, operator_label, picked_at, bin_scan
  ) values (
    v_list, p_allocation, v_item, null, v_target,
    1, 1, false, null, 'owned',
    v_operator, v_initials, now(), 'Pulled'
  )
  returning id into v_pick;

  if v_target is not null and v_cycle is not null then
    insert into public.stock_units (
      item_id, serial_number, serial_source, country_of_origin,
      bin_id, cycle_id, status, origin, pick_id
    ) values (
      v_item, v_serial, 'pick', v_coo, v_target, v_cycle, 'in_stock', 'pick', v_pick
    )
    returning id into v_unit;
    perform public.link_movement_units(v_out, v_in, array[v_unit]);
  else
    insert into public.stock_units (
      item_id, serial_number, serial_source, country_of_origin,
      bin_id, cycle_id, status, origin, pick_id
    ) values (
      v_item, v_serial, 'pick', v_coo, null, null, 'issued', 'pick', v_pick
    )
    returning id into v_unit;
  end if;

  insert into public.so_units (
    pick_id, item_id, serial_number, country_of_origin, stock_unit_id, operator_id, operator_label
  )
  select v_pick, v_item, v_serial, unit.country_of_origin, unit.id, v_operator, v_initials
  from public.stock_units unit
  where unit.id = v_unit;

  return public.sales_order_pick_sheet(p_order);
exception
  when unique_violation then
    raise exception 'That serial is already recorded for this item.'
      using errcode = '22023';
end;
$$;

comment on function public.record_pulled_serial(uuid, uuid, text, text, uuid, text) is
  'Adds one serial that is not already a stock unit. Fills an open pull on the line when one has room. Otherwise records one Pulled piece: issued on the pick, or in the staging bin when that bin can take an owned piece. bin_scan Pulled marks the row.';


create or replace function public.undo_sales_order_pick(
  p_pick uuid,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
  v_order uuid;
  v_status text;
  v_item uuid;
  v_from uuid;
  v_to uuid;
  v_qty numeric;
  v_project text;
  v_ownership text;
  v_number bigint;
  v_have integer;
  v_source_cycle uuid;
  v_stage_cycle uuid;
  v_transfer uuid := gen_random_uuid();
  v_out uuid;
  v_in uuid;
begin
  select
    pl.sales_order_id, pl.status, p.item_id, p.from_bin_id, p.to_bin_id,
    p.qty_picked, p.project, p.ownership
  into v_order, v_status, v_item, v_from, v_to, v_qty, v_project, v_ownership
  from public.so_picks p
  join public.so_pick_lists pl on pl.id = p.pick_list_id
  where p.id = p_pick
  for update of p;

  if v_order is null then
    raise exception 'That pick was not found.'
      using errcode = 'P0002';
  end if;
  if v_status is distinct from 'open' then
    raise exception 'This pick sheet is already finished.'
      using errcode = '22023';
  end if;

  perform 1 from public.sales_orders where id = v_order for update;

  if coalesce(v_qty, 0) < 1 then
    update public.so_units
    set stock_unit_id = null
    where pick_id = p_pick
      and stock_unit_id is not null;
    delete from public.stock_units
    where pick_id = p_pick
      and origin = 'pick';
    update public.stock_units
    set pick_id = null
    where pick_id = p_pick;
    delete from public.so_picks where id = p_pick;
    return public.sales_order_pick_sheet(v_order);
  end if;

  if v_from is null then
    update public.so_units
    set stock_unit_id = null
    where pick_id = p_pick
      and stock_unit_id is not null;
    delete from public.stock_units
    where pick_id = p_pick
      and origin = 'pick';
    update public.stock_units
    set pick_id = null
    where pick_id = p_pick;

    if v_to is not null then
      perform public.lock_bins(array[v_to]);
      select contents.qty, contents.cycle_id
      into v_have, v_stage_cycle
      from public.bin_contents contents
      join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
      where contents.bin_id = v_to
        and contents.item_id = v_item
      for update of contents;
      if v_stage_cycle is null or coalesce(v_have, 0) < v_qty then
        raise exception 'Staging no longer has that quantity.'
          using errcode = '22023';
      end if;
      perform public.adjust_bin_cycle_qty(v_stage_cycle, v_to, v_item, (-v_qty)::integer);
      select so_number into v_number from public.sales_orders where id = v_order;
      v_ownership := public.so_pick_ownership(v_project, v_ownership);
      insert into public.inventory_movements (
        item_id, bin_id, direction, qty, ownership, transfer_id, ref_type, ref_id, ref_label,
        operator_id, operator_label, notes, reason
      ) values (
        v_item, v_to, 'out', v_qty, v_ownership, v_transfer, 'sales_order', v_order,
        'SO' || v_number::text, v_operator, v_initials, nullif(btrim(coalesce(v_project, '')), ''),
        'undo pulled serial'
      )
      returning id into v_out;
      insert into public.inventory_movements (
        item_id, bin_id, direction, qty, ownership, transfer_id, ref_type, ref_id, ref_label,
        source_movement_id, operator_id, operator_label, notes, reason
      ) values (
        v_item, null, 'in', v_qty, v_ownership, v_transfer, 'sales_order', v_order,
        'SO' || v_number::text, v_out, v_operator, v_initials, nullif(btrim(coalesce(v_project, '')), ''),
        'undo pulled serial'
      )
      returning id into v_in;
    end if;

    delete from public.so_picks where id = p_pick;
    return public.sales_order_pick_sheet(v_order);
  end if;

  if v_qty <> trunc(v_qty) then
    raise exception 'That pick is not a whole number.'
      using errcode = '22023';
  end if;

  if v_to is null then
    v_source_cycle := public.so_restore_source_cycle(v_from, v_project, v_ownership, v_initials);
    perform public.adjust_bin_cycle_qty(v_source_cycle, v_from, v_item, v_qty::integer);
    select so_number into v_number from public.sales_orders where id = v_order;
    v_ownership := public.so_pick_ownership(v_project, v_ownership);

    insert into public.inventory_movements (
      item_id, bin_id, direction, qty, ownership, transfer_id, ref_type, ref_id, ref_label,
      operator_id, operator_label, notes, reason
    ) values (
      v_item, null, 'out', v_qty, v_ownership, v_transfer, 'sales_order', v_order,
      'SO' || v_number::text, v_operator, v_initials, nullif(btrim(coalesce(v_project, '')), ''),
      'undo sales order pick'
    )
    returning id into v_out;

    insert into public.inventory_movements (
      item_id, bin_id, direction, qty, ownership, transfer_id, ref_type, ref_id, ref_label,
      source_movement_id, operator_id, operator_label, notes, reason
    ) values (
      v_item, v_from, 'in', v_qty, v_ownership, v_transfer, 'sales_order', v_order,
      'SO' || v_number::text, v_out, v_operator, v_initials, nullif(btrim(coalesce(v_project, '')), ''),
      'undo sales order pick'
    )
    returning id into v_in;

    update public.stock_units
    set status = 'in_stock',
        bin_id = v_from,
        cycle_id = v_source_cycle,
        updated_at = now()
    where pick_id = p_pick
      and status = 'issued';

    perform public.return_pick_units(p_pick, v_source_cycle, v_from, v_out, v_in);
    delete from public.so_picks where id = p_pick;
    return public.sales_order_pick_sheet(v_order);
  end if;

  perform public.lock_bins(array[v_from, v_to]);

  select contents.qty, contents.cycle_id
  into v_have, v_stage_cycle
  from public.bin_contents contents
  join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
  where contents.bin_id = v_to
    and contents.item_id = v_item
  for update of contents;

  if v_have is null or v_have < v_qty then
    raise exception 'Staging no longer has that quantity.'
      using errcode = '22023';
  end if;
  if (select project from public.bin_cycles where id = v_stage_cycle) is distinct from nullif(btrim(coalesce(v_project, '')), '') then
    raise exception 'Staging no longer has that project.'
      using errcode = '22023';
  end if;

  if v_qty <> trunc(v_qty) then
    raise exception 'That pick is not a whole number.'
      using errcode = '22023';
  end if;

  v_source_cycle := public.so_restore_source_cycle(v_from, v_project, v_ownership, v_initials);
  perform public.adjust_bin_cycle_qty(v_stage_cycle, v_to, v_item, (-v_qty)::integer);
  perform public.adjust_bin_cycle_qty(v_source_cycle, v_from, v_item, v_qty::integer);

  select so_number into v_number from public.sales_orders where id = v_order;
  v_ownership := public.so_pick_ownership(v_project, v_ownership);

  insert into public.inventory_movements (
    item_id, bin_id, direction, qty, ownership, transfer_id, ref_type, ref_id, ref_label,
    operator_id, operator_label, notes, reason
  ) values (
    v_item, v_to, 'out', v_qty, v_ownership, v_transfer, 'sales_order', v_order,
    'SO' || v_number::text, v_operator, v_initials, nullif(btrim(coalesce(v_project, '')), ''),
    'undo sales order pick'
  )
  returning id into v_out;

  insert into public.inventory_movements (
    item_id, bin_id, direction, qty, ownership, transfer_id, ref_type, ref_id, ref_label,
    source_movement_id, operator_id, operator_label, notes, reason
  ) values (
    v_item, v_from, 'in', v_qty, v_ownership, v_transfer, 'sales_order', v_order,
    'SO' || v_number::text, v_out, v_operator, v_initials, nullif(btrim(coalesce(v_project, '')), ''),
    'undo sales order pick'
  )
  returning id into v_in;

  perform public.return_pick_units(p_pick, v_source_cycle, v_from, v_out, v_in);

  delete from public.so_picks where id = p_pick;
  return public.sales_order_pick_sheet(v_order);
end;
$$;

comment on function public.undo_sales_order_pick(uuid, text, uuid) is
  'Moves a pick back to its source bin. A Pulled serial, which has no source bin, drops the unit it created and the staging quantity when that pick was placed in a bin.';


do $patch$
declare
  v_def text;
  v_next text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'sales_order_pick_sheet'
    and pg_get_function_identity_arguments(p.oid) in ('uuid', 'p_order uuid');

  if v_def is null then
    raise exception 'sales_order_pick_sheet is missing.';
  end if;
  if v_def like '%bin_scan = ''Pulled''%' then
    raise exception 'sales_order_pick_sheet already labels Pulled picks.';
  end if;

  v_next := replace(
    v_def,
    '''from_bin'', fb.reference,',
    '''from_bin'', coalesce(fb.reference, case when p.bin_scan = ''Pulled'' then ''Pulled'' else null end),'
  );
  if v_next = v_def then
    raise exception 'sales_order_pick_sheet from_bin was not found.';
  end if;
  execute v_next;
end
$patch$;

revoke all on function public.record_pulled_serial(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_pulled_serial(uuid, uuid, text, text, uuid, text) to service_role;

notify pgrst, 'reload schema';
