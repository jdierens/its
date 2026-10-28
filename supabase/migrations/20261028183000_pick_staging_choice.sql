-- Picking no longer mints a warehouse bin.
-- Opening a pick sheet leaves staging on the label "staging bin SO" plus the
-- sales order number. That label is not a bins row and does not take a number
-- from bin_counter. The operator can scan a bin that already exists, and the
-- pick then moves into that bin. A pick with no scanned bin still leaves the
-- source bin. The ledger in row has no bin, and stock units that no longer fit
-- are issued to the pick.
-- Apply by hand after supabase/migrations/20261028073000_so_sku_replacement.sql.
-- Deploying does not run this file.

create or replace function public.issue_picked_units(
  p_from_cycle uuid,
  p_item uuid,
  p_pick uuid,
  p_out uuid,
  p_in uuid
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_units integer;
  v_qty integer;
  v_move integer;
  v_ids uuid[];
begin
  if p_from_cycle is null or p_item is null then
    return 0;
  end if;

  perform public.lock_item_units(p_item);

  select count(*) into v_units
  from public.stock_units
  where cycle_id = p_from_cycle
    and item_id = p_item
    and status = 'in_stock';

  select qty into v_qty
  from public.bin_contents
  where cycle_id = p_from_cycle
    and item_id = p_item;

  v_move := greatest(coalesce(v_units, 0) - coalesce(v_qty, 0), 0);
  if v_move = 0 then
    return 0;
  end if;

  with chosen as (
    select id
    from public.stock_units
    where cycle_id = p_from_cycle
      and item_id = p_item
      and status = 'in_stock'
    order by (serial_number is null) desc, created_at, id
    limit v_move
    for update
  ),
  moved as (
    update public.stock_units unit
    set status = 'issued',
        bin_id = null,
        cycle_id = null,
        pick_id = coalesce(p_pick, unit.pick_id),
        updated_at = now()
    from chosen
    where unit.id = chosen.id
    returning unit.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from moved;

  perform public.link_movement_units(p_out, p_in, v_ids);
  return coalesce(cardinality(v_ids), 0);
end;
$$;

comment on function public.issue_picked_units(uuid, uuid, uuid, uuid, uuid) is
  'Issues units that no longer fit in the source bin onto a pick that has no warehouse staging bin. Call it after the source quantity is reduced.';

create or replace function public.so_create_staging_bin(
  p_initials text,
  p_note text,
  p_parent uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Scan an existing staging bin. Picking does not create a bin number.'
    using errcode = '22023';
end;
$$;

comment on function public.so_create_staging_bin(text, text, uuid) is
  'Refuses to mint a bin. A pick uses the label staging bin SO plus the sales order number, or a bin the operator scans.';


create or replace function public.so_pick_target_bin(
  p_order uuid,
  p_project text,
  p_ownership text,
  p_initials text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
  v_number bigint;
  v_cycle uuid;
  v_have text;
  v_child uuid;
begin
  select staging_bin_id, so_number into v_parent, v_number
  from public.sales_orders
  where id = p_order;
  if v_parent is null then
    raise exception 'Scan a staging bin, or leave this order on its staging label.'
      using errcode = '22023';
  end if;

  p_project := nullif(btrim(coalesce(p_project, '')), '');

  select c.id, c.project into v_cycle, v_have
  from public.bin_cycles c
  where c.bin_id = v_parent
    and c.status = 'open';

  if v_cycle is null or v_have is not distinct from p_project then
    return v_parent;
  end if;

  select b.id into v_child
  from public.bins b
  join public.bin_cycles c on c.bin_id = b.id and c.status = 'open'
  where b.parent_bin_id = v_parent
    and c.project is not distinct from p_project
  limit 1;
  if v_child is not null then
    return v_child;
  end if;

  select b.id into v_child
  from public.bins b
  where b.parent_bin_id = v_parent
    and not exists (
      select 1 from public.bin_cycles c
      where c.bin_id = b.id and c.status = 'open'
    )
    and not exists (
      select 1 from public.bin_contents contents
      where contents.bin_id = b.id
    )
  order by b.reference
  limit 1;
  if v_child is not null then
    return v_child;
  end if;

  raise exception 'That staging bin is already another project. Scan a bin for this project.'
    using errcode = '22023';
end;
$$;

create or replace function public.open_sales_order_pick(
  p_order uuid,
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
  v_status text;
  v_number bigint;
  v_staging uuid;
  v_list uuid;
begin
  select status, so_number, staging_bin_id
  into v_status, v_number, v_staging
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
  if v_number is null then
    raise exception 'Approve the sales order before picking.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.so_lines l
    join public.so_line_allocations a on a.so_line_id = l.id
    join public.items i on i.id = a.item_id
    where l.sales_order_id = p_order
      and l.line_kind in ('product', 'kit')
      and i.item_type in ('Product', 'Kit/Package')
  ) then
    raise exception 'Nothing to pick on this order.'
      using errcode = '22023';
  end if;

  select id into v_list
  from public.so_pick_lists
  where sales_order_id = p_order
    and status <> 'cancelled'
  order by created_at desc
  limit 1
  for update;

  if v_list is not null then
    return public.sales_order_pick_sheet(p_order);
  end if;

  insert into public.so_pick_lists (
    sales_order_id, status, staging_bin_id, picker_label, started_at, operator_id
  ) values (
    p_order, 'open', v_staging, v_initials, now(), v_operator
  );

  update public.sales_orders
  set status = 'picking',
      updated_at = now()
  where id = p_order;

  perform public.log_so_event(
    p_order,
    'picking_started',
    v_status,
    'picking',
    format('staging bin SO%s', v_number),
    v_operator,
    v_initials
  );

  return public.sales_order_pick_sheet(p_order);
end;
$$;

comment on function public.open_sales_order_pick(uuid, text, uuid) is
  'Opens the pick sheet and sets the order to picking. Does not create a bin. Staging stays the label staging bin SO plus the number until a bin is scanned. Opening it again returns the same sheet.';


create or replace function public.pick_sales_order_line(
  p_order uuid,
  p_allocation uuid,
  p_from uuid,
  p_qty integer,
  p_initials text,
  p_operator uuid,
  p_request text,
  p_replacement uuid default null,
  p_replacement_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
  v_request text := public.blank_to_null(p_request);
  v_list uuid;
  v_ordered numeric;
  v_item uuid;
  v_planned uuid;
  v_actual uuid;
  v_sku text;
  v_picked numeric;
  v_have integer;
  v_source_cycle uuid;
  v_project text;
  v_raw_ownership text;
  v_ownership text;
  v_target uuid;
  v_stage uuid;
  v_target_cycle uuid;
  v_got_project text;
  v_got_ownership text;
  v_number bigint;
  v_transfer uuid := gen_random_uuid();
  v_out uuid;
  v_in uuid;
  v_pick uuid;
  v_from_ref text;
  v_to_ref text;
begin
  if v_request is null or char_length(v_request) < 8 or char_length(v_request) > 80 then
    raise exception 'Request id is required.'
      using errcode = '22023';
  end if;
  if p_qty is null or p_qty < 1 then
    raise exception 'Enter a whole number of at least 1.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_request, 0));
  if exists (select 1 from public.so_picks where client_request_id = v_request) then
    if not exists (
      select 1
      from public.so_picks p
      join public.so_pick_lists pl on pl.id = p.pick_list_id
      where p.client_request_id = v_request
        and pl.sales_order_id = p_order
    ) then
      raise exception 'That request was already used.'
        using errcode = '22023';
    end if;
    return public.sales_order_pick_sheet(p_order);
  end if;

  if (select status from public.sales_orders where id = p_order for update) not in ('approved', 'picking') then
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

  select a.qty, a.item_id, a.actual_item_id
  into v_ordered, v_planned, v_actual
  from public.so_line_allocations a
  join public.so_lines l on l.id = a.so_line_id
  join public.items i on i.id = a.item_id
  where a.id = p_allocation
    and l.sales_order_id = p_order
    and public.so_pick_sheet_place(l.line_kind, i.item_type) = 'pick';
  if v_planned is null then
    raise exception 'That line is not picked.'
      using errcode = '22023';
  end if;

  v_item := coalesce(v_actual, v_planned);
  if p_replacement is not null and p_replacement is distinct from v_item then
    perform public.set_so_allocation_replacement(
      p_allocation,
      p_replacement,
      p_replacement_reason,
      p_initials,
      v_operator,
      'pick'
    );
    select coalesce(actual_item_id, item_id) into v_item
    from public.so_line_allocations
    where id = p_allocation;
  end if;
  select sku into v_sku from public.items where id = v_item;

  if exists (
    select 1
    from public.sales_orders staged
    join public.bins source on source.id = p_from
    where staged.staging_bin_id = source.id
       or staged.staging_bin_id = source.parent_bin_id
  ) then
    raise exception 'Pick from a stock bin, not a staging bin.'
      using errcode = '22023';
  end if;

  perform public.lock_bins(array[p_from]);

  select contents.qty, contents.cycle_id, cycle.project, cycle.ownership
  into v_have, v_source_cycle, v_project, v_raw_ownership
  from public.bin_contents contents
  join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
  where contents.bin_id = p_from
    and contents.item_id = v_item
  for update of contents;

  if v_have is null then
    raise exception 'That bin does not hold this item.'
      using errcode = '22023';
  end if;
  if p_qty > v_have then
    raise exception 'Only % are in that bin.', v_have
      using errcode = '22023';
  end if;

  select coalesce(sum(qty_picked), 0) into v_picked
  from public.so_picks
  where pick_list_id = v_list
    and allocation_id = p_allocation;
  if v_picked + p_qty > v_ordered then
    raise exception 'Only % still to pick.', greatest(v_ordered - v_picked, 0)
      using errcode = '22023';
  end if;

  v_project := nullif(btrim(coalesce(v_project, '')), '');
  v_ownership := public.so_pick_ownership(v_project, v_raw_ownership);
  select staging_bin_id, so_number into v_stage, v_number
  from public.sales_orders
  where id = p_order;
  select reference into v_from_ref from public.bins where id = p_from;

  perform public.adjust_bin_cycle_qty(v_source_cycle, p_from, v_item, -p_qty);

  if v_stage is null then
    v_to_ref := format('staging bin SO%s', v_number);
    v_target := null;
    v_target_cycle := null;
  else
    v_target := public.so_pick_target_bin(p_order, v_project, v_ownership, v_initials);
    perform public.lock_bins(array[p_from, v_target]);
    v_target_cycle := public.so_pick_open_cycle(v_target, v_project, v_ownership, v_initials);

    select project, ownership into v_got_project, v_got_ownership
    from public.bin_cycles
    where id = v_target_cycle;
    if v_got_project is distinct from v_project or v_got_ownership is distinct from v_ownership then
      raise exception 'Staging lost the project on this stock.'
        using errcode = '55000';
    end if;

    perform public.adjust_bin_cycle_qty(v_target_cycle, v_target, v_item, p_qty);
    select reference into v_to_ref from public.bins where id = v_target;
  end if;

  insert into public.inventory_movements (
    item_id, bin_id, direction, qty, ownership, stock_status, transfer_id,
    ref_type, ref_id, ref_label, operator_id, operator_label, occurred_at, notes, reason
  ) values (
    v_item, p_from, 'out', p_qty, v_ownership, 'available', v_transfer,
    'sales_order', p_order, 'SO' || v_number::text, v_operator, v_initials, now(),
    v_project, 'sales order pick'
  )
  returning id into v_out;

  insert into public.inventory_movements (
    item_id, bin_id, direction, qty, ownership, stock_status, transfer_id,
    ref_type, ref_id, ref_label, source_movement_id, operator_id, operator_label,
    occurred_at, notes, reason
  ) values (
    v_item, v_target, 'in', p_qty, v_ownership, 'available', v_transfer,
    'sales_order', p_order, 'SO' || v_number::text, v_out, v_operator, v_initials, now(),
    v_project, 'sales order pick'
  )
  returning id into v_in;

  insert into public.so_picks (
    pick_list_id, allocation_id, item_id, from_bin_id, to_bin_id,
    qty_asked, qty_picked, short, transfer_id, project, ownership,
    operator_id, operator_label, picked_at, client_request_id
  ) values (
    v_list, p_allocation, v_item, p_from, v_target,
    p_qty, p_qty, false, v_transfer, v_project, v_ownership,
    v_operator, v_initials, now(), v_request
  )
  returning id into v_pick;

  if v_target is null then
    perform public.issue_picked_units(v_source_cycle, v_item, v_pick, v_out, v_in);
  else
    perform public.relocate_stock_units(
      v_source_cycle, p_from, v_target_cycle, v_target, v_item, p_qty, v_pick, v_out, v_in
    );
  end if;

  if v_picked + p_qty >= v_ordered then
    update public.so_picks
    set short = false
    where pick_list_id = v_list
      and allocation_id = p_allocation;
  end if;

  return public.sales_order_pick_sheet(p_order);
end;
$$;

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

  if coalesce(v_qty, 0) < 1 or v_from is null then
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

create or replace function public.assign_pick_staging_bin(
  p_order uuid,
  p_reference text,
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
  v_ref text := upper(btrim(coalesce(p_reference, '')));
  v_status text;
  v_number bigint;
  v_current uuid;
  v_list uuid;
  v_list_status text;
  v_bin uuid;
  v_other bigint;
  r record;
  v_cycle uuid;
  v_transfer uuid;
  v_out uuid;
  v_in uuid;
begin
  if v_ref !~ '^[0-9]{5}-[BCP]$' then
    raise exception 'A bin code is five digits, a hyphen, and B, C, or P.'
      using errcode = '22023';
  end if;

  select status, so_number, staging_bin_id
  into v_status, v_number, v_current
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

  select id into v_bin from public.bins where reference = v_ref;
  if v_bin is null then
    raise exception 'No bin with that code.'
      using errcode = 'P0002';
  end if;

  select so_number into v_other
  from public.sales_orders
  where staging_bin_id = v_bin
    and id <> p_order
  limit 1;
  if v_other is not null then
    raise exception 'That bin is already the staging bin for SO%.', v_other
      using errcode = '22023';
  end if;

  select id, status into v_list, v_list_status
  from public.so_pick_lists
  where sales_order_id = p_order
    and status <> 'cancelled'
  order by created_at desc
  limit 1
  for update;

  if v_list is null or v_list_status is distinct from 'open' then
    raise exception 'Open the pick sheet before choosing a staging bin.'
      using errcode = '22023';
  end if;

  if v_current is not null and v_current <> v_bin and exists (
    select 1
    from public.so_picks
    where pick_list_id = v_list
      and qty_picked > 0
      and to_bin_id is not null
  ) then
    raise exception 'Undo the picks before changing the staging bin.'
      using errcode = '22023';
  end if;

  if v_current is not distinct from v_bin then
    return public.sales_order_pick_sheet(p_order);
  end if;

  for r in
    select id, item_id, qty_picked, project, ownership
    from public.so_picks
    where pick_list_id = v_list
      and qty_picked > 0
      and to_bin_id is null
    order by picked_at nulls last, id
    for update
  loop
    if r.qty_picked <> trunc(r.qty_picked) then
      raise exception 'That pick is not a whole number.'
        using errcode = '22023';
    end if;
    v_cycle := public.so_pick_open_cycle(v_bin, r.project, r.ownership, v_initials);
    perform public.adjust_bin_cycle_qty(v_cycle, v_bin, r.item_id, r.qty_picked::integer);
    v_transfer := gen_random_uuid();

    insert into public.inventory_movements (
      item_id, bin_id, direction, qty, ownership, transfer_id, ref_type, ref_id, ref_label,
      operator_id, operator_label, notes, reason
    ) values (
      r.item_id, null, 'out', r.qty_picked, public.so_pick_ownership(r.project, r.ownership),
      v_transfer, 'sales_order', p_order, 'SO' || v_number::text,
      v_operator, v_initials, nullif(btrim(coalesce(r.project, '')), ''),
      'assign staging bin'
    )
    returning id into v_out;

    insert into public.inventory_movements (
      item_id, bin_id, direction, qty, ownership, transfer_id, ref_type, ref_id, ref_label,
      source_movement_id, operator_id, operator_label, notes, reason
    ) values (
      r.item_id, v_bin, 'in', r.qty_picked, public.so_pick_ownership(r.project, r.ownership),
      v_transfer, 'sales_order', p_order, 'SO' || v_number::text, v_out,
      v_operator, v_initials, nullif(btrim(coalesce(r.project, '')), ''),
      'assign staging bin'
    )
    returning id into v_in;

    update public.stock_units
    set status = 'in_stock',
        bin_id = v_bin,
        cycle_id = v_cycle,
        updated_at = now()
    where pick_id = r.id
      and status = 'issued';

    perform public.link_movement_units(
      v_out,
      v_in,
      (
        select coalesce(array_agg(id), '{}')
        from public.stock_units
        where pick_id = r.id
          and bin_id = v_bin
      )
    );

    update public.so_picks
    set to_bin_id = v_bin
    where id = r.id;
  end loop;

  update public.sales_orders
  set staging_bin_id = v_bin,
      updated_at = now()
  where id = p_order;

  update public.so_pick_lists
  set staging_bin_id = v_bin
  where id = v_list;

  perform public.log_so_event(
    p_order,
    'staging_bin',
    v_status,
    v_status,
    format('staging bin SO%s → %s', v_number, v_ref),
    v_operator,
    v_initials
  );

  return public.sales_order_pick_sheet(p_order);
end;
$$;

comment on function public.assign_pick_staging_bin(uuid, text, text, uuid) is
  'Uses an existing bin as the staging bin for this pick. Does not create a bin. Picks that were on the staging label move into that bin.';

comment on function public.so_pick_target_bin(uuid, text, text, text) is
  'Staging bin for this pick when one was scanned. Does not create a bin. A second project needs another scanned bin.';

comment on function public.pick_sales_order_line(uuid, uuid, uuid, integer, text, uuid, text, uuid, text) is
  'Moves a quantity of the fulfilled SKU out of a stock bin. With no scanned staging bin the label is staging bin SO plus the number and no warehouse bin is created. With a scanned bin, the quantity moves into that bin. One request id picks once.';

comment on function public.undo_sales_order_pick(uuid, text, uuid) is
  'Moves a pick back to its source bin. A pick that used the staging label has no warehouse bin to empty.';

revoke all on function public.issue_picked_units(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.assign_pick_staging_bin(uuid, text, text, uuid) from public, anon, authenticated;

grant execute on function public.issue_picked_units(uuid, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.assign_pick_staging_bin(uuid, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
