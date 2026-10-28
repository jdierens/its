-- Add field inserts a new attributes row and links it only to the taxonomy
-- that created it. Another taxonomy may already have the same name, type,
-- unit, and label. That is a different field, with its own allowed values.
-- Sharing a definition, including its allowed-value list, is still
-- link_taxonomy_attributes (Add existing field). A taxonomy still cannot
-- link two fields that share a name.
--
-- attributes_identity_uidx made that identity globally unique, so create_field
-- returned 409 when the name, type, unit, and label already existed anywhere.
-- prepare_item_attributes also reused an unlabeled match, or refused a labeled
-- one. Both of those stop here. Grants on the replaced function are left as
-- they are.
--
-- Apply by hand on project fxsbpreasbdalwthyzvk. Deploying does not run this file.

drop index if exists public.attributes_identity_uidx;

comment on column public.attributes.label is
  'Optional label shown with the field. Null is normal. The same name, type, unit, and label may exist on more than one field. Taxonomies share a field only through taxonomy_attributes.';

comment on function public.create_field(uuid, text, text, text, boolean, text) is
  'Inserts a new attribute and links it only to the given taxonomy. Does not reuse a field another taxonomy already has, even when the name, type, unit, and label match.';

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

    insert into public.attributes (name, data_type, unit, uses_list)
    values (v_def_name, v_def_type, v_def_unit, v_def_uses_list)
    returning id into v_attribute_id;

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

comment on function public.prepare_item_attributes(uuid, jsonb, jsonb) is
  'Checks item attribute values for one taxonomy. A new definition inserts its own attribute and links only that taxonomy. It does not attach a field that already exists elsewhere.';

notify pgrst, 'reload schema';
