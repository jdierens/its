-- A finished pack stays editable.
-- Finish still stores packed_at, and an order that is still packing still
-- becomes packed. Corrections — another bin, a weight, a height, a quantity —
-- are allowed after that. A correction that leaves the sheet incomplete
-- reopens packing: a packed order goes back to packing and packed_at is
-- cleared, so shipping does not treat it as ready. A shipped or partially
-- shipped order keeps that status, the ship date, and the shipment rows, and
-- only packed_at is cleared. A correction that stays complete leaves the pack
-- finished. Cancelled, invoiced, and closed stay closed.
-- Finish on a pack that is already finished and still complete does not log a
-- second finish. Finish after a reopen checks completeness again.
--
-- Apply by hand on project fxsbpreasbdalwthyzvk after
-- supabase/migrations/20261102143000_pack_shipped_orders.sql and
-- supabase/migrations/20261104183000_pick_shipped_orders.sql.
-- Deploying does not run this file.

create or replace function public.so_packing_writable(p_status text, p_packed_at timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- p_packed_at stays in the signature callers already use. It does not lock the sheet.
  select p_status in ('packing', 'packed', 'shipped', 'partially_shipped');
$$;

comment on function public.so_packing_writable(text, timestamptz) is
  'True while bins can be corrected: packing, packed, shipped, or partially shipped. packed_at does not close the sheet. Cancelled, invoiced, and closed stay false.';

revoke all on function public.so_packing_writable(text, timestamptz) from public, anon, authenticated;

comment on function public.so_require_packing(uuid) is
  'Locks the order and allows packing edits while status is packing or packed, or while status is shipped or partially_shipped, including after packed_at is set. A status other than packing also needs a finished pick. Does not change status, ship_date, or so_shipments.';

create or replace function public.so_reopen_finished_pack(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_packed timestamptz;
  v_block text;
begin
  if p_order is null then
    return;
  end if;

  select status, packed_at into v_status, v_packed
  from public.sales_orders
  where id = p_order
  for update;

  if v_status is null then
    return;
  end if;

  if v_status is distinct from 'packed'
    and not (v_status in ('shipped', 'partially_shipped') and v_packed is not null) then
    return;
  end if;

  v_block := public.so_pack_finish_block(p_order);
  if v_block is null then
    return;
  end if;

  -- shipped catch-up stays shipped
  if v_status in ('shipped', 'partially_shipped') then
    update public.sales_orders
    set packed_at = null,
        updated_at = now()
    where id = p_order;
    return;
  end if;

  update public.sales_orders
  set status = 'packing',
      packed_at = null,
      updated_at = now()
  where id = p_order
    and status = 'packed';
end;
$$;

comment on function public.so_reopen_finished_pack(uuid) is
  'After a bin or a quantity changes, reopen a finished pack that is no longer complete. A packed order returns to packing. A shipped or partially shipped order stays that status. ship_date and so_shipments are not updated.';

revoke all on function public.so_reopen_finished_pack(uuid) from public, anon, authenticated;

create or replace function public.so_sync_finished_pack()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_other uuid;
begin
  if tg_table_name = 'so_packages' then
    v_order := case when tg_op = 'DELETE' then old.sales_order_id else new.sales_order_id end;
    if tg_op = 'UPDATE' and old.sales_order_id is distinct from new.sales_order_id then
      v_other := old.sales_order_id;
    end if;
  else
    select pkg.sales_order_id into v_order
    from public.so_packages pkg
    where pkg.id = case when tg_op = 'DELETE' then old.package_id else new.package_id end;

    if tg_op = 'UPDATE' and old.package_id is distinct from new.package_id then
      select pkg.sales_order_id into v_other
      from public.so_packages pkg
      where pkg.id = old.package_id;
    end if;
  end if;

  perform public.so_reopen_finished_pack(v_order);
  if v_other is not null and v_other is distinct from v_order then
    perform public.so_reopen_finished_pack(v_other);
  end if;

  return null;
end;
$$;

comment on function public.so_sync_finished_pack() is
  'After a shipping bin or a packed quantity changes, reopen the pack when the sheet is no longer complete.';

revoke all on function public.so_sync_finished_pack() from public, anon, authenticated;

drop trigger if exists so_packages_sync_finished_pack on public.so_packages;
create trigger so_packages_sync_finished_pack
after insert or update or delete on public.so_packages
for each row
execute function public.so_sync_finished_pack();

drop trigger if exists so_package_contents_sync_finished_pack on public.so_package_contents;
create trigger so_package_contents_sync_finished_pack
after insert or update or delete on public.so_package_contents
for each row
execute function public.so_sync_finished_pack();

do $patch$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'sales_order_pack_sheet'
    and pg_get_function_identity_arguments(p.oid) = 'uuid';

  if v_def is null then
    raise exception 'sales_order_pack_sheet is missing.';
  end if;

  v_old := $old$
  v_finish := case
    when v_order.status = 'packed' or v_order.packed_at is not null then null
    when v_order.status in ('cancelled', 'closed', 'invoiced') then null
    else public.so_pack_finish_block(p_order)
  end;$old$;

  v_new := $new$
  v_finish := case
    when v_order.status in ('cancelled', 'closed', 'invoiced') then null
    when public.so_packing_writable(v_order.status, v_order.packed_at)
      or v_order.status in ('shipped', 'partially_shipped')
      then public.so_pack_finish_block(p_order)
    else null
  end;$new$;

  if v_def like '%when public.so_packing_writable(v_order.status, v_order.packed_at)%' then
    null;
  elsif position(v_old in v_def) = 0 then
    raise exception 'sales_order_pack_sheet does not hide the finish block on a finished pack the way this patch expects.';
  else
    execute replace(v_def, v_old, v_new);
  end if;
end
$patch$;

comment on function public.sales_order_pack_sheet(uuid) is
  'Shipping bins and the picked stock lines for one sales order. editable stays true after packing finishes, including a shipped order, while the pick is still finished. finish_block says what is incomplete, including on a pack that was finished. Cancelled, invoiced, and closed stay closed. Freight, fees, services, and unpicked lines are left off. No prices.';

create or replace function public.finish_sales_order_pack(
  p_order uuid,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block text;
  v_status text;
  v_packed timestamptz;
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
begin
  perform public.so_require_packing(p_order);

  select status, packed_at into v_status, v_packed
  from public.sales_orders
  where id = p_order;

  v_block := public.so_pack_finish_block(p_order);

  -- Already finished and still complete. Leave status and packed_at alone.
  if v_block is null and (
    v_status = 'packed'
    or (v_status in ('shipped', 'partially_shipped') and v_packed is not null)
  ) then
    return public.sales_order_pack_sheet(p_order);
  end if;

  if v_block is not null then
    raise exception '%', v_block
      using errcode = '22023';
  end if;

  -- shipped catch-up finish
  if v_status in ('shipped', 'partially_shipped') then
    update public.sales_orders
    set packed_at = now(),
        updated_at = now()
    where id = p_order;

    perform public.log_so_event(
      p_order,
      'pack_finished',
      v_status,
      v_status,
      'Packed after shipping. Status stays ' || v_status || '.',
      v_operator,
      v_initials
    );
  elsif v_status = 'packing' then
    update public.sales_orders
    set status = 'packed',
        packed_at = now(),
        updated_at = now()
    where id = p_order;

    perform public.log_so_event(
      p_order,
      'pack_finished',
      'packing',
      'packed',
      null,
      v_operator,
      v_initials
    );
  else
    raise exception 'Packing is closed on this sales order.'
      using errcode = '22023';
  end if;

  return public.sales_order_pack_sheet(p_order);
end;
$$;

comment on function public.finish_sales_order_pack(uuid, text, uuid) is
  'Sets packed_at when every picked quantity is in a bin and every bin has a weight. An order still in packing becomes packed. An order that is already shipped or partially shipped keeps that status. Finishing again, while the pack is still complete, changes nothing. ship_date and so_shipments are not updated. Does not buy a label or choose a carrier.';

comment on function public.open_sales_order_pack(uuid, text, uuid) is
  'Opens packing after the pick is finished and sets a picking order to packing. Opening it again returns the same sheet. A packed order stays packed until a correction leaves the pack incomplete. Shipped and partially shipped orders are returned unchanged so the bins can be recorded without leaving that status. Cancelled is refused. Invoiced and closed are returned without opening packing.';

revoke all on function public.finish_sales_order_pack(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.finish_sales_order_pack(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
