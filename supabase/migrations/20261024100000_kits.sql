-- Kits and bundles.
-- Not applied here. Review and apply by hand. Do not run this against production
-- until it has been reviewed.
--
-- A kit is an item in the existing SKU series with item_type Kit/Package.
-- Kit server (KIT/SRV, KTS) and Kit bundle (KIT/BDL, KTB) are the only taxonomies
-- a kit may use. Service items are left as they are.
--
-- Sales-order component rows are in the next migration. Apply
-- 20261024070800_sales_orders.sql before that file. This file does not need it.
--
-- Imported kit SKUs stay at or below the numbers already stored. The existing
-- items_advance_sku_counter trigger uses greatest(), so it does not move the
-- counter backwards.

alter table public.items
  add column if not exists is_generic boolean not null default false;

comment on column public.items.is_generic is
  'A bare spec with no manufacturer part number, such as MEM\PC4-2400T-R\32G\2Rx4. A generic component on a sales order must be swapped for a physical part before the line is picked, shipped, or invoiced.';

insert into public.taxonomies (name, long_code, short_code, sort_order)
select 'Kit server', 'KIT/SRV', 'KTS', coalesce((select max(sort_order) from public.taxonomies), 0) + 1
where not exists (select 1 from public.taxonomies where long_code = 'KIT/SRV');

insert into public.taxonomies (name, long_code, short_code, sort_order)
select 'Kit bundle', 'KIT/BDL', 'KTB', coalesce((select max(sort_order) from public.taxonomies), 0) + 1
where not exists (select 1 from public.taxonomies where long_code = 'KIT/BDL');

create or replace function public.items_kit_taxonomy_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
begin
  select long_code into v_code
  from public.taxonomies
  where id = new.taxonomy_id;

  if new.item_type = 'Kit/Package' and v_code is distinct from 'KIT/SRV' and v_code is distinct from 'KIT/BDL' then
    raise exception 'A kit must use the Kit server or Kit bundle taxonomy.'
      using errcode = '22023';
  end if;

  if v_code in ('KIT/SRV', 'KIT/BDL') and new.item_type is distinct from 'Kit/Package' then
    raise exception 'Items in Kit server or Kit bundle must be Kit/Package.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists items_kit_taxonomy_guard on public.items;
create trigger items_kit_taxonomy_guard
before insert or update of item_type, taxonomy_id on public.items
for each row
execute function public.items_kit_taxonomy_guard();

comment on function public.items_kit_taxonomy_guard() is
  'Kit/Package items belong to Kit server or Kit bundle, and those taxonomies hold only Kit/Package items. Other types, including Service, are unchanged.';

create table public.kit_components (
  id uuid primary key default gen_random_uuid(),
  kit_item_id uuid not null references public.items (id) on delete cascade,
  component_item_id uuid not null references public.items (id),
  qty_per_kit integer not null,
  sort_order integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id),
  constraint kit_components_qty_check check (qty_per_kit > 0),
  constraint kit_components_sort_check check (sort_order > 0),
  constraint kit_components_pair_unique unique (kit_item_id, component_item_id),
  constraint kit_components_not_self check (kit_item_id <> component_item_id)
);

comment on table public.kit_components is
  'Recipe for one kit. The component is a single item, not another kit. A bundle (KIT/BDL) has exactly one distinct component. updated_by stays null when a bot writes the row.';

comment on column public.kit_components.qty_per_kit is
  'How many of this component go into one kit. Greater than zero.';

create index kit_components_component_idx on public.kit_components (component_item_id);

create or replace function public.kit_components_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists kit_components_touch on public.kit_components;
create trigger kit_components_touch
before update on public.kit_components
for each row
execute function public.kit_components_touch();

