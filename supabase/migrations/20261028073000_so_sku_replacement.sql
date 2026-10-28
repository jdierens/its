-- Sales-order SKU replacement.
-- so_line_allocations.item_id stays the planned SKU. actual_item_id is the
-- SKU that ships when it differs, the same planned/actual split kit
-- components already use. Stock, stock units, and the pick row use the
-- fulfilled SKU. A missing actual means the planned SKU.
-- allow_replacement_sku_during_pick in app_settings gates a change made
-- on the pick sheet. It defaults to false. Approval can still set the
-- fulfilled SKU while the setting is off.
-- Service lines, and a non-freight line whose item type is Service, are
-- left off the pick sheet. Freight stays in the not-picked note, including
-- freight on service item 4343.
-- Apply by hand after supabase/migrations/20261027230000_stock_units.sql
-- and supabase/migrations/20261024100000_kits.sql (items.is_generic).
-- Deploying does not run this file.

alter table public.so_line_allocations
  add column if not exists actual_item_id uuid,
  add column if not exists swap_reason text,
  add column if not exists swapped_at timestamptz,
  add column if not exists swapped_by uuid;

alter table public.so_line_allocations
  drop constraint if exists so_line_allocations_actual_item_id_fkey;

alter table public.so_line_allocations
  add constraint so_line_allocations_actual_item_id_fkey
  foreign key (actual_item_id) references public.items (id);

comment on column public.so_line_allocations.item_id is
  'Planned SKU for this allocation. A product line requires it. A replacement does not change it; actual_item_id is the fulfilled SKU when they differ.';

comment on column public.so_line_allocations.actual_item_id is
  'Fulfilled SKU when it differs from item_id. Null means pick and ship the planned SKU. Stock movements use this item.';

comment on column public.so_line_allocations.swap_reason is
  'Why the fulfilled SKU differs from the planned SKU. Null when they are the same.';

create index if not exists so_line_allocations_actual_item_idx
  on public.so_line_allocations (actual_item_id)
  where actual_item_id is not null;

insert into public.app_settings (key, value)
values ('allow_replacement_sku_during_pick', 'false')
on conflict (key) do nothing;

comment on table public.app_settings is
  'App key/value settings. Not credentials. allow_replacement_sku_during_pick is false until an admin turns it on. Approval can still record a fulfilled SKU while it is off.';

create or replace function public.so_pick_replacement_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select lower(btrim(value)) in ('true', '1', 'yes', 'on')
    from public.app_settings
    where key = 'allow_replacement_sku_during_pick'
  ), false);
$$;

comment on function public.so_pick_replacement_allowed() is
  'True only when allow_replacement_sku_during_pick is true, 1, yes, or on. A missing row is false.';

