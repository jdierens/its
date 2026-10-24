-- Migration: item_field_edits_item_inserts
-- Also log item creation (one row per new item) in item_field_edits when its.changed_by is set.

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

  if tg_table_name = 'items' and tg_op = 'INSERT' then
    insert into public.item_field_edits
      (table_name, item_id, row_id, field, op, old_value, new_value, changed_by, batch_id)
    values
      ('items', new.id, new.id::text, 'item', 'insert', null, new.sku || ' ' || new.name, v_by, v_batch);
    return new;
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


create trigger items_log_field_insert
after insert on public.items
for each row execute function public.log_item_field_edit();
