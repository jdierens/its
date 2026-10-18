-- Allowed attribute values, plus creating a taxonomy or attribute while saving an item.
-- Row level security stays off, matching items, taxonomies, attributes, and item_attributes.
-- Deploying this repository does not run this file. It is applied separately.

alter table public.attributes
  add column if not exists uses_list boolean not null default true;

comment on column public.attributes.uses_list is
  'When true, the item form offers the allowed values and saving a new value adds it to the list.';

create table if not exists public.attribute_values (
  id uuid primary key default gen_random_uuid(),
  attribute_id uuid not null references public.attributes (id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint attribute_values_value_not_blank check (length(btrim(value)) > 0)
);

create unique index if not exists attribute_values_attribute_value_lower_uidx
  on public.attribute_values (attribute_id, lower(value));

create index if not exists attribute_values_attribute_sort_idx
  on public.attribute_values (attribute_id, sort_order, value);

create unique index if not exists taxonomies_name_lower_uidx
  on public.taxonomies (lower(name));

create unique index if not exists attributes_taxonomy_name_lower_uidx
  on public.attributes (taxonomy_id, lower(name));

comment on table public.attribute_values is
  'Allowed values for an attribute. A new value typed on an item is inserted here in the same save.';

grant all on table public.attribute_values to anon, authenticated, service_role;

drop function if exists public.create_item(text, text, jsonb, text, text, bigint);
drop function if exists public.update_item(uuid, text, text, jsonb, text, text, bigint);

create or replace function public.prepare_item_attributes(
  p_taxonomy_id uuid,
  p_attributes jsonb,
  p_attribute_defs jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_raw text;
  v_value text;
  v_canonical text;
  v_attribute_id uuid;
  v_attribute_name text;
  v_data_type text;
  v_uses_list boolean;
  v_cleaned jsonb := '{}'::jsonb;
  v_def jsonb;
  v_def_name text;
  v_def_type text;
  v_def_unit text;
  v_def_uses_list boolean;
begin
  if p_attributes is null then
    p_attributes := '{}'::jsonb;
  end if;

  if jsonb_typeof(p_attributes) <> 'object' then
    raise exception 'Attributes must be an object of attribute names to values'
      using errcode = '22023';
  end if;

  if p_attribute_defs is not null and jsonb_typeof(p_attribute_defs) <> 'array' then
    raise exception 'Attribute definitions must be an array'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_attribute_defs, '[]'::jsonb)) as def
    where length(btrim(coalesce(def.value ->> 'name', ''))) = 0
  ) then
    raise exception 'A new attribute needs a name' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_attribute_defs, '[]'::jsonb)) as def
    group by lower(btrim(def.value ->> 'name'))
    having count(*) > 1
  ) then
    raise exception 'Attribute names must be unique on a taxonomy' using errcode = '22023';
  end if;

  for v_def in
    select value
    from jsonb_array_elements(coalesce(p_attribute_defs, '[]'::jsonb))
  loop
    v_def_name := btrim(v_def ->> 'name');
    v_def_type := lower(btrim(coalesce(v_def ->> 'data_type', '')));
    v_def_unit := nullif(btrim(coalesce(v_def ->> 'unit', '')), '');
    v_def_uses_list := coalesce((v_def ->> 'uses_list')::boolean, true);

    if v_def_type not in ('integer', 'decimal', 'text') then
      raise exception 'Attribute % must be an integer, decimal, or text', v_def_name
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.attributes
      where taxonomy_id = p_taxonomy_id
        and lower(name) = lower(v_def_name)
    ) then
      raise exception 'Attribute % already exists on this taxonomy', v_def_name
        using errcode = '22023';
    end if;

    insert into public.attributes (taxonomy_id, name, data_type, unit, uses_list)
    values (p_taxonomy_id, v_def_name, v_def_type, v_def_unit, v_def_uses_list);
  end loop;

  for v_key, v_raw in
    select key, value
    from jsonb_each_text(p_attributes)
  loop
    if v_raw is null or btrim(v_raw) = '' then
      continue;
    end if;

    select a.id, a.name, a.data_type, a.uses_list
      into v_attribute_id, v_attribute_name, v_data_type, v_uses_list
    from public.attributes a
    where a.taxonomy_id = p_taxonomy_id
      and lower(a.name) = lower(btrim(v_key));

    if v_attribute_id is null then
      raise exception 'Unknown attribute % for this taxonomy', v_key
        using errcode = '22023';
    end if;

    begin
      if v_data_type = 'integer' then
        v_value := (btrim(v_raw)::bigint)::text;
      elsif v_data_type = 'decimal' then
        v_value := (btrim(v_raw)::numeric)::text;
      else
        v_value := btrim(v_raw);
      end if;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Attribute % expects %, got "%"', v_attribute_name, v_data_type, btrim(v_raw)
          using errcode = '22023';
    end;

    if v_uses_list then
      v_canonical := null;

      if v_data_type in ('integer', 'decimal') then
        select av.value
          into v_canonical
        from public.attribute_values av
        where av.attribute_id = v_attribute_id
          and av.value::numeric = v_value::numeric
        order by av.sort_order, av.value
        limit 1;
      else
        select av.value
          into v_canonical
        from public.attribute_values av
        where av.attribute_id = v_attribute_id
          and lower(av.value) = lower(v_value)
        limit 1;
      end if;

      if v_canonical is null then
        insert into public.attribute_values (attribute_id, value, sort_order)
        values (
          v_attribute_id,
          v_value,
          coalesce((
            select max(sort_order) + 1
            from public.attribute_values
            where attribute_id = v_attribute_id
          ), 1)
        );

        if v_data_type in ('integer', 'decimal') then
          with ranked as (
            select
              id,
              row_number() over (
                order by value::numeric, lower(value), id
              ) as next_order
          from public.attribute_values
          where attribute_id = v_attribute_id
          )
          update public.attribute_values av
          set sort_order = ranked.next_order
          from ranked
          where av.id = ranked.id
            and av.sort_order is distinct from ranked.next_order;
        end if;
      else
        v_value := v_canonical;
      end if;
    end if;

    v_cleaned := v_cleaned || jsonb_build_object(v_attribute_name, v_value);
  end loop;

  return v_cleaned;
