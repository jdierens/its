-- Copy a vendor or a consignment flag across the receipts already entered
-- for one project. The receipt row stores both. A cycle and its stock units
-- keep the vendor and ownership they copied when they opened.
-- Recent entries reads the receipt. Apply by hand after
-- supabase/migrations/20261031060000_damaged_inventory.sql.
-- Not applied here.

create or replace function public.reject_stock_event_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and current_setting('its.receipt_owner', true) = 'true'
    and old.event_type = 'receive_into_bin'
    and new.event_type = old.event_type
    and (to_jsonb(old) - 'vendor_id' - 'ownership')
      = (to_jsonb(new) - 'vendor_id' - 'ownership')
  then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and old.event_type = 'receive_into_bin'
    and old.item_id is null
    and old.cycle_id is null
    and new.item_id is not null
    and new.cycle_id is not null
    and new.event_type = old.event_type
    and (
      to_jsonb(old) - 'item_id' - 'cycle_id' - 'bin_id' - 'to_location_id' - 'cleaned' - 'wiped'
    ) = (
      to_jsonb(new) - 'item_id' - 'cycle_id' - 'bin_id' - 'to_location_id' - 'cleaned' - 'wiped'
    )
  then
    return new;
  end if;
  raise exception 'Stock events cannot be changed.'
    using errcode = '55000';
end;
$$;

comment on function public.reject_stock_event_change() is
  'Stock events stay append-only. A pending receive can gain its item, cycle, bin, and prep flags once. While its.receipt_owner is set, a receive can change only its vendor and ownership.';

revoke all on function public.reject_stock_event_change() from public, anon, authenticated;
grant execute on function public.reject_stock_event_change() to service_role;

create or replace function public.receipt_effective_project(p_event_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when ed.new_values is null then nullif(btrim(e.project), '')
    else nullif(btrim(ed.new_values->>'project'), '')
  end
  from public.stock_events e
  left join lateral (
    select new_values
    from public.stock_event_edits
    where stock_event_id = e.id
    order by edited_at desc, id desc
    limit 1
  ) ed on true
  where e.id = p_event_id
    and e.event_type = 'receive_into_bin';
$$;

comment on function public.receipt_effective_project(uuid) is
  'Project Recent entries shows for one receipt. A correction wins over the project stored on the ledger row. Blank is not a project.';

revoke all on function public.receipt_effective_project(uuid) from public, anon, authenticated;
grant execute on function public.receipt_effective_project(uuid) to service_role;

create or replace function public.apply_receipt_owner(
  p_initials text,
  p_field text,
  p_vendor_id uuid,
  p_consigned boolean,
  p_event_id uuid,
  p_project text,
  p_apply_project boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_project text;
  v_span boolean := false;
  v_row record;
  v_new_vendor uuid;
  v_new_ownership text;
  v_latest jsonb;
  v_updated integer := 0;
begin
  if p_field not in ('vendor', 'consignment') then
    raise exception 'Choose a vendor or a consignment flag.'
      using errcode = '22023';
  end if;
  if p_field = 'vendor' then
    if p_vendor_id is null or not exists (select 1 from public.vendors where id = p_vendor_id) then
      raise exception 'Choose a vendor.'
        using errcode = '22023';
    end if;
  elsif p_consigned is null then
    raise exception 'Consignment is yes or no.'
      using errcode = '22023';
  end if;

  if p_event_id is not null then
    if not exists (
      select 1
      from public.stock_events
      where id = p_event_id
        and event_type = 'receive_into_bin'
    ) then
      raise exception 'That receipt is not in the ledger.'
        using errcode = 'P0002';
    end if;
    v_project := public.receipt_effective_project(p_event_id);
    v_span := coalesce(p_apply_project, false) and v_project is not null;
  else
    v_project := nullif(btrim(coalesce(p_project, '')), '');
    if v_project is null then
      raise exception 'Choose a project.'
        using errcode = '22023';
    end if;
    v_span := true;
  end if;

  perform set_config('its.receipt_owner', 'true', true);

  for v_row in
    select e.id, e.vendor_id, e.ownership
    from public.stock_events e
    where e.event_type = 'receive_into_bin'
      and (
        e.id = p_event_id
        or (
          v_span
          and public.receipt_effective_project(e.id) = v_project
          and e.id is distinct from p_event_id
        )
      )
    order by e.id
    for update
  loop
    v_new_vendor := case when p_field = 'vendor' then p_vendor_id else v_row.vendor_id end;
    v_new_ownership := case
      when p_field = 'consignment' then case when p_consigned then 'consigned' else 'owned' end
      else v_row.ownership
    end;
    if v_new_vendor is not distinct from v_row.vendor_id
      and v_new_ownership is not distinct from v_row.ownership then
      continue;
    end if;

    select ed.new_values into v_latest
    from public.stock_event_edits ed
    where ed.stock_event_id = v_row.id
    order by ed.edited_at desc, ed.id desc
    limit 1;

    if v_latest is not null then
      insert into public.stock_event_edits (
        stock_event_id,
        editor_initials,
        old_values,
        new_values
      ) values (
        v_row.id,
        v_initials,
        v_latest || jsonb_build_object('vendor_id', v_row.vendor_id, 'ownership', v_row.ownership),
        v_latest || jsonb_build_object('vendor_id', v_new_vendor, 'ownership', v_new_ownership)
      );
    end if;

    update public.stock_events
    set vendor_id = v_new_vendor,
        ownership = v_new_ownership
    where id = v_row.id;
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object('updated', v_updated, 'project', v_project, 'field', p_field);
end;
$$;

comment on function public.apply_receipt_owner(text, text, uuid, boolean, uuid, text, boolean) is
  'Sets the vendor or the consignment flag on one receipt. When asked, and the receipt has a project, the same value is copied onto the other receipts already entered for that project only. Vendor and consignment are updated separately. Cycles and stock units are left as they were opened.';

revoke all on function public.apply_receipt_owner(text, text, uuid, boolean, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.apply_receipt_owner(text, text, uuid, boolean, uuid, text, boolean) to service_role;

notify pgrst, 'reload schema';
