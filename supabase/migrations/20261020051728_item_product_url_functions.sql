-- Replaces create_item with an optional product URL argument at the end.
-- Also drops the previous update_item; the next migration puts it back.
-- Applied on fxsbpreasbdalwthyzvk as version 20261020051728.

drop function public.create_item(text, text, jsonb, text, text, bigint, jsonb, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text);
drop function public.update_item(uuid, text, text, jsonb, text, text, bigint, jsonb, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text);

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

  insert into public.items (
    sku, name, description, taxonomy_id, quantity,
    manufacturer_id, model, part_number, condition, condition_note,
    eccn, us_hts, ccats, coo, item_type,
    oem_name, oem_part_number, unit, product_url
  )
  values (
    coalesce(p_sku, ''),
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


revoke all on function public.create_item(text, text, jsonb, text, text, bigint, jsonb, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.create_item(text, text, jsonb, text, text, bigint, jsonb, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;
