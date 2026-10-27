-- Sales-order picking.
-- One staging bin per order, opened with the pick sheet. Each pick moves
-- quantity from a stock bin into that bin (or a nested bin when the order
-- draws a second project) and copies the source cycle's project.
-- Live stock stores the project on bin_cycles.project (AZSIM6930), not on
-- inventory_movements.project_id. There is no projects table, so project_id
-- stays null. A cycle with a project and no ownership is consigned, which is
-- how that stock is held. The staging cycle and both ledger rows keep it.
-- Serials are optional. Finish does not wait for them.
-- Freight, fee, service, and other non-stock lines (SKU 4343 is Service) are
-- not pick lines. Product and Kit/Package lines are.
-- Not applied here. Review and apply by hand. Do not run this against
-- production until it has been reviewed.
-- Apply after supabase/migrations/20261027090000_so_line_note.sql.

alter table public.bin_cycles
  add column if not exists ownership text;

alter table public.bin_cycles
  drop constraint if exists bin_cycles_ownership_check;

alter table public.bin_cycles
  add constraint bin_cycles_ownership_check
  check (ownership is null or ownership in ('owned', 'consigned'));

comment on column public.bin_cycles.ownership is
  'owned or consigned. Null on cycles opened before picking. A pick copies the source project onto the staging cycle and records consigned when that cycle has a project and no ownership yet.';

create or replace function public.bin_cycles_keep_origin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.bin_id is distinct from old.bin_id
    or new.origin_description is distinct from old.origin_description
    or new.project is distinct from old.project
    or new.ownership is distinct from old.ownership
    or new.incoming_tag is distinct from old.incoming_tag
    or new.default_location_id is distinct from old.default_location_id
    or new.opened_location_id is distinct from old.opened_location_id
    or new.opened_at is distinct from old.opened_at
    or new.opened_by_initials is distinct from old.opened_by_initials
  then
    raise exception 'A bin cycle keeps the origin it opened with.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

alter table public.so_picks
  add column if not exists client_request_id text,
  add column if not exists project text,
  add column if not exists ownership text,
  add column if not exists to_bin_id uuid references public.bins (id);

alter table public.so_picks
  drop constraint if exists so_picks_ownership_check;

alter table public.so_picks
  add constraint so_picks_ownership_check
  check (ownership is null or ownership in ('owned', 'consigned'));

alter table public.so_picks
  drop constraint if exists so_picks_allocation_id_fkey;

alter table public.so_picks
  add constraint so_picks_allocation_id_fkey
  foreign key (allocation_id) references public.so_line_allocations (id) on delete set null;

create unique index if not exists so_picks_request_idx
  on public.so_picks (client_request_id)
  where client_request_id is not null;

create index if not exists so_picks_allocation_idx
  on public.so_picks (allocation_id);

comment on column public.so_picks.project is
  'Project copied from the source bin cycle at pick time. Staging keeps this project.';

comment on column public.so_picks.ownership is
  'owned or consigned, copied with the project. A source cycle with a project and no ownership is stored as consigned.';

comment on column public.so_picks.to_bin_id is
  'Staging bin that received this pick. A second project on the same order uses a bin nested in the order staging bin.';

