-- A finished pick stays editable.
-- Finish still closes the list (picked or short) and still does not change a
-- shipped order. Corrections — another bin, a quantity, a short, a serial —
-- are allowed on that same list while the sales order can still be picked.
-- An unbalanced correction reopens the list so packing does not treat it as
-- finished. A correction that stays in balance leaves the list finished.
-- Cancelled lists stay closed. The finish function still requires status
-- open, so Finish is not clicked twice on a list that is already closed.
--
-- Apply by hand on project fxsbpreasbdalwthyzvk after
-- supabase/migrations/20261104183000_pick_shipped_orders.sql.
-- The filename sorts earlier than that file. On a database that replays every
-- migration, this patch still composes: it only widens the pick-list status
-- check, and the shipped-order patch widens the sales-order status check.
-- Deploying does not run this file.

create or replace function public.so_pick_list_editable(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('open', 'picked', 'short');
$$;

comment on function public.so_pick_list_editable(text) is
  'True when a pick list can still be corrected: open, picked, or short. Cancelled is false. Finish is a separate step and still requires open.';

revoke all on function public.so_pick_list_editable(text) from public, anon, authenticated;

create or replace function public.so_sync_finished_pick_list()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list uuid;
  v_status text;
  v_order uuid;
  v_block text;
  v_short boolean;
  v_next text;
begin
  v_list := case when tg_op = 'DELETE' then old.pick_list_id else new.pick_list_id end;
  select status, sales_order_id
  into v_status, v_order
  from public.so_pick_lists
  where id = v_list
  for update;

  if v_status is null or v_status not in ('picked', 'short') then
    return null;
  end if;

  v_block := public.so_pick_finish_block(v_list);
  if v_block is not null then
    update public.so_pick_lists
    set status = 'open',
        finished_at = null
    where id = v_list;
    return null;
  end if;

  select exists (
    select 1
    from public.so_lines l
    join public.so_line_allocations a on a.so_line_id = l.id
    join public.items i on i.id = a.item_id
    where l.sales_order_id = v_order
      and public.so_pick_sheet_place(l.line_kind, i.item_type) = 'pick'
      and (
        select coalesce(sum(p.qty_picked), 0)
        from public.so_picks p
        where p.pick_list_id = v_list
          and p.allocation_id = a.id
      ) < a.qty
  ) into v_short;

  v_next := case when v_short then 'short' else 'picked' end;
  if v_status is distinct from v_next then
    update public.so_pick_lists
    set status = v_next
    where id = v_list;
  end if;

  return null;
end;
$$;

comment on function public.so_sync_finished_pick_list() is
  'After a pick row changes on a finished list, reopen it when the sheet is no longer in balance. A balanced correction stays picked or short.';

revoke all on function public.so_sync_finished_pick_list() from public, anon, authenticated;

drop trigger if exists so_picks_sync_finished_list on public.so_picks;

create trigger so_picks_sync_finished_list
after insert or update or delete on public.so_picks
for each row
execute function public.so_sync_finished_pick_list();

do $patch$
declare
  v_name text;
  v_def text;
  v_next text;
  v_old text;
  v_new text;
begin
  v_old := $old$
  if v_status is distinct from 'open' then
    raise exception 'This pick sheet is already finished.'
      using errcode = '22023';
  end if;$old$;

  v_new := $new$
  if not public.so_pick_list_editable(v_status) then
    raise exception 'This pick sheet is already finished.'
      using errcode = '22023';
  end if;$new$;

  for v_name in
    select unnest(array['record_pick_serial', 'remove_pick_serial', 'undo_sales_order_pick'])
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = v_name;

    if v_def is null then
      raise exception '% is missing.', v_name;
    end if;
    if v_def like '%so_pick_list_editable(v_status)%' then
      continue;
    end if;
    if position(v_old in v_def) = 0 then
      raise exception '% does not refuse a finished pick the way this patch expects.', v_name;
    end if;
    v_next := replace(v_def, v_old, v_new);
    execute v_next;
  end loop;

  v_old := $old$
  from public.so_pick_lists
  where sales_order_id = p_order
    and status = 'open'$old$;

  v_new := $new$
  from public.so_pick_lists
  where sales_order_id = p_order
    and public.so_pick_list_editable(status)$new$;

  for v_name in
    select unnest(array['pick_sales_order_line', 'record_pulled_serial', 'set_pick_short'])
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = v_name;

    if v_def is null then
      raise exception '% is missing.', v_name;
    end if;
    if v_def like '%so_pick_list_editable(status)%' then
      continue;
    end if;
    if position(v_old in v_def) = 0 then
      raise exception '% does not select an open pick list the way this patch expects.', v_name;
    end if;
    v_next := replace(v_def, v_old, v_new);
    execute v_next;
  end loop;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'assign_pick_staging_bin';

  if v_def is null then
    raise exception 'assign_pick_staging_bin is missing.';
  end if;
  if v_def not like '%so_pick_list_editable(v_list_status)%' then
    v_old := 'v_list is null or v_list_status is distinct from ''open''';
    v_new := 'v_list is null or not public.so_pick_list_editable(v_list_status)';
    if position(v_old in v_def) = 0 then
      raise exception 'assign_pick_staging_bin does not require an open list the way this patch expects.';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end
$patch$;

comment on function public.record_pick_serial(uuid, text, text, uuid, text) is
  'Attaches one optional serial to a pick and links it to a stock unit. A pick with no warehouse bin issues the unit on that pick (Pulled). A finished list can still take the serial. Country of origin is optional.';

comment on function public.pick_sales_order_line(uuid, uuid, uuid, integer, text, uuid, text, uuid, text) is
  'Moves a quantity of the fulfilled SKU out of a stock bin. Works on an open, picked, or short list. A shipped or partially shipped order uses this same movement and stays that status.';

notify pgrst, 'reload schema';
