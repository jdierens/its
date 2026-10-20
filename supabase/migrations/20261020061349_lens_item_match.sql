-- Lens candidate search. pg_trgm already lives in the extensions schema.
-- These indexes and the lookup function are additive. Row security is unchanged.

create index if not exists items_sku_trgm_idx
  on public.items using gin (sku extensions.gin_trgm_ops);

create index if not exists items_part_number_trgm_idx
  on public.items using gin (part_number extensions.gin_trgm_ops);

create index if not exists items_oem_part_number_trgm_idx
  on public.items using gin (oem_part_number extensions.gin_trgm_ops);

create index if not exists items_model_trgm_idx
  on public.items using gin (model extensions.gin_trgm_ops);

create index if not exists item_attributes_value_trgm_idx
  on public.item_attributes using gin (value extensions.gin_trgm_ops);

create or replace function public.lens_item_candidates(p_needles text[])
returns table (
  id uuid,
  sku text,
  name text,
  part_number text,
  oem_part_number text,
  model text,
  manufacturer_name text,
  taxonomy_name text,
  spec_code text,
  quantity bigint,
  sku_similarity real,
  part_similarity real,
  oem_similarity real,
  model_similarity real,
  spec_similarity real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with needles as (
    select distinct btrim(needle) as needle
    from unnest(coalesce(p_needles, array[]::text[])) as needle
    where char_length(btrim(needle)) >= 3
    limit 12
  )
  select
    i.id,
    i.sku,
    i.name,
    i.part_number,
    i.oem_part_number,
    i.model,
    makers.name as manufacturer_name,
    taxes.name as taxonomy_name,
    spec.value as spec_code,
    i.quantity,
    max(extensions.similarity(coalesce(i.sku, ''), n.needle))::real as sku_similarity,
    max(extensions.similarity(coalesce(i.part_number, ''), n.needle))::real as part_similarity,
    max(extensions.similarity(coalesce(i.oem_part_number, ''), n.needle))::real as oem_similarity,
    max(extensions.similarity(coalesce(i.model, ''), n.needle))::real as model_similarity,
    max(extensions.similarity(coalesce(spec.value, ''), n.needle))::real as spec_similarity
  from public.items as i
  cross join needles as n
  left join public.manufacturers as makers on makers.id = i.manufacturer_id
  left join public.taxonomies as taxes on taxes.id = i.taxonomy_id
  left join lateral (
    select saved.value
    from public.item_attributes as saved
    join public.attributes as field on field.id = saved.attribute_id
    where saved.item_id = i.id
      and lower(field.name) = 'spec code'
    limit 1
  ) as spec on true
  where i.sku operator(extensions.%) n.needle
     or i.part_number operator(extensions.%) n.needle
     or i.oem_part_number operator(extensions.%) n.needle
     or i.model operator(extensions.%) n.needle
     or spec.value operator(extensions.%) n.needle
     or upper(regexp_replace(coalesce(i.sku, ''), '[^[:alnum:]]', '', 'g')) = upper(regexp_replace(n.needle, '[^[:alnum:]]', '', 'g'))
     or upper(regexp_replace(coalesce(i.part_number, ''), '[^[:alnum:]]', '', 'g')) = upper(regexp_replace(n.needle, '[^[:alnum:]]', '', 'g'))
     or upper(regexp_replace(coalesce(i.oem_part_number, ''), '[^[:alnum:]]', '', 'g')) = upper(regexp_replace(n.needle, '[^[:alnum:]]', '', 'g'))
     or upper(regexp_replace(coalesce(i.model, ''), '[^[:alnum:]]', '', 'g')) = upper(regexp_replace(n.needle, '[^[:alnum:]]', '', 'g'))
     or upper(regexp_replace(coalesce(spec.value, ''), '[^[:alnum:]]', '', 'g')) = upper(regexp_replace(n.needle, '[^[:alnum:]]', '', 'g'))
  group by i.id, i.sku, i.name, i.part_number, i.oem_part_number, i.model, makers.name, taxes.name, spec.value, i.quantity
  order by greatest(
    max(extensions.similarity(coalesce(i.sku, ''), n.needle)),
    max(extensions.similarity(coalesce(i.part_number, ''), n.needle)),
    max(extensions.similarity(coalesce(i.oem_part_number, ''), n.needle)),
    max(extensions.similarity(coalesce(i.model, ''), n.needle)),
    max(extensions.similarity(coalesce(spec.value, ''), n.needle))
  ) desc
  limit 40;
$$;

comment on function public.lens_item_candidates(text[]) is
  'Candidate items for Lens. Exact and trigram matches on sku, part number, OEM part number, model, and Spec Code. Does not change row security.';

revoke all on function public.lens_item_candidates(text[]) from public;
grant execute on function public.lens_item_candidates(text[]) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
