-- Migration: item attribute search
-- NOT APPLIED. Review this file and apply it in the SQL editor.
-- Advanced search calls these functions when they exist.
--
-- EXPLAIN (analyze) on memory, the largest taxonomy (2169 items), for
-- capacity_gb = 64 and family = DDR5 used item_attributes_value_trgm_idx
-- and took about 113 ms. item_attributes_attribute_value_idx is the btree
-- lookup that filter should use instead. The older (attribute_id) index stays.

create index if not exists item_attributes_attribute_value_idx
  on public.item_attributes (attribute_id, value);

create or replace function public.attribute_value_matches(p_stored text, p_wanted text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select lower(btrim(coalesce(p_stored, ''))) = lower(btrim(coalesce(p_wanted, '')))
    or (
      btrim(coalesce(p_stored, '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      and btrim(coalesce(p_wanted, '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      and btrim(p_stored)::numeric = btrim(p_wanted)::numeric
    );
$$;

-- Item ids in one taxonomy that match every list (OR inside a field) and every range.
-- p_filters:
--   lists: { "<attribute uuid>": ["64", "32"] }
--   ranges: { "<attribute uuid>": { "min": "16", "max": "64" } }
--   exclude_id: "<item uuid>"
--   seed: { "<attribute uuid>": "DDR5" }  -- ignored here; search uses it for rank
create or replace function public.item_attribute_match_ids(
  p_taxonomy_id uuid,
  p_filters jsonb
)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with lists as (
    select entry.key::uuid as attribute_id, btrim(item.value) as value
    from (
      select spec.key, spec.value
      from jsonb_each(coalesce(p_filters -> 'lists', '{}'::jsonb)) as spec(key, value)
      where spec.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and jsonb_typeof(spec.value) = 'array'
    ) as entry
    cross join lateral jsonb_array_elements_text(entry.value) as item(value)
    where btrim(item.value) <> ''
  ),
  list_attrs as (
    select distinct lists.attribute_id from lists
  ),
  ranges as (
    select
      spec.key::uuid as attribute_id,
      nullif(btrim(spec.value ->> 'min'), '') as min_text,
      nullif(btrim(spec.value ->> 'max'), '') as max_text
    from jsonb_each(coalesce(p_filters -> 'ranges', '{}'::jsonb)) as spec(key, value)
    where spec.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and jsonb_typeof(spec.value) = 'object'
      and (
        nullif(btrim(spec.value ->> 'min'), '') is not null
        or nullif(btrim(spec.value ->> 'max'), '') is not null
      )
  ),
  excluded as (
    select case
      when coalesce(p_filters ->> 'exclude_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (p_filters ->> 'exclude_id')::uuid
      else null
    end as item_id
  )
  select items.id
  from public.items as items
  cross join excluded
  where items.taxonomy_id = p_taxonomy_id
    and (excluded.item_id is null or items.id <> excluded.item_id)
    and not exists (
      select 1
      from list_attrs as need
      where not exists (
        select 1
        from public.item_attributes as saved
        join lists as wanted
          on wanted.attribute_id = need.attribute_id
         and wanted.attribute_id = saved.attribute_id
        where saved.item_id = items.id
          and public.attribute_value_matches(saved.value, wanted.value)
      )
    )
    and not exists (
      select 1
      from ranges as span
      where not exists (
        select 1
        from public.item_attributes as saved
        where saved.item_id = items.id
          and saved.attribute_id = span.attribute_id
          and btrim(saved.value) ~ '^-?[0-9]+(\.[0-9]+)?$'
          and (
            span.min_text is null
            or span.min_text !~ '^-?[0-9]+(\.[0-9]+)?$'
            or btrim(saved.value)::numeric >= span.min_text::numeric
          )
          and (
            span.max_text is null
            or span.max_text !~ '^-?[0-9]+(\.[0-9]+)?$'
            or btrim(saved.value)::numeric <= span.max_text::numeric
          )
      )
    );
$$;

create or replace function public.search_items_by_attributes(
  p_taxonomy_id uuid,
  p_filters jsonb,
  p_limit integer,
  p_offset integer
)
returns table (
  id uuid,
  sku text,
  name text,
  manufacturer_name text,
  part_number text,
  quantity bigint,
  match_count integer,
  seed_count integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if p_taxonomy_id is null then
    return;
  end if;

  return query
  with seeds as (
    select spec.key::uuid as attribute_id, btrim(spec.value) as value
    from jsonb_each_text(coalesce(p_filters -> 'seed', '{}'::jsonb)) as spec(key, value)
    where spec.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and btrim(spec.value) <> ''
  ),
  matched as (
    select match_id as item_id
    from public.item_attribute_match_ids(p_taxonomy_id, p_filters) as match_id
  ),
  scored as (
    select
      items.id,
      items.sku,
      items.name,
      makers.name as manufacturer_name,
      items.part_number,
      items.quantity,
      (
        select count(*)::integer
        from seeds
        join public.item_attributes as saved
          on saved.item_id = items.id
         and saved.attribute_id = seeds.attribute_id
        where public.attribute_value_matches(saved.value, seeds.value)
      ) as match_count,
      (select count(*)::integer from seeds) as seed_count,
      (select count(*)::bigint from matched) as total_count
    from matched
    join public.items as items on items.id = matched.item_id
    left join public.manufacturers as makers on makers.id = items.manufacturer_id
  )
  select
    scored.id,
    scored.sku,
    scored.name,
    scored.manufacturer_name,
    scored.part_number,
    scored.quantity,
    scored.match_count,
    scored.seed_count,
    scored.total_count
  from scored
  order by scored.match_count desc, scored.sku asc nulls last, scored.id
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.search_item_attribute_facets(
  p_taxonomy_id uuid,
  p_filters jsonb
)
returns table (
  attribute_id uuid,
  value text,
  sort_order integer,
  item_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with list_fields as (
    select links.attribute_id
    from public.taxonomy_attributes as links
    join public.attributes as fields on fields.id = links.attribute_id
    where links.taxonomy_id = p_taxonomy_id
      and fields.uses_list
  ),
  occurring as (
    select
      saved.attribute_id,
      coalesce(listed.value, btrim(saved.value)) as value,
      min(listed.sort_order) as sort_order
    from public.items as items
    join public.item_attributes as saved on saved.item_id = items.id
    join list_fields on list_fields.attribute_id = saved.attribute_id
    left join lateral (
      select options.value, options.sort_order
      from public.attribute_values as options
      where options.attribute_id = saved.attribute_id
        and lower(options.value) = lower(btrim(saved.value))
      order by options.sort_order, options.value
      limit 1
    ) as listed on true
    where items.taxonomy_id = p_taxonomy_id
      and btrim(saved.value) <> ''
    group by saved.attribute_id, coalesce(listed.value, btrim(saved.value))
  ),
  counted as (
    select
      list_fields.attribute_id,
      coalesce(listed.value, btrim(saved.value)) as value,
      count(*)::bigint as item_count
    from list_fields
    join lateral public.item_attribute_match_ids(
      p_taxonomy_id,
      jsonb_strip_nulls(jsonb_build_object(
        'lists', coalesce(p_filters -> 'lists', '{}'::jsonb) - list_fields.attribute_id::text,
        'ranges', coalesce(p_filters -> 'ranges', '{}'::jsonb) - list_fields.attribute_id::text,
        'exclude_id', p_filters -> 'exclude_id',
        'seed', coalesce(p_filters -> 'seed', '{}'::jsonb)
      ))
    ) as matched(item_id) on true
    join public.item_attributes as saved
      on saved.item_id = matched.item_id
     and saved.attribute_id = list_fields.attribute_id
    left join lateral (
      select options.value
      from public.attribute_values as options
      where options.attribute_id = saved.attribute_id
        and lower(options.value) = lower(btrim(saved.value))
      order by options.sort_order, options.value
      limit 1
    ) as listed on true
    where btrim(saved.value) <> ''
    group by list_fields.attribute_id, coalesce(listed.value, btrim(saved.value))
  )
  select
    occurring.attribute_id,
    occurring.value,
    occurring.sort_order,
    coalesce(counted.item_count, 0)::bigint as item_count
  from occurring
  left join counted
    on counted.attribute_id = occurring.attribute_id
   and counted.value = occurring.value
  order by occurring.attribute_id, occurring.sort_order nulls last, occurring.value;
$$;

revoke all on function public.attribute_value_matches(text, text) from public, anon, authenticated, service_role;
revoke all on function public.item_attribute_match_ids(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.search_items_by_attributes(uuid, jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.search_item_attribute_facets(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.search_items_by_attributes(uuid, jsonb, integer, integer) to service_role;
grant execute on function public.search_item_attribute_facets(uuid, jsonb) to service_role;

comment on function public.search_items_by_attributes(uuid, jsonb, integer, integer) is
  'Items in a taxonomy whose attributes match the list and range filters. match_count is how many seed values the item still has. No price columns.';

comment on function public.search_item_attribute_facets(uuid, jsonb) is
  'List-attribute values that occur on items of a taxonomy, with counts after the other filters. A value with no remaining matches is returned with item_count 0.';

notify pgrst, 'reload schema';