create or replace function public.so_pick_ownership(p_project text, p_ownership text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_ownership in ('owned', 'consigned') then p_ownership
    when nullif(btrim(coalesce(p_project, '')), '') is not null then 'consigned'
    else 'owned'
  end;
$$;

comment on function public.so_pick_ownership(text, text) is
  'Ownership a pick records. An explicit owned or consigned value wins. Otherwise a project such as AZSIM6930 is consigned, and stock with no project is owned.';

create or replace function public.so_create_staging_bin(
  p_initials text,
  p_note text,
  p_parent uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_next integer;
  v_code text;
  v_bin uuid;
begin
  select next_number into v_next
  from public.bin_counter
  where id
  for update;

  if v_next is null then
    raise exception 'Bin counter is missing.'
      using errcode = '55000';
  end if;
  if v_next < 10000 or v_next > 99999 then
    raise exception 'The next bin number must be five digits. Set it in Settings.'
      using errcode = '22023';
  end if;
  v_code := v_next::text || '-B';
  if exists (select 1 from public.bins where number = v_next or reference = v_code) then
    raise exception '% already exists. Scan it instead of creating a new one.', v_code
      using errcode = '23505';
  end if;

  -- Insert without a parent. bins_place_check looks the child up by id, and a
  -- before-insert row is not visible yet, so nesting on the insert fails.
  insert into public.bins (
    number, type, reference, notes, printed_count, created_by_initials
  ) values (
    v_next, 'B', v_code, public.blank_to_null(p_note), 0, v_initials
  )
  returning id into v_bin;

  insert into public.bin_events (bin_id, event_type, actor)
  values (v_bin, 'created', v_initials);

  if p_parent is not null then
    update public.bins
    set parent_bin_id = p_parent
    where id = v_bin;

    insert into public.bin_events (bin_id, event_type, actor, to_parent_bin_id)
    values (v_bin, 'moved', v_initials, p_parent);
  end if;

  update public.bin_counter
  set next_number = v_next + 1
  where id;

  return v_bin;
end;
$$;

comment on function public.so_create_staging_bin(text, text, uuid) is
  'Creates the next box bin for an order staging area. Does not count a label print. A parent nests a second project under the order bin.';

create or replace function public.so_pick_open_cycle(
  p_bin uuid,
  p_project text,
  p_ownership text,
  p_initials text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle uuid;
  v_project text;
  v_ownership text;
  v_on_hand integer;
  v_location uuid;
  v_default uuid;
  v_type text;
  v_initials text := public.operator_initials(p_initials);
begin
  p_project := nullif(btrim(coalesce(p_project, '')), '');
  p_ownership := public.so_pick_ownership(p_project, p_ownership);

  select c.id, c.project, c.ownership
  into v_cycle, v_project, v_ownership
  from public.bin_cycles c
  where c.bin_id = p_bin
    and c.status = 'open';

  if v_cycle is not null then
    if v_project is distinct from p_project then
      raise exception 'That staging bin is already project %.', coalesce(v_project, 'none')
        using errcode = '22023';
    end if;
    if v_ownership is not null and v_ownership is distinct from p_ownership then
      raise exception 'That staging bin is already %.', v_ownership
        using errcode = '22023';
    end if;
    return v_cycle;
  end if;

  select coalesce(sum(qty), 0) into v_on_hand
  from public.bin_contents
  where bin_id = p_bin;
  if v_on_hand > 0 then
    raise exception 'This bin has quantity and no open cycle.'
      using errcode = '55000';
  end if;

  select type, current_location_id into v_type, v_location
  from public.bins
  where id = p_bin;
  select location_id into v_default
  from public.bin_default_locations
  where bin_type = v_type;

  insert into public.bin_cycles (
    bin_id, status, project, ownership, default_location_id, opened_location_id, opened_by_initials
  ) values (
    p_bin, 'open', p_project, p_ownership, v_default, v_location, v_initials
  )
  returning id into v_cycle;

  return v_cycle;
end;
$$;

comment on function public.so_pick_open_cycle(uuid, text, text, text) is
  'Opens a staging cycle with the source project and ownership, or returns the open cycle when it already has that project. Does not call ensure_open_bin_cycle, which would drop the project.';

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
    raise exception 'Open the pick sheet before recording a pick.'
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

  return public.so_create_staging_bin(
    p_initials,
    format('Staging for SO%s %s', v_number, coalesce(p_project, 'owned')),
    v_parent
  );
end;
$$;

comment on function public.so_pick_target_bin(uuid, text, text, text) is
  'Staging bin for this pick. The order bin takes the first project. A different project is nested under it so neither cycle drops its project.';

create or replace function public.so_restore_source_cycle(
  p_bin uuid,
  p_project text,
  p_ownership text,
  p_initials text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle uuid;
  v_project text;
  v_on_hand integer;
  v_location uuid;
  v_default uuid;
  v_type text;
  v_initials text := public.operator_initials(p_initials);
begin
  p_project := nullif(btrim(coalesce(p_project, '')), '');
  p_ownership := public.so_pick_ownership(p_project, p_ownership);

  select c.id, c.project into v_cycle, v_project
  from public.bin_cycles c
  where c.bin_id = p_bin
    and c.status = 'open';

  if v_cycle is not null then
    if v_project is distinct from p_project then
      raise exception 'That bin was reused for another project. Move the quantity back by hand.'
        using errcode = '22023';
    end if;
    return v_cycle;
  end if;

  select coalesce(sum(qty), 0) into v_on_hand
  from public.bin_contents
  where bin_id = p_bin;
  if v_on_hand > 0 then
    raise exception 'This bin has quantity and no open cycle.'
      using errcode = '55000';
  end if;

  select type, current_location_id into v_type, v_location
  from public.bins
  where id = p_bin;
  select location_id into v_default
  from public.bin_default_locations
  where bin_type = v_type;

  insert into public.bin_cycles (
    bin_id, status, project, ownership, default_location_id, opened_location_id, opened_by_initials
  ) values (
    p_bin, 'open', p_project, p_ownership, v_default, v_location, v_initials
  )
  returning id into v_cycle;
  return v_cycle;
end;
$$;

comment on function public.so_restore_source_cycle(uuid, text, text, text) is
  'Puts an undone pick back on a cycle with the same project. Reopens one when the source cycle closed because it was emptied.';

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
    select a.id, a.qty, l.line_no, i.sku
    from public.so_pick_lists pl
    join public.so_lines l on l.sales_order_id = pl.sales_order_id
    join public.so_line_allocations a on a.so_line_id = l.id
    join public.items i on i.id = a.item_id
    where pl.id = p_list
      and l.line_kind in ('product', 'kit')
      and i.item_type in ('Product', 'Kit/Package')
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

comment on function public.so_pick_finish_block(uuid) is
  'Null when every product and kit line is fully picked, or a short is acknowledged. Serials are not required.';

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
      a.item_id,
      a.qty as ordered,
      l.line_no,
      i.sku,
      i.name
    from public.so_lines l
    join public.so_line_allocations a on a.so_line_id = l.id
    join public.items i on i.id = a.item_id
    where l.sales_order_id = p_order
      and l.line_kind in ('product', 'kit')
      and i.item_type in ('Product', 'Kit/Package')
    order by l.line_no, a.alloc_no
  loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'allocation_id', r.allocation_id,
      'line_no', r.line_no,
      'sku', r.sku,
      'name', r.name,
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
        where contents.item_id = r.item_id
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
              'serial', u.serial_number
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
      and not (
        l.line_kind in ('product', 'kit')
        and i.item_type in ('Product', 'Kit/Package')
      )
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
        select jsonb_agg(jsonb_build_object('id', u.id, 'serial', u.serial_number) order by u.scanned_at)
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
    'lines', v_lines,
    'skipped', v_skipped,
    'orphans', v_orphans
  );
end;
$$;

comment on function public.sales_order_pick_sheet(uuid) is
  'Pick sheet for one sales order. No prices. Product and kit lines only, with on-hand bins, picks, and optional serials.';

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
  v_pick_status text;
  v_bin uuid;
  v_note text;
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

  select id, status into v_list, v_pick_status
  from public.so_pick_lists
  where sales_order_id = p_order
    and status <> 'cancelled'
  order by created_at desc
  limit 1
  for update;

  if v_list is not null then
    if v_staging is null then
      v_note := format('Staging for SO%s', v_number);
      v_bin := public.so_create_staging_bin(v_initials, v_note, null);
      update public.sales_orders
      set staging_bin_id = v_bin, updated_at = now()
      where id = p_order;
      update public.so_pick_lists
      set staging_bin_id = v_bin
      where id = v_list;
    end if;
    return public.sales_order_pick_sheet(p_order);
  end if;

  if v_staging is null then
    v_note := format('Staging for SO%s', v_number);
    v_bin := public.so_create_staging_bin(v_initials, v_note, null);
  else
    v_bin := v_staging;
  end if;

  insert into public.so_pick_lists (
    sales_order_id, status, staging_bin_id, picker_label, started_at, operator_id
  ) values (
    p_order, 'open', v_bin, v_initials, now(), v_operator
  );

  update public.sales_orders
  set staging_bin_id = v_bin,
      status = 'picking',
      updated_at = now()
  where id = p_order;

  perform public.log_so_event(
    p_order,
    'picking_started',
    v_status,
    'picking',
    (select reference from public.bins where id = v_bin),
    v_operator,
    v_initials
  );

  return public.sales_order_pick_sheet(p_order);
end;
$$;

comment on function public.open_sales_order_pick(uuid, text, uuid) is
  'Opens the pick sheet for an approved order, creates one staging bin, and sets the order to picking. Opening it again returns the same sheet.';

create or replace function public.pick_sales_order_line(
  p_order uuid,
  p_allocation uuid,
  p_from uuid,
  p_qty integer,
  p_initials text,
  p_operator uuid,
  p_request text
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

  select a.qty, a.item_id, i.sku
  into v_ordered, v_item, v_sku
  from public.so_line_allocations a
  join public.so_lines l on l.id = a.so_line_id
  join public.items i on i.id = a.item_id
  where a.id = p_allocation
    and l.sales_order_id = p_order
    and l.line_kind in ('product', 'kit')
    and i.item_type in ('Product', 'Kit/Package');
  if v_item is null then
    raise exception 'That line is not picked.'
      using errcode = '22023';
  end if;

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
  );

  insert into public.so_picks (
    pick_list_id, allocation_id, item_id, from_bin_id, to_bin_id,
    qty_asked, qty_picked, short, transfer_id, project, ownership,
    operator_id, operator_label, picked_at, client_request_id
  ) values (
    v_list, p_allocation, v_item, p_from, v_target,
    p_qty, p_qty, false, v_transfer, v_project, v_ownership,
    v_operator, v_initials, now(), v_request
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

comment on function public.pick_sales_order_line(uuid, uuid, uuid, integer, text, uuid, text) is
  'Moves a whole quantity from one stock bin into the order staging bin. Keeps the source project and consigned ownership. One request id picks once.';

create or replace function public.record_pick_serial(
  p_pick uuid,
  p_serial text,
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
  v_serial text := btrim(coalesce(p_serial, ''));
  v_order uuid;
  v_item uuid;
  v_sku text;
  v_qty numeric;
  v_attached integer;
  v_status text;
begin
  select pl.sales_order_id, pl.status, p.item_id, p.qty_picked, i.sku
  into v_order, v_status, v_item, v_qty, v_sku
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
  if v_serial = '' then
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

  perform pg_advisory_xact_lock(hashtextextended(v_item::text, 0));
  if exists (
    select 1
    from public.so_units
    where item_id = v_item
      and lower(serial_number) = lower(v_serial)
  ) then
    raise exception 'That serial is already recorded for this item.'
      using errcode = '22023';
  end if;

  select count(*) into v_attached from public.so_units where pick_id = p_pick;
  if v_attached >= v_qty then
    raise exception 'This pick already has a serial for each piece.'
      using errcode = '22023';
  end if;

  insert into public.so_units (
    pick_id, item_id, serial_number, operator_id, operator_label
  ) values (
    p_pick, v_item, v_serial, v_operator, v_initials
  );

  return public.sales_order_pick_sheet(v_order);
end;
$$;

comment on function public.record_pick_serial(uuid, text, text, uuid) is
  'Attaches one optional serial to a pick. A SKU scan, a bin code, or a serial already on this item is rejected. Finish does not require a serial.';

create or replace function public.remove_pick_serial(
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
  v_status text;
begin
  perform public.operator_initials(p_initials);
  perform public.so_known_operator(p_operator);

  select pl.sales_order_id, pl.status
  into v_order, v_status
  from public.so_units u
  join public.so_picks p on p.id = u.pick_id
  join public.so_pick_lists pl on pl.id = p.pick_list_id
  where u.id = p_unit;

  if v_order is null then
    raise exception 'That serial was not found.'
      using errcode = 'P0002';
  end if;
  if v_status is distinct from 'open' then
    raise exception 'This pick sheet is already finished.'
      using errcode = '22023';
  end if;

  delete from public.so_units where id = p_unit;
  return public.sales_order_pick_sheet(v_order);
end;
$$;

create or replace function public.set_pick_short(
  p_order uuid,
  p_allocation uuid,
  p_short boolean,
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
  v_item uuid;
  v_ordered numeric;
begin
  perform 1 from public.sales_orders where id = p_order for update;

  select id into v_list
  from public.so_pick_lists
  where sales_order_id = p_order
    and status = 'open'
  for update;
  if v_list is null then
    raise exception 'Open the pick sheet before recording a pick.'
      using errcode = '22023';
  end if;

  select a.item_id, a.qty into v_item, v_ordered
  from public.so_line_allocations a
  join public.so_lines l on l.id = a.so_line_id
  join public.items i on i.id = a.item_id
  where a.id = p_allocation
    and l.sales_order_id = p_order
    and l.line_kind in ('product', 'kit')
    and i.item_type in ('Product', 'Kit/Package');
  if v_item is null then
    raise exception 'That line is not picked.'
      using errcode = '22023';
  end if;

  if coalesce(p_short, false) then
    if exists (
      select 1 from public.so_picks
      where pick_list_id = v_list and allocation_id = p_allocation
    ) then
      update public.so_picks
      set short = true
      where pick_list_id = v_list
        and allocation_id = p_allocation;
    else
      insert into public.so_picks (
        pick_list_id, allocation_id, item_id, qty_asked, qty_picked, short,
        operator_id, operator_label, picked_at
      ) values (
        v_list, p_allocation, v_item, v_ordered, 0, true,
        v_operator, v_initials, now()
      );
    end if;
  else
    update public.so_picks
    set short = false
    where pick_list_id = v_list
      and allocation_id = p_allocation;
    delete from public.so_picks
    where pick_list_id = v_list
      and allocation_id = p_allocation
      and qty_picked = 0
      and transfer_id is null;
  end if;

  return public.sales_order_pick_sheet(p_order);
end;
$$;

comment on function public.set_pick_short(uuid, uuid, boolean, text, uuid) is
  'Acknowledges that a line will finish short of the ordered quantity. Does not move stock.';

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

  if coalesce(v_qty, 0) < 1 or v_from is null or v_to is null then
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
  );

  delete from public.so_picks where id = p_pick;
  return public.sales_order_pick_sheet(v_order);
end;
$$;

comment on function public.undo_sales_order_pick(uuid, text, uuid) is
  'Moves a pick back to its source bin and keeps the project. Removes any serials on that pick.';

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
begin
  perform 1 from public.sales_orders where id = p_order for update;

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

  perform public.log_so_event(
    p_order,
    'pick_finished',
    'picking',
    'picking',
    v_status,
    v_operator,
    v_initials
  );

  return public.sales_order_pick_sheet(p_order);
end;
$$;

comment on function public.finish_sales_order_pick(uuid, text, uuid) is
  'Closes the pick sheet when each stock line is fully picked or the short is acknowledged. Does not pack or ship. The sales order stays editable.';

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
    where o.status in ('approved', 'picking')
      and o.so_number is not null
      and exists (
        select 1
        from public.so_lines l
        join public.so_line_allocations a on a.so_line_id = l.id
        join public.items i on i.id = a.item_id
        where l.sales_order_id = o.id
          and l.line_kind in ('product', 'kit')
          and i.item_type in ('Product', 'Kit/Package')
      )
  ) q;
  return v_rows;
end;
$$;

comment on function public.list_pick_queue() is
  'Approved and picking sales orders that have a product or kit line. No prices.';

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
      and a.item_id = v_pick.item_id
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

comment on function public.relink_sales_order_picks(uuid) is
  'After a sales-order save replaces lines, attach picks that lost their allocation to the same SKU when the ordered quantity still covers them.';

create or replace function public.suggest_bins_for_sku(
  p_item_id uuid,
  p_project text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_project text := public.blank_to_null(p_project);
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'reference', b.reference,
    'qty', bc.qty,
    'location_code', l.code,
    'cycle_id', c.id
  ) order by b.reference), '[]'::jsonb)
  into v_rows
  from public.bin_contents bc
  join public.bin_cycles c on c.id = bc.cycle_id and c.status = 'open'
  join public.bins b on b.id = bc.bin_id
  left join public.locations l on l.id = b.current_location_id
  where bc.item_id = p_item_id
    and bc.qty > 0
    and c.project is not distinct from v_project
    and not exists (
      select 1
      from public.sales_orders staged
      where staged.staging_bin_id = b.id
         or staged.staging_bin_id = b.parent_bin_id
    );
  return v_rows;
end;
$$;

comment on function public.suggest_bins_for_sku(uuid, text) is
  'Open cycles on the same project that already hold this SKU. A blank project matches cycles with no project. Order staging bins are left out so a receipt is not put into a pick.';

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
      insert into public.so_line_allocations (
        so_line_id, item_id, qty, unit_price, ext_price, alloc_no, operator_id
      ) values (
        v_line,
        (alloc ->> 'item_id')::uuid,
        v_alloc_qty,
        v_alloc_price,
        case when v_alloc_price is null then null else round(v_alloc_qty * v_alloc_price, 2) end,
        coalesce(nullif(alloc ->> 'alloc_no', '')::integer, v_alloc_n),
        v_operator
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

comment on function public.write_sales_order(jsonb, text, uuid) is
  'Inserts a draft, or replaces a draft, an approved order, or an order that is being picked. An approved order stays approved. A picking order stays picking. Both keep so_number. Cancelled, closed, and every other status are rejected. Replaces lines, allocations, and customer notes, then relinks picks onto the same SKU. Stores so_lines.line_note. Does not assign so_number.';

revoke all on function public.so_pick_ownership(text, text) from public, anon, authenticated;
revoke all on function public.so_create_staging_bin(text, text, uuid) from public, anon, authenticated;
revoke all on function public.so_pick_open_cycle(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.so_pick_target_bin(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.so_restore_source_cycle(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.so_pick_finish_block(uuid) from public, anon, authenticated;
revoke all on function public.relink_sales_order_picks(uuid) from public, anon, authenticated;
revoke all on function public.sales_order_pick_sheet(uuid) from public, anon, authenticated;
revoke all on function public.open_sales_order_pick(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.pick_sales_order_line(uuid, uuid, uuid, integer, text, uuid, text) from public, anon, authenticated;
revoke all on function public.record_pick_serial(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.remove_pick_serial(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.set_pick_short(uuid, uuid, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.undo_sales_order_pick(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finish_sales_order_pick(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.list_pick_queue() from public, anon, authenticated;

grant execute on function public.sales_order_pick_sheet(uuid) to service_role;
grant execute on function public.open_sales_order_pick(uuid, text, uuid) to service_role;
grant execute on function public.pick_sales_order_line(uuid, uuid, uuid, integer, text, uuid, text) to service_role;
grant execute on function public.record_pick_serial(uuid, text, text, uuid) to service_role;
grant execute on function public.remove_pick_serial(uuid, text, uuid) to service_role;
grant execute on function public.set_pick_short(uuid, uuid, boolean, text, uuid) to service_role;
grant execute on function public.undo_sales_order_pick(uuid, text, uuid) to service_role;
grant execute on function public.finish_sales_order_pick(uuid, text, uuid) to service_role;
grant execute on function public.list_pick_queue() to service_role;

notify pgrst, 'reload schema';
