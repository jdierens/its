-- Atomic update for an inventory item and its attribute values.
-- Validates taxonomy and attribute values the same way as public.create_item.
-- This file is not applied by deploying the repo. Run it in the Supabase SQL
-- editor (or `supabase db push`) before the edit page can save.

create or replace function public.update_item(
  p_id uuid,
  p_name text,
  p_taxonomy text default null,
  p_attributes jsonb default '{}'::jsonb,
  p_sku text default null,
  p_description text default null,
  p_quantity bigint default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_taxonomy_id uuid;
  v_unknown text;
  r record;
begin
  perform 1 from public.items where id = p_id for update;
  if not found then
    raise exception 'Unknown item: %', p_id using errcode = 'P0002';
  end if;

  p_attributes := coalesce(p_attributes, '{}'::jsonb);
  if jsonb_typeof(p_attributes) <> 'object' then
    raise exception 'p_attributes must be a JSON object of attribute name to value' using errcode = '22023';
  end if;

  if p_taxonomy is null or btrim(p_taxonomy) = '' then
    if p_attributes <> '{}'::jsonb then
      raise exception 'Attributes require a taxonomy' using errcode = '22023';
    end if;

    update public.items
      set name = p_name,
          sku = coalesce(p_sku, ''),
          description = coalesce(p_description, ''),
          quantity = p_quantity,
          taxonomy_id = null
      where id = p_id;

    delete from public.item_attributes where item_id = p_id;
    return p_id;
  end if;

  select t.id into v_taxonomy_id
  from public.taxonomies t
  where lower(t.name) = lower(p_taxonomy);
  if v_taxonomy_id is null then
    raise exception 'Unknown taxonomy: %', p_taxonomy using errcode = 'P0002';
  end if;

  select string_agg(k, ', ' order by k) into v_unknown
  from jsonb_object_keys(p_attributes) as k
  where not exists (
    select 1 from public.attributes a
    where a.taxonomy_id = v_taxonomy_id and a.name = k
  );
  if v_unknown is not null then
    raise exception 'Attributes not defined for taxonomy %: %', p_taxonomy, v_unknown using errcode = '22023';
  end if;

  for r in
    select a.id, a.name, a.data_type, e.value #>> '{}' as val
    from jsonb_each(p_attributes) as e
    join public.attributes a on a.taxonomy_id = v_taxonomy_id and a.name = e.key
  loop
    if r.val is null then
      raise exception 'Attribute % has no value', r.name using errcode = '22023';
    end if;
    begin
      if r.data_type = 'integer' then
        perform r.val::bigint;
      elsif r.data_type = 'decimal' then
        perform r.val::numeric;
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Attribute % expects %, got "%"', r.name, r.data_type, r.val using errcode = '22023';
    end;
  end loop;

  update public.items
    set taxonomy_id = v_taxonomy_id,
        name = p_name,
        sku = coalesce(p_sku, ''),
        description = coalesce(p_description, ''),
        quantity = p_quantity
    where id = p_id;

  delete from public.item_attributes ia
  where ia.item_id = p_id
    and not exists (
      select 1
      from public.attributes a
      where a.id = ia.attribute_id
        and a.taxonomy_id = v_taxonomy_id
        and exists (
          select 1 from jsonb_object_keys(p_attributes) as k where k = a.name
        )
    );

  insert into public.item_attributes (item_id, attribute_id, value)
  select p_id, a.id, e.value #>> '{}'
  from jsonb_each(p_attributes) as e
  join public.attributes a on a.taxonomy_id = v_taxonomy_id and a.name = e.key
  on conflict (item_id, attribute_id) do update
    set value = excluded.value;

  return p_id;
end;
$function$;

grant execute on function public.update_item(uuid, text, text, jsonb, text, text, bigint) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
