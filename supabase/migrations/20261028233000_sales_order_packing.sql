-- Sales-order packing, the step after a finished pick.
-- packaging_types is the predefined list of boxes and pallets. A box stores
-- length, width, and height in inches. A pallet stores the base length and
-- width, and the operator enters the height on the shipping bin.
-- so_packages is the shipping bin on the order. so_package_contents is the
-- picked quantity placed in that bin. A line can split across bins.
-- Packing finishes only when every picked stock quantity is in a bin and every
-- bin has a weight. The order status moves picking to packing to packed.
-- packed_at is the hook for shipping. Carrier labels and rate shopping are not
-- created here.
-- Apply by hand on project fxsbpreasbdalwthyzvk after
-- supabase/migrations/20261028222000_so_shipping_label.sql and the picking
-- migrations. Deploying does not run this file.

create table public.packaging_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null,
  length_in numeric(10, 2) not null,
  width_in numeric(10, 2) not null,
  height_in numeric(10, 2),
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint packaging_types_name_check check (char_length(btrim(name)) between 1 and 80),
  constraint packaging_types_kind_check check (kind in ('box', 'pallet')),
  constraint packaging_types_sort_check check (sort_order > 0),
  constraint packaging_types_dims_check check (
    length_in > 0
    and width_in > 0
    and length_in <= 999
    and width_in <= 999
    and (
      (kind = 'box' and height_in > 0 and height_in <= 999)
      or (kind = 'pallet' and height_in is null)
    )
  )
);

comment on table public.packaging_types is
  'Boxes and pallets a packer can choose. A box has a fixed height. A pallet height is entered on the shipping bin.';

comment on column public.packaging_types.kind is
  'box or pallet.';

comment on column public.packaging_types.height_in is
  'Fixed height for a box. Null on a pallet.';

create unique index packaging_types_name_lower_uidx
  on public.packaging_types (lower(btrim(name)));

create index packaging_types_active_idx
  on public.packaging_types (active, sort_order, name);

insert into public.packaging_types (name, kind, length_in, width_in, height_in, sort_order) values
  ('Small box', 'box', 12, 10, 6, 1),
  ('Medium box', 'box', 18, 14, 12, 2),
  ('Large box', 'box', 24, 18, 18, 3),
  ('Standard pallet', 'pallet', 48, 40, null, 4);

alter table public.sales_orders drop constraint sales_orders_status_check;

alter table public.sales_orders
  add constraint sales_orders_status_check check (status in (
    'draft', 'approved', 'proforma_sent', 'awaiting_payment', 'released',
    'picking', 'packing', 'packed', 'partially_shipped', 'shipped', 'invoiced', 'closed', 'cancelled'
  ));

alter table public.sales_orders
  add column packed_at timestamptz;

comment on column public.sales_orders.packed_at is
  'When packing finished. A packed order waits for shipping. Carrier labels are not created here.';

create index sales_orders_packed_idx
  on public.sales_orders (packed_at desc)
  where status = 'packed';

alter table public.so_packages
  add column packaging_type_id uuid references public.packaging_types (id),
  add column kind text,
  add column operator_id uuid references public.app_users (id),
  add column operator_label text;

alter table public.so_packages
  add constraint so_packages_kind_check check (kind is null or kind in ('box', 'pallet'));

alter table public.so_packages
  add constraint so_packages_shipping_dims_check check (
    kind is null
    or (
      packaging_type_id is not null
      and length_in > 0
      and width_in > 0
      and height_in > 0
    )
  );

comment on column public.so_packages.kind is
  'box or pallet. Copied from the packaging type when the shipping bin is added. Null on a package row from before packing.';

comment on column public.so_packages.packaging_type_id is
  'Packaging type this shipping bin was created from. The inches stored on the bin stay as they were when it was added.';

create index so_packages_type_idx on public.so_packages (packaging_type_id);

alter table public.so_package_contents
  add constraint so_package_contents_package_allocation_unique unique (package_id, allocation_id);

create index so_package_contents_allocation_idx
  on public.so_package_contents (allocation_id);

