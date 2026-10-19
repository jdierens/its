-- Fields are shared across taxonomies.
-- Existing attribute rows stay as they are, including item_attributes.
-- A taxonomy links a field through taxonomy_attributes instead of attributes.taxonomy_id.
--
-- Names are not forced unique on their own. Two taxonomies already have separate
-- fields that would collide on (lower(name), data_type, unit):
--   form_factor (text) on memory and HDD
--   interface / Interface (text) on HDD and network card
-- Those rows are kept. Each gets a label of the taxonomy short code it came from
-- (MEM, HDD, NIC) so the identity (name, type, unit, label) is unique.
-- A field with no label is the only definition for that name, type, and unit.
-- Deploying this repository does not run this file. It is applied separately.

alter table public.attributes
  add column label text;

comment on column public.attributes.label is
  'Disambiguates a field that shares a name, type, and unit with another field. Null when the name, type, and unit are unique.';

create table public.taxonomy_attributes (
  taxonomy_id uuid not null references public.taxonomies (id) on delete cascade,
  attribute_id uuid not null references public.attributes (id) on delete restrict,
  sort_order integer not null,
  primary key (taxonomy_id, attribute_id)
);

create index taxonomy_attributes_attribute_id_idx
  on public.taxonomy_attributes (attribute_id);

comment on table public.taxonomy_attributes is
  'Which shared fields a taxonomy uses, and the order shown on the item form.';

insert into public.taxonomy_attributes (taxonomy_id, attribute_id, sort_order)
select
  attributes.taxonomy_id,
  attributes.id,
  row_number() over (
    partition by attributes.taxonomy_id
    order by lower(attributes.name), attributes.id
  )
from public.attributes as attributes;

with collisions as (
  select
    lower(attributes.name) as name_key,
    attributes.data_type,
    coalesce(lower(attributes.unit), '') as unit_key
  from public.attributes as attributes
  group by 1, 2, 3
  having count(*) > 1
)
update public.attributes as attributes
set label = taxonomies.short_code
from public.taxonomies as taxonomies, collisions
where attributes.taxonomy_id = taxonomies.id
  and lower(attributes.name) = collisions.name_key
  and attributes.data_type = collisions.data_type
  and coalesce(lower(attributes.unit), '') = collisions.unit_key
  and taxonomies.short_code is not null;

drop index if exists public.attributes_taxonomy_name_lower_uidx;

alter table public.attributes
  drop constraint if exists attributes_taxonomy_id_name_key;

alter table public.attributes
  drop column taxonomy_id;

create unique index attributes_identity_uidx
  on public.attributes (
    lower(name),
    data_type,
    coalesce(lower(unit), ''),
    coalesce(lower(label), '')
  );

alter table public.taxonomy_attributes disable row level security;

