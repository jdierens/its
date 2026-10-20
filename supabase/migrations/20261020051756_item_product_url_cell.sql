-- update_item_cell edits the product page URL.
-- Applied on fxsbpreasbdalwthyzvk as version 20261020051756.

create or replace function public.update_item_cell(
  p_id uuid,
  p_field text,
  p_value text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.items%rowtype;
  v_note text;
  v_text text;
  v_price numeric;
  v_attr text;
  v_cleaned jsonb;
  v_attr_name text;
  v_attr_value text;
  v_attribute_id uuid;
  v_maker uuid;
  v_maker_name text;
  v_value text;
begin
  select * into v_row
  from public.items
  where id = p_id
  for update;

  if not found then
    raise exception 'That item is already gone.' using errcode = 'P0002';
  end if;

  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'This row was edited somewhere else. Reload it and try again.'
      using errcode = '40001';
  end if;

  if p_field = 'manufacturer' then
    if nullif(btrim(coalesce(p_value, '')), '') is null then
      update public.items set manufacturer_id = null where id = p_id;
      v_maker := null;
      v_maker_name := null;
      v_value := '';
    else
      begin
        v_maker := btrim(p_value)::uuid;
      exception
        when invalid_text_representation then
          raise exception 'Choose a manufacturer from the list, or add the new name.'
            using errcode = '22023';
      end;
      select name into v_maker_name from public.manufacturers where id = v_maker;
      if v_maker_name is null then
        raise exception 'Choose a manufacturer from the list, or add the new name.'
          using errcode = '23503';
      end if;
      update public.items set manufacturer_id = v_maker where id = p_id;
      v_value := v_maker::text;
    end if;

  elsif p_field = 'model' then
    v_text := public.collapse_label(p_value);
    update public.items set model = v_text where id = p_id;
    v_value := coalesce(v_text, '');

  elsif p_field = 'part_number' then
    v_text := public.collapse_label(p_value);
    update public.items set part_number = v_text where id = p_id;
    v_value := coalesce(v_text, '');

  elsif p_field = 'oem_name' then
    v_text := public.collapse_label(p_value);
    update public.items set oem_name = v_text where id = p_id;
    v_value := coalesce(v_text, '');

  elsif p_field = 'oem_part_number' then
    v_text := public.collapse_label(p_value);
    update public.items set oem_part_number = v_text where id = p_id;
    v_value := coalesce(v_text, '');

  elsif p_field = 'unit' then
    v_text := public.normalize_unit(p_value, true);
    update public.items set unit = v_text where id = p_id;
    v_value := v_text;

  elsif p_field = 'condition' then
    if btrim(coalesce(p_value, '')) not in ('New', 'Used') then
      raise exception 'Condition must be New or Used' using errcode = '22023';
    end if;
    v_note := v_row.condition_note;
    if btrim(p_value) = 'New' and v_note is not null and v_note not in ('Factory Sealed', 'New Open Box') then
      v_note := null;
    elsif btrim(p_value) = 'Used' and v_note in ('Factory Sealed', 'New Open Box') then
      v_note := null;
    end if;
    update public.items
       set condition = btrim(p_value),
           condition_note = v_note
     where id = p_id;
    v_value := btrim(p_value);

  elsif p_field = 'condition_note' then
    v_note := nullif(btrim(coalesce(p_value, '')), '');
    if v_row.condition = 'New' and v_note is not null and v_note not in ('Factory Sealed', 'New Open Box') then
      raise exception 'For a new item, the condition note must be Factory Sealed, New Open Box, or empty'
        using errcode = '22023';
    end if;
    update public.items set condition_note = v_note where id = p_id;
    v_value := coalesce(v_note, '');

  elsif p_field = 'eccn' then
    v_text := nullif(btrim(coalesce(p_value, '')), '');
    if v_text is null then
      v_text := '5A992.C';
    end if;
    update public.items set eccn = v_text where id = p_id;
    v_value := v_text;

  elsif p_field = 'us_hts' then
    v_text := nullif(btrim(coalesce(p_value, '')), '');
    if v_text is not null and (
      v_text !~ '^[0-9]+(\.[0-9]+)*$'
      or length(regexp_replace(v_text, '\D', '', 'g')) > 10
    ) then
      raise exception 'US HTS must be digits with optional dots and at most 10 digits'
        using errcode = '22023';
    end if;
    update public.items set us_hts = v_text where id = p_id;
    v_value := coalesce(v_text, '');

  elsif p_field = 'ccats' then
    v_text := nullif(btrim(coalesce(p_value, '')), '');
    update public.items set ccats = v_text where id = p_id;
    v_value := coalesce(v_text, '');

  elsif p_field = 'coo' then
    v_text := nullif(upper(btrim(coalesce(p_value, ''))), '');
    if v_text is not null and not exists (select 1 from public.countries where alpha3 = v_text) then
      raise exception 'Country of origin must be an ISO alpha-3 code' using errcode = '23503';
    end if;
    update public.items set coo = v_text where id = p_id;
    v_value := coalesce(v_text, '');

  elsif p_field = 'item_type' then
    if nullif(btrim(coalesce(p_value, '')), '') is null then
      raise exception 'Item type must be Product, Kit/Package, Service, or Non-inventory'
        using errcode = '22023';
    end if;
    v_text := public.normalize_item_type(p_value, true);
    update public.items set item_type = v_text where id = p_id;
    v_value := v_text;

  elsif p_field in ('ecommerce_price', 'market_price', 'msrp') then
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'items'
        and column_name = p_field
    ) then
      raise exception 'Pricing is not on this database yet' using errcode = '22023';
    end if;
    begin
      if nullif(btrim(coalesce(p_value, '')), '') is null then
        v_price := null;
      else
        v_price := btrim(p_value)::numeric;
      end if;
    exception
      when others then
        raise exception 'Enter a price with up to 2 decimal places.' using errcode = '22023';
    end;
    if v_price is not null then
      v_price := round(v_price, 2);
    end if;
    if v_price is not null and (v_price < 0 or v_price >= 10000000000) then
      raise exception 'Enter a price with up to 2 decimal places.' using errcode = '22023';
    end if;
    execute format('update public.items set %I = $1 where id = $2', p_field)
      using v_price, p_id;
    v_value := coalesce(trim(to_char(v_price, 'FM9999999990.00')), '');

  elsif p_field like 'attr:%' then
    v_attr := btrim(substr(p_field, 6));
    if v_row.taxonomy_id is null then
      raise exception 'Choose a taxonomy before editing attributes' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_value, '')), '') is null then
      delete from public.item_attributes as saved
      using public.attributes as fields
      join public.taxonomy_attributes as links on links.attribute_id = fields.id
      where saved.item_id = p_id
        and saved.attribute_id = fields.id
        and links.taxonomy_id = v_row.taxonomy_id
        and lower(fields.name) = lower(v_attr);
      v_value := '';
    else
      v_cleaned := public.prepare_item_attributes(
        v_row.taxonomy_id,
        jsonb_build_object(v_attr, p_value),
        '[]'::jsonb
      );
      select key, value
        into v_attr_name, v_attr_value
      from jsonb_each_text(v_cleaned)
      limit 1;
      if v_attr_name is null then
        raise exception 'Unknown attribute % for this taxonomy', v_attr using errcode = '22023';
      end if;
      select id into v_attribute_id
      from public.attributes
      where name = v_attr_name;
      insert into public.item_attributes (item_id, attribute_id, value)
      values (p_id, v_attribute_id, v_attr_value)
      on conflict (item_id, attribute_id) do update
        set value = excluded.value;
      v_value := v_attr_value;
    end if;
    update public.items set sku = sku where id = p_id;

  elsif p_field = 'product_url' then
    v_text := public.normalize_product_url(p_value);
    update public.items set product_url = v_text where id = p_id;
    v_value := coalesce(v_text, '');

  else
    raise exception 'That column cannot be edited here' using errcode = '22023';
  end if;

  select items.updated_at, items.condition_note, items.manufacturer_id, makers.name
    into v_row.updated_at, v_note, v_maker, v_maker_name
  from public.items as items
  left join public.manufacturers as makers on makers.id = items.manufacturer_id
  where items.id = p_id;

  return jsonb_build_object(
    'updated_at', v_row.updated_at,
    'value', coalesce(v_value, ''),
    'condition_note', coalesce(v_note, ''),
    'manufacturer_id', v_maker,
    'manufacturer_name', v_maker_name
  );
end;
$$;

comment on function public.update_item_cell(uuid, text, text, timestamptz) is
  'Updates one items-table cell, including the product page URL. Rejects the write when updated_at changed.';

revoke all on function public.update_item_cell(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.update_item_cell(uuid, text, text, timestamptz) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
