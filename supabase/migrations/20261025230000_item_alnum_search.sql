-- Punctuation-insensitive item find.
-- NOT APPLIED. Review this file and apply it in the SQL editor.
-- Find keeps its ilike path. This adds a second match: strip every character
-- that is not a letter or digit, then the query and the field match when
-- those strings contain each other. MCX-516A-CDAT finds
-- CARD\NIC\E30\100G_2Q\LP-FH\MCX516A-CDAT, and MCX516ACDAT finds the
-- hyphenated name. A stored value that sits inside a longer query must keep
-- at least 3 letters or digits, the same floor as a Find SKU longest word,
-- so a one-digit fragment does not match every query that contains it.
-- Adding the stored columns rewrites items and item_attributes. The columns
-- and the function are additive. Existing reads and writes stay valid until
-- this file is applied, and Find keeps the current contains search.

create or replace function public.normalize_alnum(p_value text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select lower(regexp_replace(p_value, '[^a-zA-Z0-9]', '', 'g'));
$$;

comment on function public.normalize_alnum(text) is
  'Lowercase letters and digits only. Hyphens, slashes, underscores, spaces, and other punctuation are removed.';

revoke all on function public.normalize_alnum(text) from public, anon, authenticated;
grant execute on function public.normalize_alnum(text) to service_role;

alter table public.items
  add column if not exists sku_alnum text generated always as (public.normalize_alnum(sku)) stored,
  add column if not exists name_alnum text generated always as (public.normalize_alnum(name)) stored,
  add column if not exists description_alnum text generated always as (public.normalize_alnum(description)) stored,
  add column if not exists model_alnum text generated always as (public.normalize_alnum(model)) stored,
  add column if not exists part_number_alnum text generated always as (public.normalize_alnum(part_number)) stored,
  add column if not exists oem_name_alnum text generated always as (public.normalize_alnum(oem_name)) stored,
  add column if not exists oem_part_number_alnum text generated always as (public.normalize_alnum(oem_part_number)) stored,
  add column if not exists product_url_alnum text generated always as (public.normalize_alnum(product_url)) stored;

comment on column public.items.sku_alnum is
  'SKU with punctuation removed, for find. Generated from sku.';
comment on column public.items.name_alnum is
  'Name with punctuation removed, for find. Generated from name.';
comment on column public.items.description_alnum is
  'Description with punctuation removed, for find. Generated from description.';
comment on column public.items.model_alnum is
  'Model with punctuation removed, for find. Generated from model.';
comment on column public.items.part_number_alnum is
  'Part number with punctuation removed, for find. Generated from part_number.';
comment on column public.items.oem_name_alnum is
  'OEM name with punctuation removed, for find. Generated from oem_name.';
comment on column public.items.oem_part_number_alnum is
  'OEM part number with punctuation removed, for find. Generated from oem_part_number.';
comment on column public.items.product_url_alnum is
  'Product URL with punctuation removed, for find. Generated from product_url.';

alter table public.item_attributes
  add column if not exists value_alnum text generated always as (public.normalize_alnum(value)) stored;

comment on column public.item_attributes.value_alnum is
  'Attribute value with punctuation removed, for find. Generated from value.';

-- pg_trgm already lives in the extensions schema.
create index if not exists items_sku_alnum_trgm_idx
  on public.items using gin (sku_alnum extensions.gin_trgm_ops);

create index if not exists items_name_alnum_trgm_idx
  on public.items using gin (name_alnum extensions.gin_trgm_ops);

create index if not exists items_description_alnum_trgm_idx
  on public.items using gin (description_alnum extensions.gin_trgm_ops);

create index if not exists items_model_alnum_trgm_idx
  on public.items using gin (model_alnum extensions.gin_trgm_ops);

create index if not exists items_part_number_alnum_trgm_idx
  on public.items using gin (part_number_alnum extensions.gin_trgm_ops);

create index if not exists items_oem_name_alnum_trgm_idx
  on public.items using gin (oem_name_alnum extensions.gin_trgm_ops);

create index if not exists items_oem_part_number_alnum_trgm_idx
  on public.items using gin (oem_part_number_alnum extensions.gin_trgm_ops);

create index if not exists items_product_url_alnum_trgm_idx
  on public.items using gin (product_url_alnum extensions.gin_trgm_ops);

create index if not exists item_attributes_value_alnum_trgm_idx
  on public.item_attributes using gin (value_alnum extensions.gin_trgm_ops);

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
  'Item ids for find after punctuation is removed. The normalized query and field match when either contains the other. A value inside a longer query must be at least 3 characters. Does not change row security.';

revoke all on function public.item_ids_matching_alnum(text, text[], boolean, uuid, integer) from public, anon, authenticated;
grant execute on function public.item_ids_matching_alnum(text, text[], boolean, uuid, integer) to service_role;

-- Derived search text is not an edited field. The audit still records sku, name, and the other source columns.
create or replace function public.log_item_field_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_by text := nullif(btrim(current_setting('its.changed_by', true)), '');
  v_batch text := nullif(btrim(current_setting('its.batch_id', true)), '');
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_op text := lower(tg_op);
  v_skip text[] := array[
    'updated_at', 'updated_by', 'created_at', 'created_by',
    'sku_alnum', 'name_alnum', 'description_alnum', 'model_alnum',
    'part_number_alnum', 'oem_name_alnum', 'oem_part_number_alnum', 'product_url_alnum'
  ];
begin
  if v_by is null then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'items' then
    v_old := to_jsonb(old) - v_skip;
    v_new := to_jsonb(new) - v_skip;
    for v_key in select jsonb_object_keys(v_new) loop
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        insert into public.item_field_edits
          (table_name, item_id, row_id, field, op, old_value, new_value, changed_by, batch_id)
        values
          ('items', new.id, new.id::text, v_key, v_op, v_old ->> v_key, v_new ->> v_key, v_by, v_batch);
      end if;
    end loop;
    return new;
  end if;

  if tg_table_name = 'item_attributes' then
    if tg_op = 'UPDATE' and old.value is not distinct from new.value then
      return new;
    end if;
    insert into public.item_field_edits
      (table_name, item_id, row_id, attribute_id, field, op, old_value, new_value, changed_by, batch_id)
    values
      ('item_attributes',
       coalesce(new.item_id, old.item_id),
       coalesce(new.item_id, old.item_id)::text || ':' || coalesce(new.attribute_id, old.attribute_id)::text,
       coalesce(new.attribute_id, old.attribute_id),
       'value', v_op,
       case when tg_op = 'INSERT' then null else old.value end,
       case when tg_op = 'DELETE' then null else new.value end,
       v_by, v_batch);
    return coalesce(new, old);
  end if;

  if tg_table_name = 'attribute_values' then
    if tg_op = 'UPDATE' and old.value is not distinct from new.value and old.sort_order is not distinct from new.sort_order then
      return new;
    end if;
    insert into public.item_field_edits
      (table_name, row_id, attribute_id, field, op, old_value, new_value, changed_by, batch_id)
    values
      ('attribute_values',
       coalesce(new.id, old.id)::text,
       coalesce(new.attribute_id, old.attribute_id),
       'value', v_op,
       case when tg_op = 'INSERT' then null else old.value || ' (sort ' || old.sort_order || ')' end,
       case when tg_op = 'DELETE' then null else new.value || ' (sort ' || new.sort_order || ')' end,
       v_by, v_batch);
    return coalesce(new, old);
  end if;

  return coalesce(new, old);
end;
$$;

notify pgrst, 'reload schema';