grant all on table public.taxonomy_attributes to anon, authenticated, service_role;

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
  v_next_order integer;
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
    v_attribute_id := null;

    if v_def_type not in ('integer', 'decimal', 'text') then
      raise exception 'Attribute % must be an integer, decimal, or text', v_def_name
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.taxonomy_attributes as links
      join public.attributes as fields on fields.id = links.attribute_id
      where links.taxonomy_id = p_taxonomy_id
        and lower(fields.name) = lower(v_def_name)
    ) then
      raise exception 'Attribute % already exists on this taxonomy', v_def_name
        using errcode = '22023';
    end if;

    select fields.id
      into v_attribute_id
    from public.attributes as fields
    where lower(fields.name) = lower(v_def_name)
      and fields.data_type = v_def_type
      and coalesce(lower(fields.unit), '') = coalesce(lower(v_def_unit), '')
      and coalesce(fields.label, '') = ''
    limit 1;

    if v_attribute_id is null then
      if exists (
        select 1
        from public.attributes as fields
        where lower(fields.name) = lower(v_def_name)
          and fields.data_type = v_def_type
          and coalesce(lower(fields.unit), '') = coalesce(lower(v_def_unit), '')
      ) then
        raise exception 'Field % already exists as a separate definition. Link it from Fields.', v_def_name
          using errcode = '22023';
      end if;

      insert into public.attributes (name, data_type, unit, uses_list)
      values (v_def_name, v_def_type, v_def_unit, v_def_uses_list)
      returning id into v_attribute_id;
    end if;

    select coalesce(max(links.sort_order), 0) + 1
      into v_next_order
    from public.taxonomy_attributes as links
    where links.taxonomy_id = p_taxonomy_id;

    insert into public.taxonomy_attributes (taxonomy_id, attribute_id, sort_order)
    values (p_taxonomy_id, v_attribute_id, v_next_order);
  end loop;

  for v_key, v_raw in
    select key, value
    from jsonb_each_text(p_attributes)
  loop
    if v_raw is null or btrim(v_raw) = '' then
      continue;
    end if;

    v_attribute_id := null;

    select fields.id, fields.name, fields.data_type, fields.uses_list
      into v_attribute_id, v_attribute_name, v_data_type, v_uses_list
    from public.taxonomy_attributes as links
    join public.attributes as fields on fields.id = links.attribute_id
    where links.taxonomy_id = p_taxonomy_id
      and lower(fields.name) = lower(btrim(v_key));

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
        select values_row.value
          into v_canonical
        from public.attribute_values as values_row
        where values_row.attribute_id = v_attribute_id
          and values_row.value::numeric = v_value::numeric
        order by values_row.sort_order, values_row.value
        limit 1;
      else
        select values_row.value
          into v_canonical
        from public.attribute_values as values_row
        where values_row.attribute_id = v_attribute_id
          and lower(values_row.value) = lower(v_value)
        limit 1;
      end if;

      if v_canonical is null then
        insert into public.attribute_values (attribute_id, value, sort_order)
        values (
          v_attribute_id,
          v_value,
          coalesce((
            select max(values_row.sort_order) + 1
            from public.attribute_values as values_row
            where values_row.attribute_id = v_attribute_id
          ), 1)
        );

        if v_data_type in ('integer', 'decimal') then
          with ranked as (
            select
              values_row.id,
              row_number() over (
                order by values_row.value::numeric, lower(values_row.value), values_row.id
              ) as next_order
            from public.attribute_values as values_row
            where values_row.attribute_id = v_attribute_id
          )
          update public.attribute_values as values_row
          set sort_order = ranked.next_order
          from ranked
          where values_row.id = ranked.id
            and values_row.sort_order is distinct from ranked.next_order;
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
  p_attribute_defs jsonb default '[]'::jsonb,
  p_long_code text default null,
  p_short_code text default null
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
      v_taxonomy_id := public.insert_taxonomy(v_taxonomy_name, p_long_code, p_short_code);
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
  select v_item_id, fields.id, entry.value
  from jsonb_each_text(v_cleaned) as entry (key, value)
  join public.attributes as fields on fields.name = entry.key
  join public.taxonomy_attributes as links
    on links.attribute_id = fields.id
   and links.taxonomy_id = v_taxonomy_id;

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
  p_attribute_defs jsonb default '[]'::jsonb,
  p_long_code text default null,
  p_short_code text default null
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
      v_taxonomy_id := public.insert_taxonomy(v_taxonomy_name, p_long_code, p_short_code);
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
  select p_id, fields.id, entry.value
  from jsonb_each_text(v_cleaned) as entry (key, value)
  join public.attributes as fields on fields.name = entry.key
  join public.taxonomy_attributes as links
    on links.attribute_id = fields.id
   and links.taxonomy_id = v_taxonomy_id;

  return p_id;
end;
$$;