create or replace function public.so_format_pack_qty(p_qty numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_qty is null then ''
    when p_qty = trunc(p_qty) then trunc(p_qty)::bigint::text
    else regexp_replace(to_char(p_qty, 'FM999999990.00'), '0+$', '')
  end;
$$;

comment on function public.so_format_pack_qty(numeric) is
  'Whole numbers print without a decimal. Other quantities keep up to two decimals.';

create or replace function public.so_pack_pick_list(p_order uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select id
  from public.so_pick_lists
  where sales_order_id = p_order
    and status <> 'cancelled'
  order by created_at desc
  limit 1;
$$;

create or replace function public.so_pack_open_block(p_order uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_list uuid;
  v_status text;
begin
  select id, status into v_list, v_status
  from public.so_pick_lists
  where sales_order_id = p_order
    and status <> 'cancelled'
  order by created_at desc
  limit 1;

  if v_status is null or v_status not in ('picked', 'short') then
    return 'Finish the pick before packing.';
  end if;

  if exists (
    select 1
    from public.so_picks
    where pick_list_id = v_list
      and allocation_id is null
      and qty_picked > 0
  ) then
    return 'A pick is no longer on a line. Undo it on the pick sheet before packing.';
  end if;

  return null;
end;
$$;

comment on function public.so_pack_open_block(uuid) is
  'Null when the latest pick list is finished. Otherwise the sentence that blocks opening packing.';

create or replace function public.so_pack_finish_block(p_order uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_open text;
  v_list uuid;
  v_picked numeric;
  v_packed numeric;
  v_line record;
  v_bin record;
  v_label text;
begin
  v_open := public.so_pack_open_block(p_order);
  if v_open is not null then
    return v_open;
  end if;

  v_list := public.so_pack_pick_list(p_order);

  select coalesce(sum(p.qty_picked), 0) into v_picked
  from public.so_picks p
  join public.so_line_allocations a on a.id = p.allocation_id
  join public.so_lines l on l.id = a.so_line_id
  join public.items i on i.id = a.item_id
  where p.pick_list_id = v_list
    and p.qty_picked > 0
    and public.so_pick_sheet_place(l.line_kind, i.item_type) = 'pick'
    and i.sku is distinct from '4343';

  if v_picked <= 0 then
    return 'Nothing was picked, so there is nothing to pack.';
  end if;

  if not exists (select 1 from public.so_packages where sales_order_id = p_order) then
    return 'Add a shipping bin before packing can be finished.';
  end if;

  for v_line in
    select
      l.line_no,
      a.id as allocation_id,
      coalesce(actual.sku, i.sku) as sku,
      coalesce((
        select sum(p.qty_picked)
        from public.so_picks p
        where p.pick_list_id = v_list
          and p.allocation_id = a.id
      ), 0) as picked
    from public.so_lines l
    join public.so_line_allocations a on a.so_line_id = l.id
    join public.items i on i.id = a.item_id
    left join public.items actual on actual.id = a.actual_item_id
    where l.sales_order_id = p_order
      and public.so_pick_sheet_place(l.line_kind, i.item_type) = 'pick'
      and i.sku is distinct from '4343'
    order by l.line_no, a.alloc_no
  loop
    if v_line.picked <= 0 then
      continue;
    end if;

    select coalesce(sum(c.qty), 0) into v_packed
    from public.so_package_contents c
    join public.so_packages pkg on pkg.id = c.package_id
    where pkg.sales_order_id = p_order
      and c.allocation_id = v_line.allocation_id;

    if v_packed > v_line.picked then
      return 'Line ' || v_line.line_no::text || ' ' || v_line.sku || ' has more packed than picked.';
    end if;
    if v_packed < v_line.picked then
      return 'Line ' || v_line.line_no::text || ' ' || v_line.sku || ' still has '
        || public.so_format_pack_qty(v_line.picked - v_packed) || ' to pack.';
    end if;
  end loop;

  for v_bin in
    select box_number, coalesce(kind, 'box') as kind, height_in, weight_lb
    from public.so_packages
    where sales_order_id = p_order
    order by box_number
  loop
    v_label := case when v_bin.kind = 'pallet' then 'Pallet ' else 'Box ' end || v_bin.box_number::text;
    if v_bin.height_in is null or v_bin.height_in <= 0 then
      return v_label || ' needs a height.';
    end if;
    if v_bin.weight_lb is null or v_bin.weight_lb <= 0 then
      return v_label || ' needs a weight.';
    end if;
  end loop;

  return null;
end;
$$;

comment on function public.so_pack_finish_block(uuid) is
  'Null when every picked stock quantity is in a shipping bin and every bin has a weight and a height. Service lines and unpicked lines are ignored.';

create or replace function public.list_packaging_types()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'name', name,
    'kind', kind,
    'length_in', length_in,
    'width_in', width_in,
    'height_in', height_in
  ) order by sort_order, name), '[]'::jsonb)
  from public.packaging_types
  where active;
$$;

comment on function public.list_packaging_types() is
  'Active boxes and pallets, in list order. No prices.';

create or replace function public.add_packaging_type(
  p_name text,
  p_kind text,
  p_length numeric,
  p_width numeric,
  p_height numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_length numeric := round(p_length, 2);
  v_width numeric := round(p_width, 2);
  v_height numeric := case when p_height is null then null else round(p_height, 2) end;
  v_sort integer;
begin
  if v_name = '' then
    raise exception 'Name the packaging type.'
      using errcode = '22023';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'A packaging name is at most 80 characters.'
      using errcode = '22023';
  end if;
  if p_kind not in ('box', 'pallet') then
    raise exception 'Choose a box or a pallet.'
      using errcode = '22023';
  end if;
  if v_length is null or v_length <= 0 or v_length > 999 then
    raise exception 'Enter a length in inches, up to two decimals.'
      using errcode = '22023';
  end if;
  if v_width is null or v_width <= 0 or v_width > 999 then
    raise exception 'Enter a width in inches, up to two decimals.'
      using errcode = '22023';
  end if;
  if p_kind = 'pallet' then
    if p_height is not null then
      raise exception 'A pallet height is entered when the bin is packed, not on the type.'
        using errcode = '22023';
    end if;
    v_height := null;
  elsif v_height is null or v_height <= 0 then
    raise exception 'A box needs a height in inches.'
      using errcode = '22023';
  elsif v_height > 999 then
    raise exception 'a height is too large.'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.packaging_types where lower(btrim(name)) = lower(v_name)
  ) then
    raise exception 'That packaging type is already on the list.'
      using errcode = '23505';
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_sort from public.packaging_types;

  insert into public.packaging_types (name, kind, length_in, width_in, height_in, sort_order)
  values (v_name, p_kind, v_length, v_width, v_height, v_sort);

  return public.list_packaging_types();
end;
$$;

comment on function public.add_packaging_type(text, text, numeric, numeric, numeric) is
  'Adds a box or a pallet to the packaging list. A box stores its height. A pallet does not.';

create or replace function public.retire_packaging_type(p_type uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.packaging_types
  set active = false
  where id = p_type;

  if not found then
    raise exception 'That packaging type is not on the list.'
      using errcode = 'P0002';
  end if;

  return public.list_packaging_types();
end;
$$;

comment on function public.retire_packaging_type(uuid) is
  'Hides a packaging type. Shipping bins already created from it keep their inches.';

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

  v_finish := case
    when v_order.status = 'packed' then null
    when v_order.status in ('cancelled', 'closed', 'shipped', 'partially_shipped', 'invoiced') then null
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
  'Shipping bins and the picked stock lines for one sales order. Freight, fees, services, and unpicked lines are left off. No prices.';

create or replace function public.so_require_packing(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.sales_orders
  where id = p_order
  for update;

  if not found then
    raise exception 'Sales order not found.'
      using errcode = 'P0002';
  end if;
  if v_status is distinct from 'packing' then
    raise exception 'Packing is closed on this sales order.'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function public.open_sales_order_pack(
  p_order uuid,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_block text;
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
begin
  select status into v_status
  from public.sales_orders
  where id = p_order
  for update;

  if not found then
    raise exception 'Sales order not found.'
      using errcode = 'P0002';
  end if;

  if v_status = 'cancelled' then
    raise exception 'This sales order is cancelled.'
      using errcode = '22023';
  end if;

  if v_status in ('packed', 'partially_shipped', 'shipped', 'invoiced', 'closed') then
    return public.sales_order_pack_sheet(p_order);
  end if;

  if v_status not in ('picking', 'packing') then
    raise exception 'Finish the pick before packing.'
      using errcode = '22023';
  end if;

  v_block := public.so_pack_open_block(p_order);
  if v_block is not null then
    raise exception '%', v_block
      using errcode = '22023';
  end if;

  if v_status = 'picking' then
    update public.sales_orders
    set status = 'packing',
        updated_at = now()
    where id = p_order;

    perform public.log_so_event(
      p_order,
      'packing_started',
      'picking',
      'packing',
      null,
      v_operator,
      v_initials
    );
  end if;

  return public.sales_order_pack_sheet(p_order);
end;
$$;

comment on function public.open_sales_order_pack(uuid, text, uuid) is
  'Opens packing after the pick is finished and sets the order to packing. Opening it again returns the same sheet. A packed order stays packed.';

create or replace function public.add_shipping_bin(
  p_order uuid,
  p_type uuid,
  p_height numeric,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.packaging_types;
  v_height numeric;
  v_number integer;
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
begin
  perform public.so_require_packing(p_order);

  select * into v_type
  from public.packaging_types
  where id = p_type
    and active;

  if not found then
    raise exception 'Choose a packaging type from the list.'
      using errcode = '22023';
  end if;

  if v_type.kind = 'box' then
    v_height := v_type.height_in;
  elsif v_type.kind = 'pallet' then
    v_height := round(p_height, 2);
    if p_height is null or v_height is null or v_height <= 0 or v_height > 999 then
      raise exception 'Enter the pallet height in inches, up to two decimals.'
        using errcode = '22023';
    end if;
  else
    raise exception 'Choose a box or a pallet.'
      using errcode = '22023';
  end if;

  select coalesce(min(n), 1) into v_number
  from generate_series(
    1,
    coalesce((select max(box_number) from public.so_packages where sales_order_id = p_order), 0) + 1
  ) as n
  where not exists (
    select 1
    from public.so_packages
    where sales_order_id = p_order
      and box_number = n
  );

  insert into public.so_packages (
    sales_order_id, box_number, length_in, width_in, height_in,
    packaging_type_id, kind, operator_id, operator_label
  ) values (
    p_order, v_number, v_type.length_in, v_type.width_in, v_height,
    v_type.id, v_type.kind, v_operator, v_initials
  );

  return public.sales_order_pack_sheet(p_order);
end;
$$;

comment on function public.add_shipping_bin(uuid, uuid, numeric, text, uuid) is
  'Adds a box or a pallet from the packaging list. A box copies its height. A pallet uses the height the operator entered.';

create or replace function public.remove_shipping_bin(
  p_package uuid,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
begin
  perform public.operator_initials(p_initials);
  perform public.so_known_operator(p_operator);

  select sales_order_id into v_order
  from public.so_packages
  where id = p_package
  for update;

  if v_order is null then
    raise exception 'That shipping bin was not found.'
      using errcode = 'P0002';
  end if;

  perform public.so_require_packing(v_order);
  delete from public.so_packages where id = p_package;
  return public.sales_order_pack_sheet(v_order);
end;
$$;

comment on function public.remove_shipping_bin(uuid, text, uuid) is
  'Removes a shipping bin and the quantities that were in it. Packing has to be open.';

create or replace function public.set_shipping_bin_weight(
  p_package uuid,
  p_weight numeric,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_weight numeric := round(p_weight, 2);
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
begin
  select sales_order_id into v_order from public.so_packages where id = p_package for update;
  if v_order is null then
    raise exception 'That shipping bin was not found.'
      using errcode = 'P0002';
  end if;
  perform public.so_require_packing(v_order);

  if p_weight is null or v_weight is null or v_weight <= 0 or v_weight > 99999 then
    raise exception 'Enter a weight in pounds, up to two decimals.'
      using errcode = '22023';
  end if;

  update public.so_packages
  set weight_lb = v_weight,
      operator_id = v_operator,
      operator_label = v_initials
  where id = p_package;

  return public.sales_order_pack_sheet(v_order);
end;
$$;

comment on function public.set_shipping_bin_weight(uuid, numeric, text, uuid) is
  'Stores the shipping bin weight in pounds. It can be entered before the bin is full.';

create or replace function public.set_shipping_bin_height(
  p_package uuid,
  p_height numeric,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_kind text;
  v_height numeric := round(p_height, 2);
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
begin
  select sales_order_id, kind into v_order, v_kind
  from public.so_packages
  where id = p_package
  for update;

  if v_order is null then
    raise exception 'That shipping bin was not found.'
      using errcode = 'P0002';
  end if;
  perform public.so_require_packing(v_order);

  if v_kind is distinct from 'pallet' then
    raise exception 'A box height comes from the packaging type.'
      using errcode = '22023';
  end if;
  if p_height is null or v_height is null or v_height <= 0 or v_height > 999 then
    raise exception 'Enter the pallet height in inches, up to two decimals.'
      using errcode = '22023';
  end if;

  update public.so_packages
  set height_in = v_height,
      operator_id = v_operator,
      operator_label = v_initials
  where id = p_package;

  return public.sales_order_pack_sheet(v_order);
end;
$$;

comment on function public.set_shipping_bin_height(uuid, numeric, text, uuid) is
  'Changes the height of a pallet. A box keeps the height from its packaging type.';

create or replace function public.so_package_contents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_status text;
  v_kind text;
  v_type text;
  v_sku text;
  v_list uuid;
  v_picked numeric;
  v_packed numeric;
  v_room numeric;
begin
  select pkg.sales_order_id, o.status
  into v_order, v_status
  from public.so_packages pkg
  join public.sales_orders o on o.id = pkg.sales_order_id
  where pkg.id = new.package_id;

  if v_order is null then
    raise exception 'That shipping bin was not found.'
      using errcode = 'P0002';
  end if;
  if v_status is distinct from 'packing' then
    raise exception 'Packing is closed on this sales order.'
      using errcode = '22023';
  end if;

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
  'A shipping bin can hold only a picked stock line, and not more than was picked.';

drop trigger if exists so_package_contents_guard on public.so_package_contents;
create trigger so_package_contents_guard
before insert or update of package_id, allocation_id, qty on public.so_package_contents
for each row execute function public.so_package_contents_guard();

create or replace function public.assign_pack_qty(
  p_package uuid,
  p_allocation uuid,
  p_qty integer,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
begin
  perform public.operator_initials(p_initials);
  perform public.so_known_operator(p_operator);

  select sales_order_id into v_order
  from public.so_packages
  where id = p_package
  for update;

  if v_order is null then
    raise exception 'That shipping bin was not found.'
      using errcode = 'P0002';
  end if;
  perform public.so_require_packing(v_order);

  if p_qty is null or p_qty < 1 then
    raise exception 'Enter a whole number of at least 1.'
      using errcode = '22023';
  end if;

  update public.so_package_contents
  set qty = qty + p_qty
  where package_id = p_package
    and allocation_id = p_allocation;

  if not found then
    insert into public.so_package_contents (package_id, allocation_id, qty)
    values (p_package, p_allocation, p_qty);
  end if;

  return public.sales_order_pack_sheet(v_order);
end;
$$;

comment on function public.assign_pack_qty(uuid, uuid, integer, text, uuid) is
  'Adds a picked quantity to a shipping bin. The same line can be split across bins.';

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
begin
  perform public.operator_initials(p_initials);
  perform public.so_known_operator(p_operator);

  select pkg.sales_order_id into v_order
  from public.so_package_contents c
  join public.so_packages pkg on pkg.id = c.package_id
  where c.id = p_content
  for update of pkg;

  if v_order is null then
    raise exception 'That packed quantity was not found.'
      using errcode = 'P0002';
  end if;

  perform public.so_require_packing(v_order);
  delete from public.so_package_contents where id = p_content;
  return public.sales_order_pack_sheet(v_order);
end;
$$;

comment on function public.remove_pack_assignment(uuid, text, uuid) is
  'Takes a packed quantity back out of a shipping bin.';

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
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
begin
  perform public.so_require_packing(p_order);
  v_block := public.so_pack_finish_block(p_order);
  if v_block is not null then
    raise exception '%', v_block
      using errcode = '22023';
  end if;

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

  return public.sales_order_pack_sheet(p_order);
end;
$$;

comment on function public.finish_sales_order_pack(uuid, text, uuid) is
  'Sets the order to packed when every picked quantity is in a bin and every bin has a weight. Does not buy a label or choose a carrier.';

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
      )
  ) q;
  return v_rows;
end;
$$;

comment on function public.list_pack_queue() is
  'Picked orders that are ready to pack, and orders already being packed. No prices.';

create or replace function public.list_ship_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(q.payload order by q.packed_at desc nulls last, q.so_number desc), '[]'::jsonb)
  into v_rows
  from (
    select
      o.packed_at,
      o.so_number,
      jsonb_build_object(
        'order_id', o.id,
        'so_number', o.so_number,
        'customer', coalesce(c.display_name, ''),
        'customer_po', o.customer_po,
        'packed_at', o.packed_at,
        'bins', (
          select count(*)
          from public.so_packages pkg
          where pkg.sales_order_id = o.id
        )
      ) as payload
    from public.sales_orders o
    left join public.customers c on c.id = o.customer_id
    where o.status = 'packed'
      and o.so_number is not null
  ) q;
  return v_rows;
end;
$$;

comment on function public.list_ship_queue() is
  'Packed orders waiting for shipping. Carrier labels and rate shopping are not on this screen.';

create or replace function public.assert_kit_line_releasable(p_line_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_open integer;
begin
  select count(*) into v_open
  from public.so_line_components as component
  join public.items as planned on planned.id = component.planned_item_id
  left join public.items as actual on actual.id = component.actual_item_id
  where component.so_line_id = p_line_id
    and (
      coalesce(actual.is_generic, false)
      or (
        planned.is_generic
        and (component.actual_item_id is null or coalesce(actual.is_generic, true))
      )
    );

  if v_open > 0 then
    raise exception 'Pick a physical part for each generic component before this line can be picked, packed, shipped, or invoiced.'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function public.so_status_kit_release()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line uuid;
begin
  if new.status in ('released', 'picking', 'packing', 'packed', 'partially_shipped', 'shipped', 'invoiced', 'closed')
    and old.status is distinct from new.status
  then
    for v_line in
      select id from public.so_lines where sales_order_id = new.id
    loop
      perform public.assert_kit_line_releasable(v_line);
    end loop;
  end if;
  return new;
end;
$$;

do $patch$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'sales_order_pick_sheet'
    and pg_get_function_identity_arguments(p.oid) = 'uuid';

  if v_def is null then
    raise exception 'sales_order_pick_sheet is missing.';
  end if;
  if v_def not like '%Packing is next and is not on this screen yet.%' then
    raise exception 'sales_order_pick_sheet handoff text was not found.';
  end if;

  v_def := replace(
    v_def,
    'Picked into the staging bin. Packing is next and is not on this screen yet.',
    'Picked into the staging bin. Packing is next.'
  );
  v_def := replace(
    v_def,
    'Short pick is recorded. Packing is next and is not on this screen yet.',
    'Short pick is recorded. Packing is next.'
  );
  execute v_def;
end
$patch$;

alter table public.packaging_types enable row level security;

revoke all on table public.packaging_types from public, anon, authenticated;
grant select, insert, update, delete on table public.packaging_types to service_role;

revoke all on function public.so_format_pack_qty(numeric) from public, anon, authenticated;
revoke all on function public.so_pack_pick_list(uuid) from public, anon, authenticated;
revoke all on function public.so_pack_open_block(uuid) from public, anon, authenticated;
revoke all on function public.so_pack_finish_block(uuid) from public, anon, authenticated;
revoke all on function public.so_require_packing(uuid) from public, anon, authenticated;
revoke all on function public.so_package_contents_guard() from public, anon, authenticated;
revoke all on function public.list_packaging_types() from public, anon, authenticated;
revoke all on function public.add_packaging_type(text, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.retire_packaging_type(uuid) from public, anon, authenticated;
revoke all on function public.sales_order_pack_sheet(uuid) from public, anon, authenticated;
revoke all on function public.open_sales_order_pack(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.add_shipping_bin(uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.remove_shipping_bin(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.set_shipping_bin_weight(uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.set_shipping_bin_height(uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.assign_pack_qty(uuid, uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.remove_pack_assignment(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finish_sales_order_pack(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.list_pack_queue() from public, anon, authenticated;
revoke all on function public.list_ship_queue() from public, anon, authenticated;

grant execute on function public.so_package_contents_guard() to service_role;
grant execute on function public.list_packaging_types() to service_role;
grant execute on function public.add_packaging_type(text, text, numeric, numeric, numeric) to service_role;
grant execute on function public.retire_packaging_type(uuid) to service_role;
grant execute on function public.sales_order_pack_sheet(uuid) to service_role;
grant execute on function public.open_sales_order_pack(uuid, text, uuid) to service_role;
grant execute on function public.add_shipping_bin(uuid, uuid, numeric, text, uuid) to service_role;
grant execute on function public.remove_shipping_bin(uuid, text, uuid) to service_role;
grant execute on function public.set_shipping_bin_weight(uuid, numeric, text, uuid) to service_role;
grant execute on function public.set_shipping_bin_height(uuid, numeric, text, uuid) to service_role;
grant execute on function public.assign_pack_qty(uuid, uuid, integer, text, uuid) to service_role;
grant execute on function public.remove_pack_assignment(uuid, text, uuid) to service_role;
grant execute on function public.finish_sales_order_pack(uuid, text, uuid) to service_role;
grant execute on function public.list_pack_queue() to service_role;
grant execute on function public.list_ship_queue() to service_role;

notify pgrst, 'reload schema';
