-- Tighten punctuation-insensitive attribute matches.
-- NOT APPLIED. Review this file and apply it by hand in the SQL editor
-- after 20261025230000_item_alnum_search.sql. Deploy does not apply it.
-- A digits-only attribute (cache 96.0, size 0.96) no longer matches by
-- sitting inside a longer part number. Searching that value still finds
-- the attribute. SKU, name, and part-number matches are unchanged,
-- including MCX-516A-CDAT and MCX516ACDAT. This replaces the function
-- only. It does not add columns.

create or replace function public.item_ids_matching_alnum(
  p_query text,
  p_columns text[] default array['sku', 'name', 'description', 'model', 'part_number', 'oem_name', 'oem_part_number', 'product_url'],
  p_include_attributes boolean default false,
  p_taxonomy_id uuid default null,
  p_limit integer default 200
)
returns table (id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  with needle as (
    select public.normalize_alnum(left(coalesce(p_query, ''), 500)) as value
  ),
  bounds as (
    select greatest(1, least(coalesce(p_limit, 200), 1000))::integer as lim
  ),
  cols as (
    select coalesce(p_columns, array[]::text[]) as names
  ),
  hits as (
    select
      i.id,
      greatest(
        case
          when 'sku' = any (c.names) and i.sku_alnum like '%' || n.value || '%' then char_length(i.sku_alnum)
          else 0
        end,
        case
          when 'name' = any (c.names) and i.name_alnum like '%' || n.value || '%' then char_length(i.name_alnum)
          else 0
        end,
        case
          when 'description' = any (c.names) and i.description_alnum like '%' || n.value || '%' then char_length(i.description_alnum)
          else 0
        end,
        case
          when 'model' = any (c.names) and i.model_alnum like '%' || n.value || '%' then char_length(i.model_alnum)
          else 0
        end,
        case
          when 'part_number' = any (c.names) and i.part_number_alnum like '%' || n.value || '%' then char_length(i.part_number_alnum)
          else 0
        end,
        case
          when 'oem_name' = any (c.names) and i.oem_name_alnum like '%' || n.value || '%' then char_length(i.oem_name_alnum)
          else 0
        end,
        case
          when 'oem_part_number' = any (c.names) and i.oem_part_number_alnum like '%' || n.value || '%' then char_length(i.oem_part_number_alnum)
          else 0
        end,
        case
          when 'product_url' = any (c.names) and i.product_url_alnum like '%' || n.value || '%' then char_length(i.product_url_alnum)
          else 0
        end,
        case
          when 'sku' = any (c.names)
            and char_length(i.sku_alnum) >= 3
            and char_length(i.sku_alnum) < char_length(n.value)
            and n.value like '%' || i.sku_alnum || '%'
          then char_length(i.sku_alnum)
          else 0
        end,
        case
          when 'name' = any (c.names)
            and char_length(i.name_alnum) >= 3
            and char_length(i.name_alnum) < char_length(n.value)
            and n.value like '%' || i.name_alnum || '%'
          then char_length(i.name_alnum)
          else 0
        end,
        case
          when 'description' = any (c.names)
            and char_length(i.description_alnum) >= 3
            and char_length(i.description_alnum) < char_length(n.value)
            and n.value like '%' || i.description_alnum || '%'
          then char_length(i.description_alnum)
          else 0
        end,
        case
          when 'model' = any (c.names)
            and char_length(i.model_alnum) >= 3
            and char_length(i.model_alnum) < char_length(n.value)
            and n.value like '%' || i.model_alnum || '%'
          then char_length(i.model_alnum)
          else 0
        end,
        case
          when 'part_number' = any (c.names)
            and char_length(i.part_number_alnum) >= 3
            and char_length(i.part_number_alnum) < char_length(n.value)
            and n.value like '%' || i.part_number_alnum || '%'
          then char_length(i.part_number_alnum)
          else 0
        end,
        case
          when 'oem_name' = any (c.names)
            and char_length(i.oem_name_alnum) >= 3
            and char_length(i.oem_name_alnum) < char_length(n.value)
            and n.value like '%' || i.oem_name_alnum || '%'
          then char_length(i.oem_name_alnum)
          else 0
        end,
        case
          when 'oem_part_number' = any (c.names)
            and char_length(i.oem_part_number_alnum) >= 3
            and char_length(i.oem_part_number_alnum) < char_length(n.value)
            and n.value like '%' || i.oem_part_number_alnum || '%'
          then char_length(i.oem_part_number_alnum)
          else 0
        end,
        case
          when 'product_url' = any (c.names)
            and char_length(i.product_url_alnum) >= 3
            and char_length(i.product_url_alnum) < char_length(n.value)
            and n.value like '%' || i.product_url_alnum || '%'
          then char_length(i.product_url_alnum)
          else 0
        end
      ) as match_len
    from public.items as i
    cross join needle as n
    cross join cols as c
    where char_length(n.value) >= 3
      and (p_taxonomy_id is null or i.taxonomy_id = p_taxonomy_id)
      and (
        ('sku' = any (c.names) and i.sku_alnum like '%' || n.value || '%')
        or ('name' = any (c.names) and i.name_alnum like '%' || n.value || '%')
        or ('description' = any (c.names) and i.description_alnum like '%' || n.value || '%')
        or ('model' = any (c.names) and i.model_alnum like '%' || n.value || '%')
        or ('part_number' = any (c.names) and i.part_number_alnum like '%' || n.value || '%')
        or ('oem_name' = any (c.names) and i.oem_name_alnum like '%' || n.value || '%')
        or ('oem_part_number' = any (c.names) and i.oem_part_number_alnum like '%' || n.value || '%')
        or ('product_url' = any (c.names) and i.product_url_alnum like '%' || n.value || '%')
        or (
          'sku' = any (c.names)
          and char_length(i.sku_alnum) >= 3
          and char_length(i.sku_alnum) < char_length(n.value)
          and n.value like '%' || i.sku_alnum || '%'
        )
        or (
          'name' = any (c.names)
          and char_length(i.name_alnum) >= 3
          and char_length(i.name_alnum) < char_length(n.value)
          and n.value like '%' || i.name_alnum || '%'
        )
        or (
          'description' = any (c.names)
          and char_length(i.description_alnum) >= 3
          and char_length(i.description_alnum) < char_length(n.value)
          and n.value like '%' || i.description_alnum || '%'
        )
        or (
          'model' = any (c.names)
          and char_length(i.model_alnum) >= 3
          and char_length(i.model_alnum) < char_length(n.value)
          and n.value like '%' || i.model_alnum || '%'
        )
        or (
          'part_number' = any (c.names)
          and char_length(i.part_number_alnum) >= 3
          and char_length(i.part_number_alnum) < char_length(n.value)
          and n.value like '%' || i.part_number_alnum || '%'
        )
        or (
          'oem_name' = any (c.names)
          and char_length(i.oem_name_alnum) >= 3
          and char_length(i.oem_name_alnum) < char_length(n.value)
          and n.value like '%' || i.oem_name_alnum || '%'
        )
        or (
          'oem_part_number' = any (c.names)
          and char_length(i.oem_part_number_alnum) >= 3
          and char_length(i.oem_part_number_alnum) < char_length(n.value)
          and n.value like '%' || i.oem_part_number_alnum || '%'
        )
        or (
          'product_url' = any (c.names)
          and char_length(i.product_url_alnum) >= 3
          and char_length(i.product_url_alnum) < char_length(n.value)
          and n.value like '%' || i.product_url_alnum || '%'
        )
      )

    union all

    select
      saved.item_id,
      char_length(saved.value_alnum) as match_len
    from public.item_attributes as saved
    join public.items as i on i.id = saved.item_id
    cross join needle as n
    where p_include_attributes
      and char_length(n.value) >= 3
      and (p_taxonomy_id is null or i.taxonomy_id = p_taxonomy_id)
      and (
        saved.value_alnum like '%' || n.value || '%'
        or (
          char_length(saved.value_alnum) >= 3
          and char_length(saved.value_alnum) < char_length(n.value)
          and saved.value_alnum ~ '[a-z]'
          and n.value like '%' || saved.value_alnum || '%'
        )
      )
  )
  select numbered.id
  from (
    select
      grouped.id,
      row_number() over (order by grouped.match_len desc, grouped.id) as rn,
      bounds.lim
    from (
      select hits.id, max(hits.match_len) as match_len
      from hits
      group by hits.id
    ) as grouped
    cross join bounds
  ) as numbered
  where numbered.rn <= numbered.lim;
$$;

comment on function public.item_ids_matching_alnum(text, text[], boolean, uuid, integer) is
  'Item ids for find after punctuation is removed. The normalized query and field match when either contains the other. A value inside a longer query must be at least 3 characters. A digits-only attribute does not match that way. Does not change row security.';

revoke all on function public.item_ids_matching_alnum(text, text[], boolean, uuid, integer) from public, anon, authenticated;
grant execute on function public.item_ids_matching_alnum(text, text[], boolean, uuid, integer) to service_role;

notify pgrst, 'reload schema';