end;
$$;

create or replace function public.create_item(
  p_name text,
  p_taxonomy text,
  p_attributes jsonb,
  p_sku text,
  p_description text,
  p_quantity bigint,
  p_attribute_defs jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item_id uuid;
  v_taxonomy_id uuid;
  v_taxonomy_name text;
  v_cleaned jsonb := '{}'::jsonb;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;

  v_taxonomy_name := nullif(btrim(coalesce(p_taxonomy, '')), '');

  if v_taxonomy_name is null then
    if coalesce(p_attributes, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Attributes require a taxonomy' using errcode = '22023';
    end if;

    if jsonb_array_length(coalesce(p_attribute_defs, '[]'::jsonb)) > 0 then
      raise exception 'Choose a taxonomy before adding attributes' using errcode = '22023';
    end if;
  else
    select id
      into v_taxonomy_id
    from public.taxonomies
    where lower(name) = lower(v_taxonomy_name)
    limit 1;

    if v_taxonomy_id is null then
      insert into public.taxonomies (name)
      values (v_taxonomy_name)
      returning id into v_taxonomy_id;
    end if;

    v_cleaned := public.prepare_item_attributes(
      v_taxonomy_id,
      coalesce(p_attributes, '{}'::jsonb),
      coalesce(p_attribute_defs, '[]'::jsonb)
    );
  end if;

  insert into public.items (sku, name, description, taxonomy_id, quantity)
  values (
    coalesce(p_sku, ''),
    btrim(p_name),
    coalesce(p_description, ''),
    v_taxonomy_id,
    p_quantity
  )
  returning id into v_item_id;

  insert into public.item_attributes (item_id, attribute_id, value)
  select v_item_id, a.id, entry.value
  from jsonb_each_text(v_cleaned) as entry (key, value)
  join public.attributes a
    on a.taxonomy_id = v_taxonomy_id
   and a.name = entry.key;

  return v_item_id;
end;
$$;

create or replace function public.update_item(
  p_id uuid,
  p_name text,
  p_taxonomy text,
  p_attributes jsonb,
  p_sku text,
  p_description text,
  p_quantity bigint,
  p_attribute_defs jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_taxonomy_id uuid;
  v_taxonomy_name text;
  v_cleaned jsonb := '{}'::jsonb;
begin
  if p_id is null or not exists (select 1 from public.items where id = p_id) then
    raise exception 'Unknown item: %', p_id using errcode = 'P0002';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;

  v_taxonomy_name := nullif(btrim(coalesce(p_taxonomy, '')), '');

  if v_taxonomy_name is null then
    if coalesce(p_attributes, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Attributes require a taxonomy' using errcode = '22023';
    end if;

    if jsonb_array_length(coalesce(p_attribute_defs, '[]'::jsonb)) > 0 then
      raise exception 'Choose a taxonomy before adding attributes' using errcode = '22023';
    end if;
  else
    select id
      into v_taxonomy_id
    from public.taxonomies
    where lower(name) = lower(v_taxonomy_name)
    limit 1;

    if v_taxonomy_id is null then
      insert into public.taxonomies (name)
      values (v_taxonomy_name)
      returning id into v_taxonomy_id;
    end if;

    v_cleaned := public.prepare_item_attributes(
      v_taxonomy_id,
      coalesce(p_attributes, '{}'::jsonb),
      coalesce(p_attribute_defs, '[]'::jsonb)
    );
  end if;

  update public.items
  set
    sku = coalesce(p_sku, ''),
    name = btrim(p_name),
    description = coalesce(p_description, ''),
    taxonomy_id = v_taxonomy_id,
    quantity = p_quantity
  where id = p_id;

  delete from public.item_attributes
  where item_id = p_id;

  insert into public.item_attributes (item_id, attribute_id, value)
  select p_id, a.id, entry.value
  from jsonb_each_text(v_cleaned) as entry (key, value)
  join public.attributes a
    on a.taxonomy_id = v_taxonomy_id
   and a.name = entry.key;

  return p_id;
end;
$$;

revoke all on function public.prepare_item_attributes(uuid, jsonb, jsonb) from public;
grant execute on function public.prepare_item_attributes(uuid, jsonb, jsonb) to anon, authenticated, service_role;
grant execute on function public.create_item(text, text, jsonb, text, text, bigint, jsonb) to anon, authenticated, service_role;
grant execute on function public.update_item(uuid, text, text, jsonb, text, text, bigint, jsonb) to anon, authenticated, service_role;

insert into public.taxonomies (name)
select seed.name
from (
  values
    ('network card'),
    ('HBA card'),
    ('transceiver'),
    ('switch'),
    ('server'),
    ('HDD'),
    ('SSD')
) as seed (name)
where not exists (
  select 1
  from public.taxonomies existing
  where lower(existing.name) = lower(seed.name)
);

insert into public.attribute_values (attribute_id, value, sort_order)
select a.id, seed.value, seed.sort_order
from public.attributes a
join public.taxonomies t on t.id = a.taxonomy_id
join (
  values
    ('capacity_gb', '8', 1),
    ('capacity_gb', '16', 2),
    ('capacity_gb', '32', 3),
    ('capacity_gb', '64', 4),
    ('capacity_gb', '128', 5),
    ('capacity_gb', '256', 6),
    ('speed', '1600', 1),
    ('speed', '2133', 2),
    ('speed', '2400', 3),
    ('speed', '2666', 4),
    ('speed', '2933', 5),
    ('speed', '3200', 6),
    ('speed', '3600', 7),
    ('speed', '4800', 8),
    ('speed', '5600', 9),
    ('speed', '6400', 10),
    ('family', 'DDR4', 1),
    ('family', 'DDR5', 2),
    ('family', 'HBM3', 3),
    ('family', 'HBM3A', 4),
    ('ranking', '1Rx4', 1),
    ('ranking', '1Rx8', 2),
    ('ranking', '2Rx4', 3),
    ('ranking', '2Rx8', 4),
    ('ranking', '4Rx4', 5),
    ('ranking', '8Rx4', 6),
    ('form_factor', 'registered DIMM', 1),
    ('form_factor', 'unbuffered DIMM', 2),
    ('form_factor', 'SO-DIMM', 3)
) as seed (attribute_name, value, sort_order)
  on lower(a.name) = lower(seed.attribute_name)
where lower(t.name) = 'memory'
  and not exists (
    select 1
    from public.attribute_values existing
    where existing.attribute_id = a.id
      and lower(existing.value) = lower(seed.value)
  );

insert into public.attribute_values (attribute_id, value, sort_order)
select a.id, seed.value, seed.sort_order
from public.attributes a
join public.taxonomies t on t.id = a.taxonomy_id
join (
  values
    ('connector', 'QSFP28', 1),
    ('connector', 'SFP+', 2),
    ('speed_gbps', '1', 1),
    ('speed_gbps', '10', 2),
    ('speed_gbps', '25', 3),
    ('speed_gbps', '40', 4),
    ('speed_gbps', '100', 5),
    ('speed_gbps', '200', 6),
    ('speed_gbps', '400', 7),
    ('cable_type', 'AOC', 1),
    ('cable_type', 'DAC', 2),
    ('length_m', '0.5', 1),
    ('length_m', '1', 2),
    ('length_m', '2', 3),
    ('length_m', '3', 4),
    ('length_m', '5', 5),
    ('length_m', '7', 6),
    ('length_m', '10', 7),
    ('length_m', '15', 8),
    ('length_m', '20', 9),
    ('length_m', '30', 10),
    ('compatible_vendor', 'Arista', 1),
    ('compatible_vendor', 'Cisco', 2),
    ('compatible_vendor', 'Dell', 3),
    ('compatible_vendor', 'Juniper', 4),
    ('compatible_vendor', 'NVIDIA', 5)
) as seed (attribute_name, value, sort_order)
  on lower(a.name) = lower(seed.attribute_name)
where lower(t.name) = 'network cable'
  and not exists (
    select 1
    from public.attribute_values existing
    where existing.attribute_id = a.id
      and (
        (
          a.data_type in ('integer', 'decimal')
          and existing.value::numeric = seed.value::numeric
        )
        or (
          a.data_type = 'text'
          and lower(existing.value) = lower(seed.value)
        )
      )
  );

update public.attributes
set uses_list = true
where uses_list is distinct from true;

notify pgrst, 'reload schema';