create or replace function public.so_pick_sheet_place(p_kind text, p_item_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('product', 'kit') and p_item_type in ('Product', 'Kit/Package') then 'pick'
    when p_kind = 'service' then 'omit'
    when p_item_type = 'Service' and p_kind is distinct from 'freight' then 'omit'
    else 'note'
  end;
$$;

comment on function public.so_pick_sheet_place(text, text) is
  'pick for a product or kit stock line. omit for a service line and for a non-freight Service item. note for freight, fees, and other lines that stay on the not-picked list. Freight on service item 4343 stays a note.';

create or replace function public.so_check_replacement_item(p_planned uuid, p_actual uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_generic boolean;
begin
  if p_actual is null or p_actual = p_planned then
    return;
  end if;
  select item_type, coalesce(is_generic, false)
  into v_type, v_generic
  from public.items
  where id = p_actual;
  if v_type is null then
    raise exception 'That part does not exist.'
      using errcode = '22023';
  end if;
  if v_type is distinct from 'Product' then
    raise exception 'Replace with a product SKU.'
      using errcode = '22023';
  end if;
  if v_generic then
    raise exception 'A generic part cannot be the replacement.'
      using errcode = '22023';
  end if;
end;
$$;

comment on function public.so_check_replacement_item(uuid, uuid) is
  'A fulfilled SKU is a non-generic product. Service, kit, and non-inventory items are rejected. The planned SKU is unchanged.';

create or replace function public.set_so_allocation_replacement(
  p_allocation uuid,
  p_actual uuid,
  p_reason text,
  p_initials text,
  p_operator uuid,
  p_context text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
  v_order uuid;
  v_kind text;
  v_status text;
  v_planned uuid;
  v_actual uuid;
  v_planned_type text;
  v_planned_sku text;
  v_next uuid;
  v_next_sku text;
  v_reason text := public.blank_to_null(p_reason);
  v_note text;
begin
  if p_context not in ('approval', 'pick') then
    raise exception 'Choose approval or pick.'
      using errcode = '22023';
  end if;

  select l.sales_order_id, l.line_kind, o.status, a.item_id, a.actual_item_id, i.item_type, i.sku
  into v_order, v_kind, v_status, v_planned, v_actual, v_planned_type, v_planned_sku
  from public.so_line_allocations a
  join public.so_lines l on l.id = a.so_line_id
  join public.sales_orders o on o.id = l.sales_order_id
  join public.items i on i.id = a.item_id
  where a.id = p_allocation
  for update of a;

  if v_order is null then
    raise exception 'That line was not found.'
      using errcode = 'P0002';
  end if;
  if v_status not in ('draft', 'approved', 'picking') then
    raise exception 'That sales order can no longer be edited.'
      using errcode = '22023';
  end if;
  if p_context = 'pick' and v_status not in ('approved', 'picking') then
    raise exception 'Start from an approved sales order.'
      using errcode = '22023';
  end if;
  if public.so_pick_sheet_place(v_kind, v_planned_type) is distinct from 'pick' then
    raise exception 'That line is not picked.'
      using errcode = '22023';
  end if;

  v_next := p_actual;
  if v_next is not distinct from v_planned then
    v_next := null;
  end if;
  if v_next is not distinct from v_actual then
    return public.sales_order_pick_sheet(v_order);
  end if;
  if p_context = 'pick' and not public.so_pick_replacement_allowed() then
    raise exception 'Replacement SKU during pick is off.'
      using errcode = '22023';
  end if;
  if coalesce((
    select sum(qty_picked)
    from public.so_picks
    where allocation_id = p_allocation
  ), 0) > 0 then
    raise exception 'Undo the pick before changing the SKU.'
      using errcode = '22023';
  end if;
  if v_next is not null then
    perform public.so_check_replacement_item(v_planned, v_next);
    if v_reason is null then
      raise exception 'Enter a reason for the replacement.'
        using errcode = '22023';
    end if;
    select sku into v_next_sku from public.items where id = v_next;
    v_note := format('%s → %s. %s', v_planned_sku, v_next_sku, v_reason);
  else
    v_note := format('Fulfill %s.', v_planned_sku);
  end if;

  update public.so_line_allocations
  set actual_item_id = v_next,
      swap_reason = case when v_next is null then null else v_reason end,
      swapped_at = case when v_next is null then null else now() end,
      swapped_by = case when v_next is null then null else v_operator end
  where id = p_allocation;

  perform public.log_so_event(
    v_order,
    'sku_replaced',
    v_status,
    v_status,
    v_note,
    v_operator,
    v_initials
  );

  return public.sales_order_pick_sheet(v_order);
end;
$$;

comment on function public.set_so_allocation_replacement(uuid, uuid, text, text, uuid, text) is
  'Sets or clears the fulfilled SKU on one allocation. item_id stays the planned SKU. Pick context requires allow_replacement_sku_during_pick. Approval does not. A pick already recorded on the line must be undone first. Writes so_events sku_replaced.';


create or replace function public.so_pick_finish_block(p_list uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_picked numeric;
  v_label text;
begin
  if p_list is null then
    return 'Open the pick sheet before finishing.';
  end if;

  if exists (
    select 1
    from public.so_picks
    where pick_list_id = p_list
      and allocation_id is null
      and qty_picked > 0
  ) then
    return 'A pick is no longer on a line. Undo it before finishing.';
  end if;

  for r in
    select a.id, a.qty, l.line_no, coalesce(actual.sku, i.sku) as sku
    from public.so_pick_lists pl
    join public.so_lines l on l.sales_order_id = pl.sales_order_id
    join public.so_line_allocations a on a.so_line_id = l.id
    join public.items i on i.id = a.item_id
    left join public.items actual on actual.id = a.actual_item_id
    where pl.id = p_list
      and public.so_pick_sheet_place(l.line_kind, i.item_type) = 'pick'
    order by l.line_no, a.alloc_no
  loop
    select coalesce(sum(qty_picked), 0) into v_picked
    from public.so_picks
    where pick_list_id = p_list
      and allocation_id = r.id;

    v_label := format('Line %s %s', r.line_no, r.sku);
    if v_picked > r.qty then
      return v_label || ' has more picked than ordered.';
    end if;
    if v_picked < r.qty and not exists (
      select 1
      from public.so_picks
      where pick_list_id = p_list
        and allocation_id = r.id
        and short
    ) then
      return v_label || ' is short. Acknowledge the short before finishing.';
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.sales_order_pick_sheet(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.sales_orders;
  v_customer text;
  v_list_id uuid;
  v_pick_status text;
  v_staging text;
  v_lines jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_staging_stock jsonb := '[]'::jsonb;
  v_orphans jsonb := '[]'::jsonb;
  v_handoff text;
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

  select id, status into v_list_id, v_pick_status
  from public.so_pick_lists
  where sales_order_id = p_order
    and status <> 'cancelled'
  order by created_at desc
  limit 1;

  if v_order.staging_bin_id is not null then
    select reference into v_staging from public.bins where id = v_order.staging_bin_id;
  end if;

  for r in
    select
      a.id as allocation_id,
      a.item_id as planned_item_id,
      coalesce(a.actual_item_id, a.item_id) as fulfill_id,
      a.qty as ordered,
      l.line_no,
      coalesce(actual.sku, i.sku) as sku,
      coalesce(actual.name, i.name) as name,
      i.sku as planned_sku,
      i.name as planned_name,
      (a.actual_item_id is not null and a.actual_item_id is distinct from a.item_id) as replaced,
      a.swap_reason,
      coalesce(actual.coo, i.coo) as item_coo
    from public.so_lines l
    join public.so_line_allocations a on a.so_line_id = l.id
    join public.items i on i.id = a.item_id
    left join public.items actual on actual.id = a.actual_item_id
    where l.sales_order_id = p_order
      and public.so_pick_sheet_place(l.line_kind, i.item_type) = 'pick'
    order by l.line_no, a.alloc_no
  loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'allocation_id', r.allocation_id,
      'planned_item_id', r.planned_item_id,
      'line_no', r.line_no,
      'sku', r.sku,
      'name', r.name,
      'planned_sku', r.planned_sku,
      'planned_name', r.planned_name,
      'replaced', r.replaced,
      'swap_reason', r.swap_reason,
      'item_coo', r.item_coo,
      'ordered', r.ordered,
      'picked', coalesce((
        select sum(p.qty_picked)
        from public.so_picks p
        where p.pick_list_id = v_list_id
          and p.allocation_id = r.allocation_id
      ), 0),
      'short', exists (
        select 1
        from public.so_picks p
        where p.pick_list_id = v_list_id
          and p.allocation_id = r.allocation_id
          and p.short
      ),
      'bins', coalesce((
        select jsonb_agg(jsonb_build_object(
          'bin_id', b.id,
          'reference', b.reference,
          'location', loc.code,
          'qty', contents.qty,
          'project', cycle.project,
          'ownership', public.so_pick_ownership(cycle.project, cycle.ownership)
        ) order by b.reference)
        from public.bin_contents contents
        join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
        join public.bins b on b.id = contents.bin_id
        left join public.locations loc on loc.id = b.current_location_id
        where contents.item_id = r.fulfill_id
          and contents.qty > 0
          and not exists (
            select 1
            from public.sales_orders staged
            where staged.staging_bin_id = b.id
               or staged.staging_bin_id = b.parent_bin_id
          )
      ), '[]'::jsonb),
      'picks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'from_bin', fb.reference,
          'qty', p.qty_picked,
          'project', p.project,
          'ownership', p.ownership,
          'serials', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', u.id,
              'serial', u.serial_number,
              'coo', u.country_of_origin
            ) order by u.scanned_at, u.id)
            from public.so_units u
            where u.pick_id = p.id
          ), '[]'::jsonb)
        ) order by p.picked_at nulls last, p.id)
        from public.so_picks p
        left join public.bins fb on fb.id = p.from_bin_id
        where p.pick_list_id = v_list_id
          and p.allocation_id = r.allocation_id
          and p.qty_picked > 0
      ), '[]'::jsonb)
    ));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_no', skipped.line_no,
    'sku', skipped.sku,
    'name', skipped.name,
    'reason', skipped.reason
  ) order by skipped.line_no, skipped.sku), '[]'::jsonb)
  into v_skipped
  from (
    select
      l.line_no,
      i.sku,
      coalesce(i.name, l.customer_description) as name,
      case
        when l.line_kind not in ('product', 'kit') then 'Freight, fee, and service lines are not picked.'
        when a.id is null then 'No SKU on this line.'
        else 'Not a stock item.'
      end as reason
    from public.so_lines l
    left join public.so_line_allocations a on a.so_line_id = l.id
    left join public.items i on i.id = a.item_id
    where l.sales_order_id = p_order
      and public.so_pick_sheet_place(l.line_kind, i.item_type) = 'note'
  ) skipped;

  if v_order.staging_bin_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'reference', b.reference,
      'project', cycle.project,
      'ownership', cycle.ownership,
      'qty', contents.qty,
      'sku', i.sku
    ) order by b.reference, i.sku), '[]'::jsonb)
    into v_staging_stock
    from public.bin_contents contents
    join public.bins b on b.id = contents.bin_id
    join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
    join public.items i on i.id = contents.item_id
    where b.id = v_order.staging_bin_id
       or b.parent_bin_id = v_order.staging_bin_id;
  end if;

  if v_list_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'from_bin', fb.reference,
      'qty', p.qty_picked,
      'project', p.project,
      'ownership', p.ownership,
      'sku', i.sku,
      'name', i.name,
      'serials', coalesce((
        select jsonb_agg(jsonb_build_object('id', u.id, 'serial', u.serial_number,
              'coo', u.country_of_origin) order by u.scanned_at)
        from public.so_units u
        where u.pick_id = p.id
      ), '[]'::jsonb)
    ) order by p.picked_at nulls last), '[]'::jsonb)
    into v_orphans
    from public.so_picks p
    left join public.bins fb on fb.id = p.from_bin_id
    left join public.items i on i.id = p.item_id
    where p.pick_list_id = v_list_id
      and p.allocation_id is null
      and p.qty_picked > 0;
  end if;

  v_handoff := case v_pick_status
    when 'picked' then 'Picked into the staging bin. Packing is next and is not on this screen yet.'
    when 'short' then 'Short pick is recorded. Packing is next and is not on this screen yet.'
    else null
  end;

  return jsonb_build_object(
    'order_id', v_order.id,
    'so_number', v_order.so_number,
    'status', v_order.status,
    'customer', coalesce(v_customer, ''),
    'customer_po', v_order.customer_po,
    'pick_list_id', v_list_id,
    'pick_status', v_pick_status,
    'staging_bin', v_staging,
    'staging', v_staging_stock,
    'finish_block', case
      when v_pick_status is distinct from 'open' then null
      else public.so_pick_finish_block(v_list_id)
    end,
    'handoff', v_handoff,
    'allow_replacement', public.so_pick_replacement_allowed(),
    'lines', v_lines,
    'skipped', v_skipped,
    'orphans', v_orphans
  );
