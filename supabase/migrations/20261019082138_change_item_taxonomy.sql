-- Additive. Lets an item move to another taxonomy without changing update_item.
-- The deployed app does not call change_item_taxonomy.
-- items.notes and taxonomy_attributes.required are new columns.
-- There is no item_history table, so the log is item_taxonomy_changes.
-- Applied on fxsbpreasbdalwthyzvk as version 20261019082138.

alter table public.items
  add column if not exists notes text;

alter table public.taxonomy_attributes
  add column if not exists required boolean not null default false;

create table if not exists public.item_taxonomy_changes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  old_taxonomy_id uuid,
  new_taxonomy_id uuid,
  old_short_code text,
  new_short_code text,
  removed_values jsonb not null default '[]'::jsonb,
  sku_before text,
  sku_after text,
  copied_notes boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists item_taxonomy_changes_item_id_idx
  on public.item_taxonomy_changes (item_id, created_at desc);

alter table public.item_taxonomy_changes disable row level security;

revoke all on table public.item_taxonomy_changes from public, anon, authenticated;
grant select, insert on table public.item_taxonomy_changes to anon, authenticated, service_role;

create or replace function public.change_item_taxonomy(
  p_id uuid,
  p_taxonomy_id uuid,
  p_copy_notes boolean default false,
  p_regenerate_sku boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.items%rowtype;
  v_old_code text;
  v_new_code text;
  v_removed jsonb;
  v_lines text;
  v_notes text;
  v_sku text;
  v_base text;
  v_suffix integer;
begin
  select * into v_row
  from public.items
  where id = p_id
  for update;

  if not found then
    raise exception 'That item is already gone.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.taxonomies where id = p_taxonomy_id) then
    raise exception 'Unknown taxonomy' using errcode = 'P0002';
  end if;

  if v_row.taxonomy_id is not distinct from p_taxonomy_id then
    raise exception 'This item is already on that taxonomy' using errcode = '22023';
  end if;

  select short_code into v_old_code from public.taxonomies where id = v_row.taxonomy_id;
  select short_code into v_new_code from public.taxonomies where id = p_taxonomy_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'attribute_id', fields.id,
           'name', fields.name,
           'value', saved.value
         ) order by links.sort_order, fields.name), '[]'::jsonb)
    into v_removed
  from public.item_attributes as saved
  join public.attributes as fields on fields.id = saved.attribute_id
  left join public.taxonomy_attributes as links
    on links.attribute_id = fields.id
   and links.taxonomy_id = v_row.taxonomy_id
  where saved.item_id = p_id
    and btrim(saved.value) <> ''
    and not exists (
      select 1
      from public.taxonomy_attributes as next_link
      where next_link.taxonomy_id = p_taxonomy_id
        and next_link.attribute_id = saved.attribute_id
    );

  v_notes := v_row.notes;
  if coalesce(p_copy_notes, false) and jsonb_array_length(v_removed) > 0 then
    select string_agg(entry.value ->> 'name' || ': ' || (entry.value ->> 'value'), E'\n' order by entry.ordinality)
      into v_lines
    from jsonb_array_elements(v_removed) with ordinality as entry(value, ordinality);
    if nullif(btrim(coalesce(v_notes, '')), '') is null then
      v_notes := v_lines;
    else
      v_notes := btrim(v_notes) || E'\n' || v_lines;
    end if;
  end if;

  v_sku := v_row.sku;
  if coalesce(p_regenerate_sku, false)
     and v_old_code is not null
     and v_new_code is not null
     and v_row.sku ~* ('(^|[^[:alpha:]])' || v_old_code || '($|[^[:alpha:]])') then
    v_base := regexp_replace(
      v_row.sku,
      '(^|[^[:alpha:]])' || v_old_code || '($|[^[:alpha:]])',
      '\1' || v_new_code || '\2',
      'gi'
    );
    v_sku := v_base;
    v_suffix := 2;
    while exists (
      select 1 from public.items where sku = v_sku and id <> p_id
    ) loop
      v_sku := v_base || '-' || v_suffix;
      v_suffix := v_suffix + 1;
      if v_suffix > 100 then
        raise exception 'Could not find an unused SKU' using errcode = '23505';
      end if;
    end loop;
  end if;

  delete from public.item_attributes as saved
  where saved.item_id = p_id
    and not exists (
      select 1
      from public.taxonomy_attributes as next_link
      where next_link.taxonomy_id = p_taxonomy_id
        and next_link.attribute_id = saved.attribute_id
    );

  update public.items
     set taxonomy_id = p_taxonomy_id,
         sku = v_sku,
         notes = v_notes
   where id = p_id;

  insert into public.item_taxonomy_changes (
    item_id,
    old_taxonomy_id,
    new_taxonomy_id,
    old_short_code,
    new_short_code,
    removed_values,
    sku_before,
    sku_after,
    copied_notes
  ) values (
    p_id,
    v_row.taxonomy_id,
    p_taxonomy_id,
    v_old_code,
    v_new_code,
    v_removed,
    v_row.sku,
    v_sku,
    coalesce(p_copy_notes, false) and jsonb_array_length(v_removed) > 0
  );

  return jsonb_build_object(
    'taxonomy_id', p_taxonomy_id,
    'sku', v_sku,
    'notes', coalesce(v_notes, ''),
    'removed', v_removed
  );
end;
$$;

comment on function public.change_item_taxonomy(uuid, uuid, boolean, boolean) is
  'Moves an item to another taxonomy, drops values the new taxonomy does not link, and logs the change. Not used for authorization.';

revoke all on function public.change_item_taxonomy(uuid, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.change_item_taxonomy(uuid, uuid, boolean, boolean) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
