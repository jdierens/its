-- Kit components on a sales-order line.
-- Not applied here. Review and apply by hand.
-- Apply supabase/migrations/20261024070800_sales_orders.sql and
-- supabase/migrations/20261024100000_kits.sql before this file.

do $migration$
begin
  if to_regclass('public.so_lines') is null
    or to_regclass('public.so_line_allocations') is null
    or to_regclass('public.sales_orders') is null
    or to_regclass('public.kit_components') is null
  then
    raise exception 'Apply the sales orders migration and 20261024100000_kits.sql before kit sales lines.';
  end if;
end
$migration$;

create table public.so_line_components (
  id uuid primary key default gen_random_uuid(),
  so_line_id uuid not null references public.so_lines (id) on delete cascade,
  kit_component_id uuid references public.kit_components (id) on delete set null,
  planned_item_id uuid not null references public.items (id),
  actual_item_id uuid references public.items (id),
  qty numeric(14, 2) not null,
  swap_reason text,
  swapped_at timestamptz,
  swapped_by uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  constraint so_line_components_qty_check check (qty > 0),
  constraint so_line_components_swap_check check (
    actual_item_id is null
    or actual_item_id = planned_item_id
    or nullif(btrim(coalesce(swap_reason, '')), '') is not null
  )
);

comment on table public.so_line_components is
  'Copy of a kit recipe taken when the sales order is approved. planned_item_id is the recipe part. actual_item_id is the part that will ship. A swap keeps both. A generic planned part must have a non-generic actual part before the line is picked, shipped, or invoiced.';

create index so_line_components_line_idx on public.so_line_components (so_line_id);
create index so_line_components_planned_idx on public.so_line_components (planned_item_id);

alter table public.so_line_allocations
  add column if not exists so_line_component_id uuid references public.so_line_components (id) on delete set null;

comment on column public.so_line_allocations.so_line_component_id is
  'When this allocation picks a component of a kit line, it points at that component row. Null for the kit item itself.';

create index so_line_allocations_component_idx
  on public.so_line_allocations (so_line_component_id)
  where so_line_component_id is not null;