create or replace function public.kit_component_cycles(p_kit uuid, p_component uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  with recursive walk as (
    select component_item_id as id
    from public.kit_components
    where kit_item_id = p_component
    union
    select child.component_item_id
    from public.kit_components as child
    join walk on child.kit_item_id = walk.id
  )
  select p_kit = p_component or exists (select 1 from walk where id = p_kit);
$$;

create or replace function public.kit_components_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kit_type text;
  v_component_type text;
begin
  if new.kit_item_id = new.component_item_id then
    raise exception 'A kit cannot contain itself.'
      using errcode = '22023';
  end if;

  select item_type into v_kit_type from public.items where id = new.kit_item_id;
  select item_type into v_component_type from public.items where id = new.component_item_id;

  if v_kit_type is distinct from 'Kit/Package' then
    raise exception 'Only a Kit/Package item can have a recipe.'
      using errcode = '22023';
  end if;

  if v_component_type = 'Kit/Package' then
    raise exception 'A kit component cannot be another kit.'
      using errcode = '22023';
  end if;

  if public.kit_component_cycles(new.kit_item_id, new.component_item_id) then
    raise exception 'A kit cannot contain itself.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists kit_components_guard on public.kit_components;
create trigger kit_components_guard
before insert or update of kit_item_id, component_item_id on public.kit_components
for each row
execute function public.kit_components_guard();

create or replace function public.kit_bundle_component_count()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kit uuid := coalesce(new.kit_item_id, old.kit_item_id);
  v_code text;
  v_count integer;
begin
  select tax.long_code into v_code
  from public.items as item
  join public.taxonomies as tax on tax.id = item.taxonomy_id
  where item.id = v_kit;

  if v_code is distinct from 'KIT/BDL' then
    return null;
  end if;

  select count(distinct component_item_id) into v_count
  from public.kit_components
  where kit_item_id = v_kit;

  if v_count <> 1 then
    raise exception 'A kit bundle must have exactly one component.'
      using errcode = '22023';
  end if;

  return null;
end;
$$;

drop trigger if exists kit_components_bundle_count on public.kit_components;
create constraint trigger kit_components_bundle_count
after insert or update or delete on public.kit_components
deferrable initially deferred
for each row
execute function public.kit_bundle_component_count();

create or replace function public.validate_kit_recipe(p_kit_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_type text;
  v_code text;
  v_count integer;
  v_nested integer;
begin
  select item.item_type, tax.long_code
    into v_type, v_code
  from public.items as item
  left join public.taxonomies as tax on tax.id = item.taxonomy_id
  where item.id = p_kit_id;

  if v_type is null then
    raise exception 'Kit not found.'
      using errcode = '22023';
  end if;

  if v_type is distinct from 'Kit/Package' or v_code not in ('KIT/SRV', 'KIT/BDL') then
    raise exception 'A kit must be Kit/Package in Kit server or Kit bundle.'
      using errcode = '22023';
  end if;

  select count(*) into v_nested
  from public.kit_components as component
  join public.items as child on child.id = component.component_item_id
  where component.kit_item_id = p_kit_id
    and child.item_type = 'Kit/Package';

  if v_nested > 0 then
    raise exception 'A kit component cannot be another kit.'
      using errcode = '22023';
  end if;

  if v_code = 'KIT/BDL' then
    select count(distinct component_item_id) into v_count
    from public.kit_components
    where kit_item_id = p_kit_id;
    if v_count <> 1 then
      raise exception 'A kit bundle must have exactly one component.'
        using errcode = '22023';
    end if;
  end if;
end;
$$;

comment on function public.validate_kit_recipe(uuid) is
  'Called by the item screen and the kit import before they finish a recipe. A bundle must have one distinct component.';

create table public.item_substitutes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  substitute_item_id uuid not null references public.items (id),
  notes text,
  created_at timestamptz not null default now(),
  constraint item_substitutes_unique unique (item_id, substitute_item_id),
  constraint item_substitutes_not_self check (item_id <> substitute_item_id)
);

comment on table public.item_substitutes is
  'Suggested replacements only. A pick may use any other part. This table never limits the picker.';

create index item_substitutes_item_idx on public.item_substitutes (item_id);

create table public.kit_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id),
  event text not null,
  detail text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  constraint kit_events_event_check check (event = 'conversion')
);

comment on table public.kit_events is
  'Append-only kit audit. event conversion is written when an existing item becomes a kit. updated_by stays null for a bot.';

create index kit_events_item_idx on public.kit_events (item_id, created_at desc);

create or replace function public.kit_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Kit events cannot be changed.';
end;
$$;

drop trigger if exists kit_events_append_only on public.kit_events;
create trigger kit_events_append_only
before update or delete on public.kit_events
for each row
execute function public.kit_events_append_only();

-- conversion sits beside whatever ref types are already allowed.
do $migration$
declare
  v_def text;
  v_values text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.inventory_movements'::regclass
    and conname = 'inventory_movements_ref_type_check';

  if v_def is null then
    raise exception 'inventory_movements_ref_type_check is missing.';
  end if;

  if v_def ilike '%''conversion''%' then
    return;
  end if;

  select string_agg(quote_literal(token), ', ' order by token)
  into v_values
  from (
    select (regexp_matches(v_def, '''([a-z_]+)''', 'g'))[1] as token
    union
    select 'conversion'
  ) listed;

  execute 'alter table public.inventory_movements drop constraint inventory_movements_ref_type_check';
  execute format(
    'alter table public.inventory_movements add constraint inventory_movements_ref_type_check check (ref_type in (%s))',
    v_values
  );
end
$migration$;

comment on constraint inventory_movements_ref_type_check on public.inventory_movements is
  'Ledger reference. conversion is used when an existing item is turned into a kit, or for a warehouse move between SKUs.';