create or replace function public.link_taxonomy_attributes(
  p_taxonomy_id uuid,
  p_attribute_ids uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
  v_added integer := 0;
  v_next integer;
begin
  if p_taxonomy_id is null or not exists (select 1 from public.taxonomies where id = p_taxonomy_id) then
    raise exception 'Taxonomy was not found' using errcode = 'P0002';
  end if;

  if p_attribute_ids is null or cardinality(p_attribute_ids) = 0 then
    raise exception 'Select at least one field' using errcode = '22023';
  end if;

  foreach v_id in array p_attribute_ids loop
    select name into v_name from public.attributes where id = v_id;
    if v_name is null then
      raise exception 'Field was not found' using errcode = 'P0002';
    end if;

    if exists (
      select 1
      from public.taxonomy_attributes
      where taxonomy_id = p_taxonomy_id
        and attribute_id = v_id
    ) then
      continue;
    end if;

    if exists (
      select 1
      from public.taxonomy_attributes as links
      join public.attributes as fields on fields.id = links.attribute_id
      where links.taxonomy_id = p_taxonomy_id
        and lower(fields.name) = lower(v_name)
    ) then
      raise exception 'This taxonomy already has a field named %', v_name
        using errcode = '22023';
    end if;

    select coalesce(max(sort_order), 0) + 1
      into v_next
    from public.taxonomy_attributes
    where taxonomy_id = p_taxonomy_id;

    insert into public.taxonomy_attributes (taxonomy_id, attribute_id, sort_order)
    values (p_taxonomy_id, v_id, v_next);
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$$;

create or replace function public.create_field(
  p_taxonomy_id uuid,
  p_name text,
  p_data_type text,
  p_unit text,
  p_uses_list boolean,
  p_label text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_type text := lower(btrim(coalesce(p_data_type, '')));
  v_unit text := nullif(btrim(coalesce(p_unit, '')), '');
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_id uuid;
begin
  if v_name = '' then
    raise exception 'A new attribute needs a name' using errcode = '22023';
  end if;
  if v_type not in ('integer', 'decimal', 'text') then
    raise exception 'Attribute % must be an integer, decimal, or text', v_name
      using errcode = '22023';
  end if;

  insert into public.attributes (name, data_type, unit, uses_list, label)
  values (v_name, v_type, v_unit, coalesce(p_uses_list, true), v_label)
  returning id into v_id;

  perform public.link_taxonomy_attributes(p_taxonomy_id, array[v_id]);
  return v_id;
end;
$$;

create or replace function public.unlink_taxonomy_attribute(
  p_taxonomy_id uuid,
  p_attribute_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  select count(*)
    into v_count
  from public.item_attributes as values_row
  join public.items on items.id = values_row.item_id
  where values_row.attribute_id = p_attribute_id
    and items.taxonomy_id = p_taxonomy_id;

  if v_count > 0 then
    raise exception 'Can''t remove this field. % % in this taxonomy have a value for it.',
      v_count, case when v_count = 1 then 'item' else 'items' end
      using errcode = '22023';
  end if;

  delete from public.taxonomy_attributes
  where taxonomy_id = p_taxonomy_id
    and attribute_id = p_attribute_id;
end;
$$;

create or replace function public.delete_field(p_attribute_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_links integer;
  v_values integer;
begin
  select count(*) into v_links
  from public.taxonomy_attributes
  where attribute_id = p_attribute_id;

  select count(*) into v_values
  from public.item_attributes
  where attribute_id = p_attribute_id;

  if v_links > 0 then
    raise exception 'This field is still linked to % %',
      v_links, case when v_links = 1 then 'taxonomy' else 'taxonomies' end
      using errcode = '22023';
  end if;

  if v_values > 0 then
    raise exception 'This field still has values on % %',
      v_values, case when v_values = 1 then 'item' else 'items' end
      using errcode = '22023';
  end if;

  delete from public.attributes where id = p_attribute_id;
end;
$$;

create or replace function public.merge_attributes(p_keep uuid, p_drop uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_keep public.attributes%rowtype;
  v_drop public.attributes%rowtype;
  v_conflicts integer;
  v_link record;
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'Choose two different fields' using errcode = '22023';
  end if;

  select * into v_keep from public.attributes where id = p_keep;
  select * into v_drop from public.attributes where id = p_drop;

  if v_keep.id is null or v_drop.id is null then
    raise exception 'Field was not found' using errcode = 'P0002';
  end if;

  if v_keep.data_type <> v_drop.data_type then
    raise exception 'Fields can only be merged when they have the same type'
      using errcode = '22023';
  end if;

  select count(*)
    into v_conflicts
  from public.item_attributes as keep_row
  join public.item_attributes as drop_row on drop_row.item_id = keep_row.item_id
  where keep_row.attribute_id = p_keep
    and drop_row.attribute_id = p_drop;

  if v_conflicts > 0 then
    raise exception 'Can''t merge. % % have values for both fields.',
      v_conflicts, case when v_conflicts = 1 then 'item' else 'items' end
      using errcode = '22023';
  end if;

  insert into public.attribute_values (attribute_id, value, sort_order)
  select
    p_keep,
    drop_value.value,
    coalesce((select max(keep_value.sort_order) from public.attribute_values as keep_value where keep_value.attribute_id = p_keep), 0)
      + row_number() over (order by drop_value.sort_order, lower(drop_value.value), drop_value.id)
  from public.attribute_values as drop_value
  where drop_value.attribute_id = p_drop
    and not exists (
      select 1
      from public.attribute_values as keep_value
      where keep_value.attribute_id = p_keep
        and (
          (
            v_keep.data_type in ('integer', 'decimal')
            and keep_value.value::numeric = drop_value.value::numeric
          )
          or (
            v_keep.data_type = 'text'
            and lower(keep_value.value) = lower(drop_value.value)
          )
        )
    );

  update public.item_attributes
  set attribute_id = p_keep
  where attribute_id = p_drop;

  for v_link in
    select taxonomy_id, sort_order
    from public.taxonomy_attributes
    where attribute_id = p_drop
  loop
    if exists (
      select 1
      from public.taxonomy_attributes
      where taxonomy_id = v_link.taxonomy_id
        and attribute_id = p_keep
    ) then
      delete from public.taxonomy_attributes
      where taxonomy_id = v_link.taxonomy_id
        and attribute_id = p_drop;
    elsif exists (
      select 1
      from public.taxonomy_attributes as links
      join public.attributes as fields on fields.id = links.attribute_id
      where links.taxonomy_id = v_link.taxonomy_id
        and fields.id <> p_drop
        and lower(fields.name) = lower(v_keep.name)
    ) then
      raise exception 'A taxonomy already has a field named %', v_keep.name
        using errcode = '22023';
    else
      update public.taxonomy_attributes
      set attribute_id = p_keep
      where taxonomy_id = v_link.taxonomy_id
        and attribute_id = p_drop;
    end if;
  end loop;

  delete from public.attributes where id = p_drop;

  if not exists (
    select 1
    from public.attributes as fields
    where fields.id <> p_keep
      and lower(fields.name) = lower(v_keep.name)
      and fields.data_type = v_keep.data_type
      and coalesce(lower(fields.unit), '') = coalesce(lower(v_keep.unit), '')
  ) then
    update public.attributes
    set label = null
    where id = p_keep;
  end if;
end;
$$;

revoke all on function public.link_taxonomy_attributes(uuid, uuid[]) from public;
revoke all on function public.create_field(uuid, text, text, text, boolean, text) from public;
revoke all on function public.unlink_taxonomy_attribute(uuid, uuid) from public;
revoke all on function public.delete_field(uuid) from public;
revoke all on function public.merge_attributes(uuid, uuid) from public;

grant execute on function public.link_taxonomy_attributes(uuid, uuid[]) to anon, authenticated, service_role;
grant execute on function public.create_field(uuid, text, text, text, boolean, text) to anon, authenticated, service_role;
grant execute on function public.unlink_taxonomy_attribute(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.delete_field(uuid) to anon, authenticated, service_role;
grant execute on function public.merge_attributes(uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
