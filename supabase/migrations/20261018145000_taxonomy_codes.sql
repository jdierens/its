-- Taxonomy long/short codes and display order.
-- Codes are stored uppercase. short_code is exactly 3 letters or digits.
-- Nullable so a row can exist before codes are assigned; every seeded taxonomy has both.

alter table public.taxonomies
  add column long_code text,
  add column short_code text,
  add column sort_order integer;

create or replace function public.taxonomies_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);

  if new.long_code is not null then
    new.long_code := nullif(upper(btrim(new.long_code)), '');
  end if;

  if new.short_code is not null then
    new.short_code := nullif(upper(btrim(new.short_code)), '');
  end if;

  if new.sort_order is null then
    select coalesce(max(sort_order), 0) + 1
      into new.sort_order
    from public.taxonomies;
  end if;

  return new;
end;
$$;

drop trigger if exists taxonomies_normalize on public.taxonomies;

create trigger taxonomies_normalize
before insert or update on public.taxonomies
for each row
execute function public.taxonomies_normalize();

-- Proposed codes, grouped compute → storage → network. Review and edit on /taxonomies.
update public.taxonomies as taxonomy
set
  long_code = seed.long_code,
  short_code = seed.short_code,
  sort_order = seed.sort_order
from (
  values
    ('server', 'SYS/SRV', 'SRV', 1),
    ('memory', 'DIM/MEM', 'MEM', 2),
    ('HDD', 'DSK/HDD', 'HDD', 3),
    ('SSD', 'DSK/SSD', 'SSD', 4),
    ('network card', 'CRD/NIC', 'NIC', 5),
    ('HBA card', 'CRD/HBA', 'HBA', 6),
    ('transceiver', 'OPT/TRX', 'TRX', 7),
    ('switch', 'NET/SWT', 'SWT', 8),
    ('network cable', 'NET/CBL', 'CBL', 9)
) as seed (name, long_code, short_code, sort_order)
where lower(taxonomy.name) = lower(seed.name);

with unseeded as (
  select
    id,
    row_number() over (order by lower(name), id)
      + coalesce((select max(sort_order) from public.taxonomies), 0) as next_order
  from public.taxonomies
  where sort_order is null
)
update public.taxonomies as taxonomy
set sort_order = unseeded.next_order
from unseeded
where taxonomy.id = unseeded.id;

alter table public.taxonomies
  add constraint taxonomies_long_code_upper
    check (long_code = upper(long_code)),
  add constraint taxonomies_long_code_shape
    check (long_code is null or long_code ~ '^[A-Z0-9]+(/[A-Z0-9]+)*$'),
  add constraint taxonomies_short_code_format
    check (short_code is null or short_code ~ '^[A-Z0-9]{3}$'),
  add constraint taxonomies_long_code_key unique (long_code),
  add constraint taxonomies_short_code_key unique (short_code),
  alter column sort_order set not null;

create index taxonomies_sort_order_idx on public.taxonomies (sort_order, lower(name));

create or replace function public.insert_taxonomy(
  p_name text,
  p_long_code text,
  p_short_code text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_long text;
  v_short text;
begin
  v_long := nullif(upper(btrim(coalesce(p_long_code, ''))), '');
  v_short := nullif(upper(btrim(coalesce(p_short_code, ''))), '');

  if v_long is null or v_short is null then
    raise exception 'A new taxonomy needs a long code and a 3-character short code'
      using errcode = '22023';
  end if;

  if v_long !~ '^[A-Z0-9]+(/[A-Z0-9]+)*$' then
    raise exception 'Long code must be uppercase letters, digits, and slashes, like CRD/NIC'
      using errcode = '22023';
  end if;

  if v_short !~ '^[A-Z0-9]{3}$' then
    raise exception 'Short code must be exactly 3 letters or digits'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.taxonomies where long_code = v_long) then
    raise exception 'Long code % is already used', v_long using errcode = '23505';
  end if;

  if exists (select 1 from public.taxonomies where short_code = v_short) then
    raise exception 'Short code % is already used', v_short using errcode = '23505';
  end if;

  insert into public.taxonomies (name, long_code, short_code)
  values (p_name, v_long, v_short)
  returning id into v_id;

  return v_id;
end;
$$;

drop function public.create_item(text, text, jsonb, text, text, bigint, jsonb);
drop function public.update_item(uuid, text, text, jsonb, text, text, bigint, jsonb);

create or replace function public.create_item(
  p_name text,
  p_taxonomy text,
  p_attributes jsonb,
  p_sku text,
  p_description text,
  p_quantity bigint,
  p_attribute_defs jsonb default '[]'::jsonb,
  p_long_code text default null,
  p_short_code text default null
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

  insert into public.items (sku, name, description, taxonomy_id, quantity)
  values (
    coalesce(p_sku, ''),
    btrim(p_name),
    coalesce(p_description, ''),
    v_taxonomy_id,
    p_quantity
  )
  returning id into v_item_id;

  insert into public.item_attributes (item_id, attribute_id, value)
  select v_item_id, a.id, entry.value
  from jsonb_each_text(v_cleaned) as entry (key, value)
  join public.attributes a
    on a.taxonomy_id = v_taxonomy_id
   and a.name = entry.key;

  return v_item_id;
end;
$$;

create or replace function public.update_item(
  p_id uuid,
  p_name text,
  p_taxonomy text,
  p_attributes jsonb,
  p_sku text,
  p_description text,
  p_quantity bigint,
  p_attribute_defs jsonb default '[]'::jsonb,
  p_long_code text default null,
  p_short_code text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_taxonomy_id uuid;
  v_taxonomy_name text;
  v_cleaned jsonb := '{}'::jsonb;
begin
  if p_id is null or not exists (select 1 from public.items where id = p_id) then
    raise exception 'Unknown item: %', p_id using errcode = 'P0002';
  end if;

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

  update public.items
  set
    sku = coalesce(p_sku, ''),
    name = btrim(p_name),
    description = coalesce(p_description, ''),
    taxonomy_id = v_taxonomy_id,
    quantity = p_quantity
  where id = p_id;

  delete from public.item_attributes
  where item_id = p_id;

  insert into public.item_attributes (item_id, attribute_id, value)
  select p_id, a.id, entry.value
  from jsonb_each_text(v_cleaned) as entry (key, value)
  join public.attributes a
    on a.taxonomy_id = v_taxonomy_id
   and a.name = entry.key;

  return p_id;
end;
$$;

revoke all on function public.insert_taxonomy(text, text, text) from public;
grant execute on function public.insert_taxonomy(text, text, text) to anon, authenticated, service_role;
grant execute on function public.create_item(text, text, jsonb, text, text, bigint, jsonb, text, text) to anon, authenticated, service_role;
grant execute on function public.update_item(uuid, text, text, jsonb, text, text, bigint, jsonb, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