create or replace function public.kit_field_defaults(p_taxonomy_code text, p_component_ids uuid[])
returns table (condition text, eccn text, needs_choice boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_taxonomy_code, '')));
  v_count integer;
  v_condition text;
  v_eccn text;
begin
  if v_code = 'KIT/BDL' then
    if coalesce(array_length(p_component_ids, 1), 0) <> 1 then
      raise exception 'A kit bundle must have exactly one component.'
        using errcode = '22023';
    end if;
    select child.condition, child.eccn
      into v_condition, v_eccn
    from public.items as child
    where child.id = p_component_ids[1];
    condition := v_condition;
    eccn := v_eccn;
    needs_choice := false;
    return next;
    return;
  end if;

  if v_code <> 'KIT/SRV' then
    raise exception 'Choose Kit server or Kit bundle.'
      using errcode = '22023';
  end if;

  select count(*) into v_count
  from public.items as child
  left join public.taxonomies as tax on tax.id = child.taxonomy_id
  where child.id = any (p_component_ids)
    and (tax.long_code = 'SYS/SRV' or tax.long_code like 'CHA/%');

  eccn := '5A992.C';
  if v_count = 1 then
    select child.condition into condition
    from public.items as child
    left join public.taxonomies as tax on tax.id = child.taxonomy_id
    where child.id = any (p_component_ids)
      and (tax.long_code = 'SYS/SRV' or tax.long_code like 'CHA/%');
    needs_choice := false;
  else
    condition := null;
    needs_choice := true;
  end if;
  return next;
end;
$$;

comment on function public.kit_field_defaults(text, uuid[]) is
  'Defaults only. Kit server takes condition from its one chassis (CHA/* or SYS/SRV) and ECCN 5A992.C. More than one chassis, or none, leaves condition for the user. A bundle copies condition and ECCN from its only child.';

create or replace function public.save_kit_components(
  p_kit_id uuid,
  p_components jsonb,
  p_updated_by uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row jsonb;
  v_component uuid;
  v_qty integer;
  v_sort integer := 0;
begin
  if p_kit_id is null then
    raise exception 'Kit not found.'
      using errcode = '22023';
  end if;

  perform 1 from public.items where id = p_kit_id for update;

  delete from public.kit_components where kit_item_id = p_kit_id;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_components, '[]'::jsonb))
  loop
    v_sort := v_sort + 1;
    v_component := nullif(v_row->>'component_item_id', '')::uuid;
    v_qty := (v_row->>'qty_per_kit')::integer;
    if v_component is null or v_qty is null or v_qty < 1 then
      raise exception 'Each component needs an item and a quantity greater than zero.'
        using errcode = '22023';
    end if;
    insert into public.kit_components (
      kit_item_id, component_item_id, qty_per_kit, sort_order, notes, updated_by
    ) values (
      p_kit_id,
      v_component,
      v_qty,
      v_sort,
      nullif(btrim(coalesce(v_row->>'notes', '')), ''),
      p_updated_by
    );
  end loop;

  perform public.validate_kit_recipe(p_kit_id);
end;
$$;

comment on function public.save_kit_components(uuid, jsonb, uuid) is
  'Replaces one kit recipe. Pass updated_by null for a bot. A bundle is rejected unless it has one component.';

create or replace function public.item_has_stock_history(p_item_id uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hit boolean;
begin
  if exists (select 1 from public.inventory_movements where item_id = p_item_id) then
    return true;
  end if;
  if to_regclass('public.po_lines') is not null then
    execute 'select exists (select 1 from public.po_lines where item_id = $1)'
      into v_hit using p_item_id;
    if v_hit then
      return true;
    end if;
  end if;
  if to_regclass('public.price_quotes') is not null then
    execute 'select exists (select 1 from public.price_quotes where item_id = $1)'
      into v_hit using p_item_id;
    if v_hit then
      return true;
    end if;
  end if;
  if to_regclass('public.so_line_allocations') is not null then
    execute 'select exists (select 1 from public.so_line_allocations where item_id = $1)'
      into v_hit using p_item_id;
    if v_hit then
      return true;
    end if;
  end if;
  return false;
end;
$$;

create or replace function public.convert_item_to_kit(
  p_item_id uuid,
  p_taxonomy_code text,
  p_updated_by uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_taxonomy_code, '')));
  v_taxonomy uuid;
  v_old_type text;
  v_old_taxonomy uuid;
