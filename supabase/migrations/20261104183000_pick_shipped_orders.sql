-- Pick, and list for pack, a sales order that already shipped.
-- Historic eBay orders are status shipped or partially_shipped. ship_date is
-- set, shipment rows already exist, and many of those orders never had a
-- warehouse pick or a packed_at.
--
-- Opening a pick on those statuses creates the pick list and does not change
-- status. Bins, quantities, shorts, and serials go through the same functions
-- as a pick that has not shipped. The inventory movement stays that path:
-- quantity leaves the source bin, then it is issued on the staging label or
-- moved into a scanned staging bin. Finish closes the pick list only.
-- Nothing in this file assigns ship_date or changes public.so_shipments.
-- eBay shipment import does not post inventory. Picking does, including this
-- catch-up, and that posting does not rewrite the ship record.
--
-- Packing a shipped order while packed_at is null was already allowed.
-- This adds that order to the pack queue once the pick is finished.
-- Finish pack still leaves the order shipped.
--
-- Cancelled, invoiced, closed, packed, and packing do not start a new pick.
-- Apply by hand on project fxsbpreasbdalwthyzvk after
-- supabase/migrations/20261102143000_pack_shipped_orders.sql.
-- Deploying does not run this file.

create or replace function public.so_picking_writable(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('approved', 'picking', 'shipped', 'partially_shipped');
$$;

comment on function public.so_picking_writable(text) is
  'True when a pick can be opened or saved: approved, picking, shipped, or partially shipped. Cancelled, invoiced, closed, packed, and packing stay false. Shipped status itself is not a finished pick.';

revoke all on function public.so_picking_writable(text) from public, anon, authenticated;

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
  if not public.so_picking_writable(v_status) then
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

  -- shipped catch-up open: record the pick list and leave status, ship_date, and shipments alone.
  if v_status in ('shipped', 'partially_shipped') then
    perform public.log_so_event(
      p_order,
      'picking_started',
      v_status,
      v_status,
      format('Picking after shipping. Status stays %s. staging bin SO%s', v_status, v_number),
      v_operator,
      v_initials
    );
  else
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
  end if;

  return public.sales_order_pick_sheet(p_order);
end;
$$;

comment on function public.open_sales_order_pick(uuid, text, uuid) is
  'Opens the pick sheet. An approved order becomes picking. A picking order stays picking. A shipped or partially shipped order stays that status and can record the pick that was missed. Does not create a bin. Opening it again returns the same sheet. Cancelled, invoiced, closed, packed, and packing are refused.';

create or replace function public.finish_sales_order_pick(
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
  v_list uuid;
  v_block text;
  v_short boolean;
  v_status text;
  v_order_status text;
begin
  select status into v_order_status
  from public.sales_orders
  where id = p_order
  for update;

  select id into v_list
  from public.so_pick_lists
  where sales_order_id = p_order
    and status = 'open'
  for update;
  if v_list is null then
    raise exception 'Open the pick sheet before finishing.'
      using errcode = '22023';
  end if;

  v_block := public.so_pick_finish_block(v_list);
  if v_block is not null then
    raise exception '%', v_block
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

  select exists (
    select 1
    from public.so_lines l
    join public.so_line_allocations a on a.so_line_id = l.id
    join public.items i on i.id = a.item_id
    where l.sales_order_id = p_order
      and l.line_kind in ('product', 'kit')
      and i.item_type in ('Product', 'Kit/Package')
      and (
        select coalesce(sum(p.qty_picked), 0)
        from public.so_picks p
        where p.pick_list_id = v_list
          and p.allocation_id = a.id
      ) < a.qty
  ) into v_short;

  v_status := case when v_short then 'short' else 'picked' end;
  update public.so_pick_lists
  set status = v_status,
      finished_at = now()
  where id = v_list;

  -- shipped catch-up finish: the pick list closes. Status, ship_date, and shipments stay.
  if v_order_status in ('shipped', 'partially_shipped') then
    perform public.log_so_event(
      p_order,
      'pick_finished',
      v_order_status,
      v_order_status,
      'Picked after shipping. Status stays ' || v_order_status || '. ' || v_status,
      v_operator,
      v_initials
    );
  else
    perform public.log_so_event(
      p_order,
      'pick_finished',
      'picking',
      'picking',
      v_status,
      v_operator,
      v_initials
    );
  end if;

  return public.sales_order_pick_sheet(p_order);
end;
$$;

comment on function public.finish_sales_order_pick(uuid, text, uuid) is
  'Closes the pick sheet when each stock line is fully picked or the short is acknowledged. Does not pack or ship. Does not change status, ship_date, or shipment rows. A shipped or partially shipped order stays that status.';

create or replace function public.list_pick_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(q.payload order by q.order_date desc nulls last, q.so_number desc), '[]'::jsonb)
  into v_rows
  from (
    select
      o.order_date,
      o.so_number,
      jsonb_build_object(
        'order_id', o.id,
        'so_number', o.so_number,
        'status', o.status,
        'customer', coalesce(c.display_name, ''),
        'customer_po', o.customer_po,
        'ebay_order_id', o.ebay_order_id,
        'order_date', o.order_date,
        'pick_status', pl.status,
        'staging_bin', b.reference,
        'ordered', coalesce((
          select sum(a.qty)
          from public.so_lines l
          join public.so_line_allocations a on a.so_line_id = l.id
          join public.items i on i.id = a.item_id
          where l.sales_order_id = o.id
            and l.line_kind in ('product', 'kit')
            and i.item_type in ('Product', 'Kit/Package')
        ), 0),
        'picked', coalesce((
          select sum(p.qty_picked)
          from public.so_picks p
          where p.pick_list_id = pl.id
        ), 0)
      ) as payload
    from public.sales_orders o
    left join public.customers c on c.id = o.customer_id
    left join lateral (
      select id, status, staging_bin_id
      from public.so_pick_lists
      where sales_order_id = o.id
        and status <> 'cancelled'
      order by created_at desc
      limit 1
    ) pl on true
    left join public.bins b on b.id = o.staging_bin_id
    where o.so_number is not null
      and exists (
        select 1
        from public.so_lines l
        join public.so_line_allocations a on a.so_line_id = l.id
        join public.items i on i.id = a.item_id
        where l.sales_order_id = o.id
          and l.line_kind in ('product', 'kit')
          and i.item_type in ('Product', 'Kit/Package')
      )
      and (
        o.status in ('approved', 'picking')
        or (
          o.status in ('shipped', 'partially_shipped')
          and coalesce(pl.status, 'open') not in ('picked', 'short')
        )
      )
  ) q;
  return v_rows;
end;
$$;

comment on function public.list_pick_queue() is
  'Approved and picking sales orders that have a product or kit line, plus shipped and partially shipped orders whose pick is not finished. A finished pick on a shipped order leaves this list. No prices.';

create or replace function public.list_pack_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(q.payload order by q.order_date desc nulls last, q.so_number desc), '[]'::jsonb)
  into v_rows
  from (
    select
      o.order_date,
      o.so_number,
      jsonb_build_object(
        'order_id', o.id,
        'so_number', o.so_number,
        'status', o.status,
        'customer', coalesce(c.display_name, ''),
        'customer_po', o.customer_po,
        'order_date', o.order_date,
        'pick_status', pl.status,
        'picked', coalesce((
          select sum(p.qty_picked)
          from public.so_picks p
          join public.so_line_allocations a on a.id = p.allocation_id
          join public.so_lines l on l.id = a.so_line_id
          join public.items i on i.id = a.item_id
          where p.pick_list_id = pl.id
            and public.so_pick_sheet_place(l.line_kind, i.item_type) = 'pick'
            and i.sku is distinct from '4343'
        ), 0),
        'packed', coalesce((
          select sum(content.qty)
          from public.so_package_contents content
          join public.so_packages pkg on pkg.id = content.package_id
          where pkg.sales_order_id = o.id
        ), 0),
        'bins', (
          select count(*)
          from public.so_packages pkg
          where pkg.sales_order_id = o.id
        )
      ) as payload
    from public.sales_orders o
    left join public.customers c on c.id = o.customer_id
    left join lateral (
      select id, status
      from public.so_pick_lists
      where sales_order_id = o.id
        and status <> 'cancelled'
      order by created_at desc
      limit 1
    ) pl on true
    where o.so_number is not null
      and (
        o.status = 'packing'
        or (o.status = 'picking' and pl.status in ('picked', 'short'))
        or (
          o.status in ('shipped', 'partially_shipped')
          and o.packed_at is null
          and pl.status in ('picked', 'short')
        )
      )
  ) q;
  return v_rows;