create or replace function public.copy_kit_recipes(p_order uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_line record;
  v_alloc record;
  v_component record;
  v_generic boolean;
begin
  for v_line in
    select id, qty from public.so_lines where sales_order_id = p_order order by line_no
  loop
    if exists (select 1 from public.so_line_components where so_line_id = v_line.id) then
      continue;
    end if;

    for v_alloc in
      select alloc.qty, item.id as item_id, item.sku, item.item_type
      from public.so_line_allocations as alloc
      join public.items as item on item.id = alloc.item_id
      where alloc.so_line_id = v_line.id
        and item.item_type = 'Kit/Package'
    loop
      if not exists (select 1 from public.kit_components where kit_item_id = v_alloc.item_id) then
        raise exception 'Kit % has no recipe.', v_alloc.sku
          using errcode = '22023';
      end if;
      perform public.validate_kit_recipe(v_alloc.item_id);

      for v_component in
        select component.id, component.component_item_id, component.qty_per_kit, child.is_generic
        from public.kit_components as component
        join public.items as child on child.id = component.component_item_id
        where component.kit_item_id = v_alloc.item_id
        order by component.sort_order, component.id
      loop
        v_generic := coalesce(v_component.is_generic, false);
        insert into public.so_line_components (
          so_line_id, kit_component_id, planned_item_id, actual_item_id, qty
        ) values (
          v_line.id,
          v_component.id,
          v_component.component_item_id,
          case when v_generic then null else v_component.component_item_id end,
          v_component.qty_per_kit * coalesce(v_alloc.qty, v_line.qty)
        );
      end loop;
    end loop;
  end loop;
end;
$$;

create or replace function public.so_copy_kit_recipe()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform public.copy_kit_recipes(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists so_copy_kit_recipe on public.sales_orders;
create trigger so_copy_kit_recipe
after update of status on public.sales_orders
for each row
execute function public.so_copy_kit_recipe();

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
    and planned.is_generic
    and (component.actual_item_id is null or coalesce(actual.is_generic, true));

  if v_open > 0 then
    raise exception 'Pick a physical part for each generic component before this line can be picked, shipped, or invoiced.'
      using errcode = '22023';
  end if;
end;
$$;

comment on function public.assert_kit_line_releasable(uuid) is
  'Blocks pick, ship, and invoice while a generic component has no non-generic actual part.';

create or replace function public.so_line_id_for_allocation(p_allocation uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select so_line_id from public.so_line_allocations where id = p_allocation;
$$;

create or replace function public.so_pick_kit_release()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line uuid;
begin
  v_line := public.so_line_id_for_allocation(new.allocation_id);
  if v_line is not null then
    perform public.assert_kit_line_releasable(v_line);
  end if;
  return new;
end;
$$;

drop trigger if exists so_picks_kit_release on public.so_picks;
create trigger so_picks_kit_release
before insert or update of allocation_id, qty_picked on public.so_picks
for each row
execute function public.so_pick_kit_release();

create or replace function public.so_shipment_kit_release()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line uuid;
begin
  v_line := public.so_line_id_for_allocation(new.allocation_id);
  if v_line is not null then
    perform public.assert_kit_line_releasable(v_line);
  end if;
  return new;
end;
$$;

drop trigger if exists so_shipment_lines_kit_release on public.so_shipment_lines;
create trigger so_shipment_lines_kit_release
before insert or update of allocation_id on public.so_shipment_lines
for each row
execute function public.so_shipment_kit_release();

create or replace function public.so_invoice_kit_release()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.so_line_id is not null then
    perform public.assert_kit_line_releasable(new.so_line_id);
  end if;
  return new;
end;
$$;

drop trigger if exists so_invoice_lines_kit_release on public.so_invoice_lines;
create trigger so_invoice_lines_kit_release
before insert or update of so_line_id on public.so_invoice_lines
for each row
execute function public.so_invoice_kit_release();

create or replace function public.so_status_kit_release()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line uuid;
begin
  if new.status in ('released', 'picking', 'packed', 'partially_shipped', 'shipped', 'invoiced', 'closed')
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

drop trigger if exists so_status_kit_release on public.sales_orders;
create trigger so_status_kit_release
before update of status on public.sales_orders
for each row
execute function public.so_status_kit_release();

create or replace function public.swap_so_line_component(
  p_component_id uuid,
  p_actual_item_id uuid,
  p_reason text,
  p_swapped_by uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_planned uuid;
  v_type text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select planned_item_id into v_planned
  from public.so_line_components
  where id = p_component_id
  for update;

  if v_planned is null then
    raise exception 'Component not found.'
      using errcode = '22023';
  end if;

  if p_actual_item_id is null then
    raise exception 'Choose a part.'
      using errcode = '22023';
  end if;

  select item_type into v_type from public.items where id = p_actual_item_id;
  if v_type is null then
    raise exception 'That part does not exist.'
      using errcode = '22023';
  end if;
  if v_type = 'Kit/Package' then
    raise exception 'Swap to a single part, not another kit.'
      using errcode = '22023';
  end if;

  if p_actual_item_id is distinct from v_planned and v_reason is null then
    raise exception 'Enter a reason for the swap.'
      using errcode = '22023';
  end if;

  update public.so_line_components
  set actual_item_id = p_actual_item_id,
      swap_reason = case when p_actual_item_id is distinct from v_planned then v_reason else null end,
      swapped_at = case when p_actual_item_id is distinct from v_planned then now() else null end,
      swapped_by = case when p_actual_item_id is distinct from v_planned then p_swapped_by else null end
  where id = p_component_id;
end;
$$;

comment on function public.swap_so_line_component(uuid, uuid, text, uuid) is
  'Replaces the actual part on one kit component. Substitutes are suggestions only; any non-kit SKU is allowed. A reason is required when the actual part differs from the planned part.';

alter table public.so_line_components enable row level security;
revoke all on table public.so_line_components from public, anon, authenticated;
grant select, insert, update, delete on table public.so_line_components to service_role;

revoke all on function public.copy_kit_recipes(uuid) from public, anon, authenticated;
revoke all on function public.so_copy_kit_recipe() from public, anon, authenticated;
revoke all on function public.assert_kit_line_releasable(uuid) from public, anon, authenticated;
revoke all on function public.so_line_id_for_allocation(uuid) from public, anon, authenticated;
revoke all on function public.so_pick_kit_release() from public, anon, authenticated;
revoke all on function public.so_shipment_kit_release() from public, anon, authenticated;
revoke all on function public.so_invoice_kit_release() from public, anon, authenticated;
revoke all on function public.so_status_kit_release() from public, anon, authenticated;
revoke all on function public.swap_so_line_component(uuid, uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.copy_kit_recipes(uuid) to service_role;
grant execute on function public.so_copy_kit_recipe() to service_role;
grant execute on function public.assert_kit_line_releasable(uuid) to service_role;
grant execute on function public.so_line_id_for_allocation(uuid) to service_role;
grant execute on function public.so_pick_kit_release() to service_role;
grant execute on function public.so_shipment_kit_release() to service_role;
grant execute on function public.so_invoice_kit_release() to service_role;
grant execute on function public.so_status_kit_release() to service_role;
grant execute on function public.swap_so_line_component(uuid, uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