begin
  if v_code not in ('KIT/SRV', 'KIT/BDL') then
    raise exception 'Choose Kit server or Kit bundle.'
      using errcode = '22023';
  end if;

  select item_type, taxonomy_id
    into v_old_type, v_old_taxonomy
  from public.items
  where id = p_item_id
  for update;

  if v_old_type is null then
    raise exception 'That SKU does not exist.'
      using errcode = '22023';
  end if;

  if public.item_has_stock_history(p_item_id) then
    raise exception 'This SKU has inventory, purchase, quote, or sales history, so it cannot be converted to a kit.'
      using errcode = '22023';
  end if;

  select id into v_taxonomy from public.taxonomies where long_code = v_code;
  if v_taxonomy is null then
    raise exception 'Kit taxonomy % is missing.', v_code
      using errcode = '22023';
  end if;

  update public.items
  set item_type = 'Kit/Package',
      taxonomy_id = v_taxonomy
  where id = p_item_id;

  insert into public.kit_events (item_id, event, detail, updated_by)
  values (
    p_item_id,
    'conversion',
    'From ' || coalesce(v_old_type, '') || ' to Kit/Package in ' || v_code,
    p_updated_by
  );
end;
$$;

comment on function public.convert_item_to_kit(uuid, text, uuid) is
  'Changes an existing item into a kit and writes one conversion audit row. Refuses a SKU that already has inventory movements, a purchase line, a quote, or a sales allocation. updated_by stays null for a bot.';

create or replace function public.import_kit_create(
  p_sku text,
  p_name text,
  p_taxonomy_code text,
  p_condition text,
  p_eccn text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_sku text := btrim(coalesce(p_sku, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := upper(btrim(coalesce(p_taxonomy_code, '')));
  v_id uuid;
  v_taxonomy uuid;
begin
  if v_sku = '' or v_name = '' then
    raise exception 'A kit needs a SKU and a name.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.items where sku = v_sku) then
    raise exception 'SKU % already exists.', v_sku
      using errcode = '23505';
  end if;
  if nullif(btrim(coalesce(p_condition, '')), '') is null then
    raise exception 'Choose a condition for kit %.', v_sku
      using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_eccn, '')), '') is null then
    raise exception 'Choose an ECCN for kit %.', v_sku
      using errcode = '22023';
  end if;
  select id into v_taxonomy from public.taxonomies where long_code = v_code;
  if v_taxonomy is null then
    raise exception 'Kit taxonomy % is missing.', v_code
      using errcode = '22023';
  end if;

  insert into public.items (sku, name, description, taxonomy_id, item_type, condition, eccn, unit)
  values (v_sku, v_name, '', v_taxonomy, 'Kit/Package', btrim(p_condition), btrim(p_eccn), 'Piece')
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.import_kit_create(text, text, text, text, text) is
  'Inserts one kit with the SKU and name it was given. Slashes in the name are kept. Does not allocate a SKU, so the counter is not pulled backwards.';

alter table public.kit_components enable row level security;
alter table public.item_substitutes enable row level security;
alter table public.kit_events enable row level security;

revoke all on table public.kit_components from public, anon, authenticated;
revoke all on table public.item_substitutes from public, anon, authenticated;
revoke all on table public.kit_events from public, anon, authenticated;

grant select, insert, update, delete on table public.kit_components to service_role;
grant select, insert, update, delete on table public.item_substitutes to service_role;
grant select, insert on table public.kit_events to service_role;

revoke all on function public.items_kit_taxonomy_guard() from public, anon, authenticated;
revoke all on function public.kit_components_touch() from public, anon, authenticated;
revoke all on function public.kit_component_cycles(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kit_components_guard() from public, anon, authenticated;
revoke all on function public.kit_bundle_component_count() from public, anon, authenticated;
revoke all on function public.kit_events_append_only() from public, anon, authenticated;
revoke all on function public.validate_kit_recipe(uuid) from public, anon, authenticated;
revoke all on function public.kit_field_defaults(text, uuid[]) from public, anon, authenticated;
revoke all on function public.save_kit_components(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.item_has_stock_history(uuid) from public, anon, authenticated;
revoke all on function public.convert_item_to_kit(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.import_kit_create(text, text, text, text, text) from public, anon, authenticated;

grant execute on function public.items_kit_taxonomy_guard() to service_role;
grant execute on function public.kit_components_touch() to service_role;
grant execute on function public.kit_component_cycles(uuid, uuid) to service_role;
grant execute on function public.kit_components_guard() to service_role;
grant execute on function public.kit_bundle_component_count() to service_role;
grant execute on function public.kit_events_append_only() to service_role;
grant execute on function public.validate_kit_recipe(uuid) to service_role;
grant execute on function public.kit_field_defaults(text, uuid[]) to service_role;
grant execute on function public.save_kit_components(uuid, jsonb, uuid) to service_role;
grant execute on function public.item_has_stock_history(uuid) to service_role;
grant execute on function public.convert_item_to_kit(uuid, text, uuid) to service_role;
grant execute on function public.import_kit_create(text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
