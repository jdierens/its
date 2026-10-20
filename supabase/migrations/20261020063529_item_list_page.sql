-- One page of item ids for the items table. The sort covers every filtered row.
-- Row security is unchanged.

create or replace function public.item_list_page(
  p_ids uuid[] default null,
  p_taxonomy_id uuid default null,
  p_condition text default null,
  p_manufacturer_id uuid default null,
  p_item_type text default null,
  p_sort text default 'sku',
  p_ascending boolean default true,
  p_attribute text default null,
  p_attribute_numeric boolean default false,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      greatest(0, least(coalesce(p_offset, 0), 1000000)) as off,
      greatest(1, least(coalesce(p_limit, 100), 200)) as lim,
      case
        when p_sort in (
          'taxonomy', 'sku', 'name', 'item_type', 'manufacturer', 'model',
          'part_number', 'oem_name', 'oem_part_number', 'product_url', 'unit',
          'condition', 'condition_note', 'eccn', 'us_hts', 'ccats', 'coo',
          'ecommerce_price', 'market_price', 'msrp', 'quantity', 'edited', 'attr'
        ) then p_sort
        else 'sku'
      end as sort_key,
      coalesce(p_ascending, true) as ascending
  ),
  filtered as (
    select
      i.id,
      i.sku,
      i.name,
      i.item_type,
      i.model,
      i.part_number,
      i.oem_name,
      i.oem_part_number,
      i.product_url,
      i.unit,
      i.condition,
      i.condition_note,
      i.eccn,
      i.us_hts,
      i.ccats,
      i.coo,
      i.quantity,
      i.ecommerce_price,
      i.market_price,
      i.msrp,
      i.updated_at,
      t.short_code as taxonomy_code,
      m.name as manufacturer_name,
      attr.value as attribute_value
    from public.items as i
    left join public.taxonomies as t on t.id = i.taxonomy_id
    left join public.manufacturers as m on m.id = i.manufacturer_id
    left join lateral (
      select saved.value
      from public.item_attributes as saved
      join public.attributes as field on field.id = saved.attribute_id
      where saved.item_id = i.id
        and p_attribute is not null
        and field.name = p_attribute
      limit 1
    ) as attr on true
    where (p_taxonomy_id is null or i.taxonomy_id = p_taxonomy_id)
      and (p_condition is null or i.condition = p_condition)
      and (p_manufacturer_id is null or i.manufacturer_id = p_manufacturer_id)
      and (p_item_type is null or i.item_type = p_item_type)
      and (p_ids is null or i.id = any (p_ids))
  ),
  keyed as (
    select
      f.id,
      case b.sort_key
        when 'sku' then case when f.sku ~ '^[0-9]+$' then f.sku::numeric end
        when 'quantity' then f.quantity::numeric
        when 'ecommerce_price' then f.ecommerce_price
        when 'market_price' then f.market_price
        when 'msrp' then f.msrp
        when 'attr' then case
          when coalesce(p_attribute_numeric, false)
            and f.attribute_value ~ '^-?[0-9]+(\.[0-9]+)?$'
          then f.attribute_value::numeric
        end
        else null::numeric
      end as num_key,
      case b.sort_key
        when 'sku' then lower(nullif(btrim(f.sku), ''))
        when 'name' then lower(nullif(btrim(f.name), ''))
        when 'taxonomy' then lower(nullif(btrim(f.taxonomy_code), ''))
        when 'item_type' then lower(nullif(btrim(f.item_type), ''))
        when 'manufacturer' then lower(nullif(btrim(f.manufacturer_name), ''))
        when 'model' then lower(nullif(btrim(f.model), ''))
        when 'part_number' then lower(nullif(btrim(f.part_number), ''))
        when 'oem_name' then lower(nullif(btrim(f.oem_name), ''))
        when 'oem_part_number' then lower(nullif(btrim(f.oem_part_number), ''))
        when 'product_url' then lower(nullif(btrim(f.product_url), ''))
        when 'unit' then lower(nullif(btrim(f.unit), ''))
        when 'condition' then lower(nullif(btrim(f.condition), ''))
        when 'condition_note' then lower(nullif(btrim(f.condition_note), ''))
        when 'eccn' then lower(nullif(btrim(f.eccn), ''))
        when 'us_hts' then lower(nullif(btrim(f.us_hts), ''))
        when 'ccats' then lower(nullif(btrim(f.ccats), ''))
        when 'coo' then lower(nullif(btrim(f.coo), ''))
        when 'attr' then case
          when not coalesce(p_attribute_numeric, false)
          then lower(nullif(btrim(f.attribute_value), ''))
        end
        else null::text
      end as text_key,
      case when b.sort_key = 'edited' then f.updated_at end as time_key,
      b.ascending
    from filtered as f
    cross join bounds as b
  ),
  ranked as (
    select
      id,
      row_number() over (
        order by
          case when ascending then num_key end asc nulls last,
          case when not ascending then num_key end desc nulls last,
          case when ascending then text_key end asc nulls last,
          case when not ascending then text_key end desc nulls last,
          case when ascending then time_key end asc nulls last,
          case when not ascending then time_key end desc nulls last,
          id asc
      ) as ord
    from keyed
  )
  select jsonb_build_object(
    'count', (select count(*) from filtered),
    'ids', coalesce((
      select jsonb_agg(ranked.id order by ranked.ord)
      from ranked
      cross join bounds
      where ranked.ord > bounds.off
        and ranked.ord <= bounds.off + bounds.lim
    ), '[]'::jsonb)
  );
$$;

comment on function public.item_list_page(uuid[], uuid, text, uuid, text, text, boolean, text, boolean, integer, integer) is
  'One page of item ids for the items table. Sort covers the filtered set. Does not change row security.';

revoke all on function public.item_list_page(uuid[], uuid, text, uuid, text, text, boolean, text, boolean, integer, integer) from public;
grant execute on function public.item_list_page(uuid[], uuid, text, uuid, text, text, boolean, text, boolean, integer, integer) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