end;
$$;

drop function if exists public.pick_sales_order_line(uuid, uuid, uuid, integer, text, uuid, text);

create function public.pick_sales_order_line(
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

  perform public.adjust_bin_cycle_qty(v_source_cycle, p_from, v_item, -p_qty);
  perform public.adjust_bin_cycle_qty(v_target_cycle, v_target, v_item, p_qty);

  select so_number into v_number from public.sales_orders where id = p_order;
  select reference into v_from_ref from public.bins where id = p_from;
  select reference into v_to_ref from public.bins where id = v_target;

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

  perform public.relocate_stock_units(
    v_source_cycle, p_from, v_target_cycle, v_target, v_item, p_qty, v_pick, v_out, v_in
  );

  if v_picked + p_qty >= v_ordered then
    update public.so_picks
    set short = false
    where pick_list_id = v_list
      and allocation_id = p_allocation;
  end if;

  return public.sales_order_pick_sheet(p_order);
end;
$$;

create or replace function public.promote_mapped_sales_lines(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_ids uuid[];
  v_id uuid;
  v_line public.so_lines;
  v_alloc public.so_line_allocations;
  v_new uuid;
  v_no integer := 0;
  v_price numeric;
begin
  select status into v_status from public.sales_orders where id = p_order for update;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft can be approved.'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(id order by line_no), array[]::uuid[])
  into v_ids
  from public.so_lines
  where sales_order_id = p_order;

  -- Park the draft line numbers so the new SKU lines can take 1, 2, 3.
  update public.so_lines
  set line_no = line_no + 3000000
  where sales_order_id = p_order;

  foreach v_id in array v_ids
  loop
    select * into v_line from public.so_lines where id = v_id;
    if not exists (select 1 from public.so_line_allocations where so_line_id = v_id) then
      v_no := v_no + 1;
      update public.so_lines set line_no = v_no where id = v_id;
      continue;
    end if;

    for v_alloc in
      select *
      from public.so_line_allocations
      where so_line_id = v_id
      order by alloc_no, created_at, id
    loop
      v_no := v_no + 1;
      v_price := coalesce(v_alloc.unit_price, v_line.unit_price);
      insert into public.so_lines (
        sales_order_id, line_no, line_kind, customer_part_number, customer_description,
        qty, unit_price, ext_price, condition, suggested_item_ids, eccn, hts_code, country_of_origin, line_note
      ) values (
        p_order,
        v_no,
        v_line.line_kind,
        v_line.customer_part_number,
        v_line.customer_description,
        v_alloc.qty,
        v_price,
        case when v_price is null then null else round(v_alloc.qty * v_price, 2) end,
        v_line.condition,
        v_line.suggested_item_ids,
        v_line.eccn,
        v_line.hts_code,
        v_line.country_of_origin,
        v_line.line_note
      )
      returning id into v_new;

      insert into public.so_line_allocations (
        so_line_id, item_id, qty, unit_price, ext_price, alloc_no, operator_id,
        actual_item_id, swap_reason, swapped_at, swapped_by
      ) values (
        v_new,
        v_alloc.item_id,
        v_alloc.qty,
        v_price,
        case when v_price is null then null else round(v_alloc.qty * v_price, 2) end,
        1,
        v_alloc.operator_id,
        v_alloc.actual_item_id,
        v_alloc.swap_reason,
        v_alloc.swapped_at,
        v_alloc.swapped_by
      );
    end loop;

    delete from public.so_lines where id = v_id;
  end loop;
end;
$$;

create or replace function public.relink_sales_order_picks(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pick record;
  v_alloc uuid;
begin
  for v_pick in
    select p.id, p.item_id, p.qty_picked
    from public.so_picks p
    join public.so_pick_lists pl on pl.id = p.pick_list_id
    where pl.sales_order_id = p_order
      and p.allocation_id is null
      and p.item_id is not null
    order by p.picked_at nulls last, p.id
  loop
    select a.id into v_alloc
    from public.so_line_allocations a
    join public.so_lines l on l.id = a.so_line_id
    where l.sales_order_id = p_order
      and coalesce(a.actual_item_id, a.item_id) = v_pick.item_id
      and (
        select coalesce(sum(linked.qty_picked), 0)
        from public.so_picks linked
        where linked.allocation_id = a.id
      ) + v_pick.qty_picked <= a.qty
    order by l.line_no, a.alloc_no
    limit 1;
    if v_alloc is not null then
      update public.so_picks set allocation_id = v_alloc where id = v_pick.id;
    end if;
  end loop;
end;
$$;

create or replace function public.write_sales_order(
  p_payload jsonb,
  p_initials text,
  p_operator_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator_id);
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_status text;
  v_number bigint;
  v_customer uuid := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_event text;
  v_from text;
  line jsonb;
  alloc jsonb;
  note jsonb;
  n integer := 0;
  v_line uuid;
  v_qty numeric;
  v_price numeric;
  v_kind text;
  v_alloc_n integer;
  v_alloc_qty numeric;
  v_alloc_price numeric;
  v_channel text := public.blank_to_null(p_payload ->> 'channel');
  v_method text := public.blank_to_null(p_payload ->> 'payment_method');
  v_paid date;
  v_txn numeric;
  v_label_fee numeric;
  v_ad numeric;
  v_earnings numeric;
  v_payment numeric;
  v_actual uuid;
  v_swap_reason text;
  v_planned_type text;
begin
  if v_customer is null or not exists (select 1 from public.customers where id = v_customer) then
    raise exception 'Choose a customer.'
      using errcode = '22023';
  end if;
  if v_channel is not null and not exists (select 1 from public.so_channels where code = v_channel) then
    raise exception 'Choose a channel.'
      using errcode = '22023';
  end if;
  if v_method is not null and not exists (select 1 from public.so_payment_methods where code = v_method) then
    raise exception 'Choose a payment method.'
      using errcode = '22023';
  end if;
  begin
    v_paid := nullif(p_payload ->> 'payment_date', '')::date;
    v_txn := public.so_optional_money(p_payload ->> 'ebay_transaction_fee');
    v_label_fee := public.so_optional_money(p_payload ->> 'ebay_label_fee');
    v_ad := public.so_optional_money(p_payload ->> 'ebay_ad_fee');
    v_earnings := public.so_optional_money(p_payload ->> 'ebay_order_earnings');
    v_payment := public.so_optional_money(p_payload ->> 'payment_amount');
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Enter a payment date.'
        using errcode = '22023';
  end;
  if v_payment is not null and v_payment < 0 then
    raise exception 'Enter a payment amount.'
      using errcode = '22023';
  end if;
  if public.blank_to_null(upper(btrim(coalesce(p_payload ->> 'sales_rep', '')))) is not null
    and upper(btrim(p_payload ->> 'sales_rep')) !~ '^[A-Z]{2}$'
  then
    raise exception 'Sales rep initials are 2 letters.'
      using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.sales_orders (
      status, customer_id, customer_po, reference, order_date, ship_date,
      bill_to, ship_to, terms, incoterms, ship_method, carrier_account,
      currency, sales_rep, export_notes, internal_notes, source, channel,
      legacy_journal_ref, sheet_ref, payment_requirement, payment_method, payment_date, payment_ref, payment_amount,
      ebay_transaction_fee, ebay_label_fee, ebay_ad_fee, ebay_order_earnings, operator_id
    ) values (
      'draft',
      v_customer,
      public.blank_to_null(p_payload ->> 'customer_po'),
      public.blank_to_null(p_payload ->> 'reference'),
      nullif(p_payload ->> 'order_date', '')::date,
      nullif(p_payload ->> 'ship_date', '')::date,
      p_payload -> 'bill_to',
      p_payload -> 'ship_to',
      public.blank_to_null(p_payload ->> 'terms'),
      public.blank_to_null(p_payload ->> 'incoterms'),
      public.blank_to_null(p_payload ->> 'ship_method'),
      public.blank_to_null(p_payload ->> 'carrier_account'),
      coalesce(nullif(upper(btrim(coalesce(p_payload ->> 'currency', ''))), ''), 'USD'),
      public.blank_to_null(upper(btrim(coalesce(p_payload ->> 'sales_rep', '')))),
      public.blank_to_null(p_payload ->> 'export_notes'),
      public.blank_to_null(p_payload ->> 'internal_notes'),
      coalesce(public.blank_to_null(p_payload ->> 'source'), 'manual'),
      v_channel,
      case when p_payload ? 'legacy_journal_ref' then public.blank_to_null(p_payload ->> 'legacy_journal_ref') else null end,
      case when p_payload ? 'sheet_ref' then public.blank_to_null(p_payload ->> 'sheet_ref') else null end,
      coalesce(public.blank_to_null(p_payload ->> 'payment_requirement'), 'terms'),
      v_method,
      v_paid,
      public.blank_to_null(p_payload ->> 'payment_ref'),
      v_payment,
      v_txn,
      v_label_fee,
      v_ad,
      v_earnings,
      v_operator
    )
    returning id, status into v_id, v_status;
    v_event := 'created';
    v_from := null;
  else
    select status, so_number into v_status, v_number
    from public.sales_orders where id = v_id for update;
    if v_status is null then
      raise exception 'Sales order not found.'
        using errcode = 'P0002';
    end if;
    if v_status not in ('draft', 'approved', 'picking') then
      raise exception 'That sales order can no longer be edited.'
        using errcode = '22023';
    end if;
    update public.sales_orders set
      customer_id = v_customer,
      customer_po = public.blank_to_null(p_payload ->> 'customer_po'),
      reference = public.blank_to_null(p_payload ->> 'reference'),
      order_date = nullif(p_payload ->> 'order_date', '')::date,
      ship_date = nullif(p_payload ->> 'ship_date', '')::date,
      bill_to = p_payload -> 'bill_to',
      ship_to = p_payload -> 'ship_to',
      terms = public.blank_to_null(p_payload ->> 'terms'),
      incoterms = public.blank_to_null(p_payload ->> 'incoterms'),
      ship_method = public.blank_to_null(p_payload ->> 'ship_method'),
      carrier_account = public.blank_to_null(p_payload ->> 'carrier_account'),
      currency = coalesce(nullif(upper(btrim(coalesce(p_payload ->> 'currency', ''))), ''), 'USD'),
      sales_rep = public.blank_to_null(upper(btrim(coalesce(p_payload ->> 'sales_rep', '')))),
      export_notes = public.blank_to_null(p_payload ->> 'export_notes'),
      internal_notes = public.blank_to_null(p_payload ->> 'internal_notes'),
      channel = v_channel,
      legacy_journal_ref = case
        when p_payload ? 'legacy_journal_ref' then public.blank_to_null(p_payload ->> 'legacy_journal_ref')
        else legacy_journal_ref
      end,
      sheet_ref = case
        when p_payload ? 'sheet_ref' then public.blank_to_null(p_payload ->> 'sheet_ref')
        else sheet_ref
      end,
      payment_requirement = coalesce(public.blank_to_null(p_payload ->> 'payment_requirement'), 'terms'),
      payment_method = v_method,
      payment_date = v_paid,
      payment_ref = public.blank_to_null(p_payload ->> 'payment_ref'),
      payment_amount = v_payment,
      ebay_transaction_fee = v_txn,
      ebay_label_fee = v_label_fee,
      ebay_ad_fee = v_ad,
      ebay_order_earnings = v_earnings,
      operator_id = v_operator,
      updated_at = now()
    where id = v_id;
    delete from public.so_lines where sales_order_id = v_id;
    delete from public.so_customer_notes where sales_order_id = v_id;
    v_event := 'updated';
    v_from := v_status;
  end if;

  for line in
    select value from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb))
  loop
    n := n + 1;
    v_qty := nullif(line ->> 'qty', '')::numeric;
    v_price := nullif(line ->> 'unit_price', '')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Enter a quantity above 0.'
        using errcode = '22023';
    end if;
    v_kind := coalesce(public.blank_to_null(line ->> 'line_kind'), 'product');
    if v_kind not in ('product', 'kit', 'freight', 'fee', 'service', 'discount', 'other') then
      raise exception 'Choose a line kind.'
        using errcode = '22023';
    end if;
    insert into public.so_lines (
      sales_order_id, line_no, line_kind, customer_part_number, customer_description,
      qty, unit_price, ext_price, condition, eccn, hts_code, country_of_origin, line_note
    ) values (
      v_id,
      n,
      v_kind,
      public.blank_to_null(line ->> 'customer_part_number'),
      public.blank_to_null(line ->> 'customer_description'),
      v_qty,
      v_price,
      case when v_price is null then null else round(v_qty * v_price, 2) end,
      public.blank_to_null(line ->> 'condition'),
      public.blank_to_null(line ->> 'eccn'),
      public.blank_to_null(line ->> 'hts_code'),
      public.blank_to_null(line ->> 'country_of_origin'),
      public.blank_to_null(line ->> 'line_note')
    )
    returning id into v_line;

    v_alloc_n := 0;
    for alloc in
      select value from jsonb_array_elements(coalesce(line -> 'allocations', '[]'::jsonb))
    loop
      if nullif(alloc ->> 'item_id', '') is null then
        continue;
      end if;
      v_alloc_n := v_alloc_n + 1;
      v_alloc_qty := nullif(alloc ->> 'qty', '')::numeric;
      v_alloc_price := nullif(alloc ->> 'unit_price', '')::numeric;
      if v_alloc_qty is null or v_alloc_qty <= 0 then
        raise exception 'Enter a quantity above 0.'
          using errcode = '22023';
      end if;
      if v_alloc_price is not null and v_alloc_price < 0 then
        raise exception 'Enter a unit price.'
          using errcode = '22023';
      end if;
      v_actual := nullif(alloc ->> 'actual_item_id', '')::uuid;
      v_swap_reason := public.blank_to_null(alloc ->> 'swap_reason');
      if v_actual is not distinct from (alloc ->> 'item_id')::uuid then
        v_actual := null;
        v_swap_reason := null;
      end if;
      if v_actual is not null then
        select item_type into v_planned_type from public.items where id = (alloc ->> 'item_id')::uuid;
        if public.so_pick_sheet_place(v_kind, v_planned_type) is distinct from 'pick' then
          raise exception 'That line is not picked.'
            using errcode = '22023';
        end if;
        perform public.so_check_replacement_item((alloc ->> 'item_id')::uuid, v_actual);
        if v_swap_reason is null then
          raise exception 'Enter a reason for the replacement.'
            using errcode = '22023';
        end if;
      end if;
      insert into public.so_line_allocations (
        so_line_id, item_id, qty, unit_price, ext_price, alloc_no, operator_id,
        actual_item_id, swap_reason, swapped_at, swapped_by
      ) values (
        v_line,
        (alloc ->> 'item_id')::uuid,
        v_alloc_qty,
        v_alloc_price,
        case when v_alloc_price is null then null else round(v_alloc_qty * v_alloc_price, 2) end,
        coalesce(nullif(alloc ->> 'alloc_no', '')::integer, v_alloc_n),
        v_operator,
        v_actual,
        case when v_actual is null then null else v_swap_reason end,
        case when v_actual is null then null else now() end,
        case when v_actual is null then null else v_operator end
      );
    end loop;
  end loop;

  for note in
    select value from jsonb_array_elements(coalesce(p_payload -> 'notes', '[]'::jsonb))
  loop
    if public.blank_to_null(note ->> 'customer_text') is null then
      continue;
    end if;
    insert into public.so_customer_notes (
      sales_order_id, customer_id, kind, customer_text, response, counter_text, operator_id
    ) values (
      v_id,
      v_customer,
      coalesce(public.blank_to_null(note ->> 'kind'), 'other'),
      note ->> 'customer_text',
      public.blank_to_null(note ->> 'response'),
      public.blank_to_null(note ->> 'counter_text'),
      v_operator
    );
  end loop;

  perform public.relink_sales_order_picks(v_id);

  perform public.log_so_event(v_id, v_event, v_from, v_status, null, v_operator, v_label);

  return jsonb_build_object('id', v_id, 'status', v_status, 'so_number', v_number);
end;
$$;

comment on function public.sales_order_pick_sheet(uuid) is
  'Pick sheet for one sales order. No prices. Product and kit lines only. Service lines are omitted. Freight stays in the not-picked note. Bins and the shown SKU are the fulfilled item when a replacement is set.';

comment on function public.pick_sales_order_line(uuid, uuid, uuid, integer, text, uuid, text, uuid, text) is
  'Moves a whole quantity of the fulfilled SKU from one stock bin into the order staging bin. A replacement argument is rejected while allow_replacement_sku_during_pick is off. Omitting it picks the SKU already stored, including one chosen at approval. Stock units move with that SKU. One request id picks once.';

comment on function public.promote_mapped_sales_lines(uuid) is
  'Draft only. Replaces each customer line that has mapped SKUs with one sales-order line per SKU. Quantity, unit price, extension, and a fulfilled SKU are copied from the allocation. The planned item_id is unchanged. The line note is copied onto each of those lines.';

comment on function public.write_sales_order(jsonb, text, uuid) is
  'Inserts a draft, or replaces a draft, an approved order, or an order that is being picked. An approved order stays approved. A picking order stays picking. Both keep so_number. Cancelled, closed, and every other status are rejected. Replaces lines, allocations, and customer notes, then relinks picks onto the fulfilled SKU. Stores a replacement on the allocation when actual_item_id differs from item_id. Does not assign so_number.';

comment on function public.relink_sales_order_picks(uuid) is
  'After a sales-order save replaces lines, attach picks that lost their allocation to the fulfilled SKU when the ordered quantity still covers them.';

revoke all on function public.so_pick_replacement_allowed() from public, anon, authenticated;
revoke all on function public.so_pick_sheet_place(text, text) from public, anon, authenticated;
revoke all on function public.so_check_replacement_item(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_so_allocation_replacement(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.pick_sales_order_line(uuid, uuid, uuid, integer, text, uuid, text, uuid, text) from public, anon, authenticated;

grant execute on function public.so_pick_replacement_allowed() to service_role;
grant execute on function public.so_pick_sheet_place(text, text) to service_role;
grant execute on function public.so_check_replacement_item(uuid, uuid) to service_role;
grant execute on function public.set_so_allocation_replacement(uuid, uuid, text, text, uuid, text) to service_role;
grant execute on function public.pick_sales_order_line(uuid, uuid, uuid, integer, text, uuid, text, uuid, text) to service_role;

notify pgrst, 'reload schema';