end;
$$;

comment on function public.list_pack_queue() is
  'Picked orders that are ready to pack, orders already being packed, and shipped or partially shipped orders whose pick is finished and whose packed_at is still empty. No prices.';

revoke all on function public.open_sales_order_pick(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finish_sales_order_pick(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.list_pick_queue() from public, anon, authenticated;
revoke all on function public.list_pack_queue() from public, anon, authenticated;

grant execute on function public.open_sales_order_pick(uuid, text, uuid) to service_role;
grant execute on function public.finish_sales_order_pick(uuid, text, uuid) to service_role;
grant execute on function public.list_pick_queue() to service_role;
grant execute on function public.list_pack_queue() to service_role;

-- Saving a pick, a serial, a short, or a staging bin already refuses any status
-- outside approved and picking. Widen that check. Do not add a second inventory
-- path: pick_sales_order_line, record_pulled_serial, and assign_pick_staging_bin
-- keep the movement they already post.
do $patch$
declare
  v_name text;
  v_def text;
  v_next text;
  v_old text;
  v_new text;
begin
  for v_name in
    select unnest(array['pick_sales_order_line', 'assign_pick_staging_bin', 'record_pulled_serial'])
  loop
    if (
      select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = v_name
    ) <> 1 then
      raise exception '% should be one function.', v_name;
    end if;

    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = v_name;

    if v_def is null then
      raise exception '% is missing.', v_name;
    end if;
    if v_def like '%so_picking_writable%' then
      raise exception '% already allows a shipped pick.', v_name;
    end if;

    v_next := replace(
      v_def,
      'v_status not in (''approved'', ''picking'')',
      'not public.so_picking_writable(v_status)'
    );
    v_next := replace(
      v_next,
      '(select status from public.sales_orders where id = p_order for update) not in (''approved'', ''picking'')',
      'not public.so_picking_writable((select status from public.sales_orders where id = p_order for update))'
    );
    if v_next = v_def or v_next not like '%so_picking_writable%' then
      raise exception '% still refuses a shipped pick.', v_name;
    end if;
    execute v_next;
  end loop;

  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_so_allocation_replacement'
  ) <> 1 then
    raise exception 'set_so_allocation_replacement should be one function.';
  end if;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'set_so_allocation_replacement';

  if v_def is null then
    raise exception 'set_so_allocation_replacement is missing.';
  end if;
  if v_def like '%so_picking_writable%' then
    raise exception 'set_so_allocation_replacement already allows a shipped pick.';
  end if;

  v_old := $old$
  if v_status not in ('draft', 'approved', 'picking') then
    raise exception 'That sales order can no longer be edited.'
      using errcode = '22023';
  end if;
  if p_context = 'pick' and v_status not in ('approved', 'picking') then
    raise exception 'Start from an approved sales order.'
      using errcode = '22023';
  end if;$old$;

  v_new := $new$
  if p_context = 'pick' then
    if not public.so_picking_writable(v_status) then
      raise exception 'Start from an approved sales order.'
        using errcode = '22023';
    end if;
  elsif v_status not in ('draft', 'approved', 'picking') then
    raise exception 'That sales order can no longer be edited.'
      using errcode = '22023';
  end if;$new$;

  v_next := replace(v_def, v_old, v_new);
  if v_next = v_def or position('elsif v_status not in (''draft'', ''approved'', ''picking'')' in v_next) = 0 then
    raise exception 'set_so_allocation_replacement still refuses a shipped pick.';
  end if;
  execute v_next;
end
$patch$;

comment on function public.pick_sales_order_line(uuid, uuid, uuid, integer, text, uuid, text, uuid, text) is
  'Moves a quantity of the fulfilled SKU out of a stock bin. With no scanned staging bin the label is staging bin SO plus the number and no warehouse bin is created. With a scanned bin, the quantity moves into that bin. One request id picks once. A shipped or partially shipped order uses this same movement and stays that status.';

comment on function public.assign_pick_staging_bin(uuid, text, text, uuid) is
  'Uses an existing bin as the staging bin for this pick. Does not create a bin. Picks that were on the staging label move into that bin. A shipped or partially shipped order can be assigned the same way and stays that status.';

comment on function public.record_pulled_serial(uuid, uuid, text, text, uuid, text) is
  'Adds one serial that is not already a stock unit. Fills an open pull on the line when one has room. Otherwise records one Pulled piece: issued on the pick, or in the staging bin when that bin can take an owned piece. bin_scan Pulled marks the row. A shipped or partially shipped order uses this same path and stays that status.';

comment on function public.set_so_allocation_replacement(uuid, uuid, text, text, uuid, text) is
  'Sets or clears the fulfilled SKU on one allocation. item_id stays the planned SKU. Pick context requires allow_replacement_sku_during_pick and allows approved, picking, shipped, and partially shipped. Approval does not, and approval still refuses a shipped order. A pick already recorded on the line must be undone first. Writes so_events sku_replaced.';

notify pgrst, 'reload schema';
