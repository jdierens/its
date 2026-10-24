-- Migration: item_field_edits
-- Per-field audit of item data written outside the app (research bots, SQL fixes).
-- Triggers log a change only when the writing session sets its.changed_by:
--   select set_config('its.changed_by', 'Benjamin', true);
--   select set_config('its.batch_id', 'swi-pilot-1', true);   -- optional
-- App edits (no its.changed_by) are not logged, so normal saves add no noise.

create table public.item_field_edits (
  id bigint generated always as identity primary key,
  table_name text not null,
  item_id uuid,
  row_id text,
  attribute_id uuid,
  field text not null,
  op text not null,
  old_value text,
  new_value text,
  changed_by text not null,
  batch_id text,
  changed_at timestamptz not null default now(),
  constraint item_field_edits_table_known check (table_name in ('items', 'item_attributes', 'attribute_values')),
  constraint item_field_edits_op_known check (op in ('insert', 'update', 'delete')),
  constraint item_field_edits_changed_by_present check (char_length(btrim(changed_by)) > 0)
);

create index item_field_edits_item_idx on public.item_field_edits (item_id, changed_at desc);
create index item_field_edits_batch_idx on public.item_field_edits (batch_id) where batch_id is not null;
create index item_field_edits_attribute_idx on public.item_field_edits (attribute_id) where attribute_id is not null;

comment on table public.item_field_edits is
  'Append-only per-field audit of item data written outside the app. Filled by triggers on items, item_attributes and attribute_values when the session sets its.changed_by (and optionally its.batch_id).';

alter table public.item_field_edits enable row level security;
revoke all on table public.item_field_edits from public, anon, authenticated;
grant select, insert on table public.item_field_edits to service_role;

-- Append-only.
create or replace function public.reject_item_field_edit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'item_field_edits is append-only';
end;
$$;

create trigger item_field_edits_append_only
before update or delete on public.item_field_edits
for each row execute function public.reject_item_field_edit_change();

-- Logger for all three tables.
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
begin
  if v_by is null then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'items' then
    v_old := to_jsonb(old) - array['updated_at', 'updated_by', 'created_at', 'created_by'];
    v_new := to_jsonb(new) - array['updated_at', 'updated_by', 'created_at', 'created_by'];
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

comment on function public.log_item_field_edit() is
  'Writes one item_field_edits row per changed field when its.changed_by is set for the session; does nothing otherwise.';

create trigger items_log_field_edit
after update on public.items
for each row execute function public.log_item_field_edit();

create trigger item_attributes_log_field_edit
after insert or update or delete on public.item_attributes
for each row execute function public.log_item_field_edit();

create trigger attribute_values_log_field_edit
after insert or update or delete on public.attribute_values
for each row execute function public.log_item_field_edit();

revoke all on function public.log_item_field_edit() from public, anon, authenticated;
revoke all on function public.reject_item_field_edit_change() from public, anon, authenticated;
grant execute on function public.log_item_field_edit() to service_role;
grant execute on function public.reject_item_field_edit_change() to service_role;
