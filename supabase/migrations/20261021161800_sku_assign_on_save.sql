-- A numeric SKU is taken only when the item row is inserted.
-- peek_item_sku reads the next number and does not move sku_counter.
-- create_item calls allocate_item_sku when p_sku is blank or auto, in the
-- same transaction as the insert, so a closed form or a second preview does
-- not skip a number. A typed SKU is stored as given.
-- Not applied here. Review and apply by hand.

create or replace function public.peek_item_sku()
returns text
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  counter_value bigint;
  floor_value bigint;
begin
  select next_number
    into counter_value
  from public.sku_counter
  where id = 1;

  select coalesce(max(sku::bigint), 0)
    into floor_value
  from public.items
  where sku ~ '^[0-9]{1,18}$';

  return greatest(coalesce(counter_value, 1), floor_value + 1)::text;
end;
$$;

comment on function public.peek_item_sku() is
  'Next numeric SKU for display. Does not lock or advance sku_counter.';

create or replace function public.allocate_item_sku()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  issued bigint;
  floor_value bigint;
begin
  insert into public.sku_counter (id, next_number)
  values (1, 1)
  on conflict (id) do nothing;

  select next_number
    into issued
  from public.sku_counter
  where id = 1
  for update;

  select coalesce(max(sku::bigint), 0)
    into floor_value
  from public.items
  where sku ~ '^[0-9]{1,18}$';

  if issued <= floor_value then
    issued := floor_value + 1;
  end if;

  update public.sku_counter
  set next_number = issued + 1
  where id = 1;

  return issued::text;
end;
$$;

comment on function public.allocate_item_sku() is
  'Locks sku_counter and returns the next number. Call it in the same transaction as the insert so a rollback does not skip that number.';

comment on function public.reserve_item_sku() is
  'Consumes a SKU as soon as it is called. The app does not call this. Previews use peek_item_sku, and create_item allocates when the SKU is blank or auto.';

create or replace function public.create_item(
  p_name text,
  p_taxonomy text,
  p_attributes jsonb,
  p_sku text,
  p_description text,
  p_quantity bigint,
  p_attribute_defs jsonb default '[]'::jsonb,
  p_long_code text default null,
  p_short_code text default null,
  p_manufacturer_id uuid default null,
  p_model text default null,
  p_part_number text default null,
  p_condition text default 'Used',
  p_condition_note text default null,
  p_eccn text default '5A992.C',
  p_us_hts text default null,
  p_ccats text default null,
  p_coo text default null,
  p_item_type text default null,
  p_oem_name text default null,
  p_oem_part_number text default null,
  p_unit text default null,
  p_product_url text default null
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
  v_core jsonb;
  v_item_type text;
  v_sku text;
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

  v_core := public.prepare_item_core(
    p_manufacturer_id,
    p_model,
    p_part_number,
    p_condition,
    p_condition_note,
    p_eccn,
    p_us_hts,
    p_ccats,
    p_coo
  );

  v_item_type := public.normalize_item_type(p_item_type, true);
  v_sku := nullif(btrim(coalesce(p_sku, '')), '');
  if v_sku is null or lower(v_sku) = 'auto' then
    v_sku := public.allocate_item_sku();
  end if;

  insert into public.items (
    sku, name, description, taxonomy_id, quantity,
    manufacturer_id, model, part_number, condition, condition_note,
    eccn, us_hts, ccats, coo, item_type,
    oem_name, oem_part_number, unit, product_url
  )
  values (
    v_sku,
    btrim(p_name),
    coalesce(p_description, ''),
    v_taxonomy_id,
    p_quantity,
    (v_core->>'manufacturer_id')::uuid,
    v_core->>'model',
    v_core->>'part_number',
    v_core->>'condition',
    v_core->>'condition_note',
    v_core->>'eccn',
    v_core->>'us_hts',
    v_core->>'ccats',
    v_core->>'coo',
    v_item_type,
    public.collapse_label(p_oem_name),
    public.collapse_label(p_oem_part_number),
    public.normalize_unit(p_unit, true),
    public.normalize_product_url(p_product_url)
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

revoke all on function public.peek_item_sku() from public, anon, authenticated;
revoke all on function public.allocate_item_sku() from public, anon, authenticated;
revoke all on function public.create_item(text, text, jsonb, text, text, bigint, jsonb, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;

grant execute on function public.peek_item_sku() to service_role;
grant execute on function public.allocate_item_sku() to service_role;
grant execute on function public.create_item(text, text, jsonb, text, text, bigint, jsonb, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text) to service_role;
