-- A packed item on a package row can change quantity or move onto another
-- picked line in the same package. The loose quantity is what the row edits.
-- Serials already in the package stay on the item the pick recorded.
-- Adding a new quantity still starts at 1 in the sheet. This does not create
-- an item. A finished pack stays editable. A shipped or partially shipped
-- order keeps that status, the ship date, and the shipment rows.
-- Apply by hand on project fxsbpreasbdalwthyzvk after
-- supabase/migrations/20261106150000_pack_row_packages.sql.
-- Deploying does not run this file.

create or replace function public.set_pack_item_content(
  p_content uuid,
  p_allocation uuid,
  p_qty integer,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_package uuid;
  v_allocation uuid;
  v_qty numeric;
  v_serials integer;
  v_loose numeric;
  v_list uuid;
  v_picked numeric;
  v_packed numeric;
  v_room numeric;
begin
  perform public.operator_initials(p_initials);
  perform public.so_known_operator(p_operator);

  select pkg.sales_order_id, c.package_id, c.allocation_id, c.qty
  into v_order, v_package, v_allocation, v_qty
  from public.so_package_contents c
  join public.so_packages pkg on pkg.id = c.package_id
  where c.id = p_content
  for update of pkg, c;

  if v_order is null then
    raise exception 'That packed quantity was not found.'
      using errcode = 'P0002';
  end if;

  perform public.so_require_packing(v_order);

  if p_qty is null or p_qty < 1 then
    raise exception 'Enter a whole number of at least 1.'
      using errcode = '22023';
  end if;

  select count(*)::integer into v_serials
  from public.so_units u
  join public.so_picks p on p.id = u.pick_id
  where u.package_id = v_package
    and p.allocation_id = v_allocation;

  v_loose := v_qty - v_serials;
  if v_loose <= 0 then
    raise exception 'That quantity is packed by serial. Remove the serial.'
      using errcode = '22023';
  end if;

  v_list := public.so_pack_pick_list(v_order);
  select coalesce(sum(qty_picked), 0) into v_picked
  from public.so_picks
  where pick_list_id = v_list
    and allocation_id = p_allocation;

  if v_picked <= 0 then
    raise exception 'That line was not picked.'
      using errcode = '22023';
  end if;

  select coalesce(sum(c.qty), 0) into v_packed
  from public.so_package_contents c
  join public.so_packages pkg on pkg.id = c.package_id
  where pkg.sales_order_id = v_order
    and c.allocation_id = p_allocation;

  -- The quantity already on this row can stay. Another item only has what is still unpacked.
  v_room := v_picked - v_packed;
  if p_allocation = v_allocation then
    v_room := v_room + v_loose;
  end if;

  if v_room < 1 then
    raise exception 'That line is already packed.'
      using errcode = '22023';
  end if;
  if p_qty > v_room then
    raise exception 'Only %s can go in that bin.', public.so_format_pack_qty(v_room)
      using errcode = '22023';
  end if;

  if p_allocation = v_allocation then
    if p_qty = v_loose then
      return public.sales_order_pack_sheet(v_order);
    end if;

    update public.so_package_contents
    set qty = v_serials + p_qty
    where id = p_content;

    return public.sales_order_pack_sheet(v_order);
  end if;

  update public.so_package_contents
  set qty = qty + p_qty
  where package_id = v_package
    and allocation_id = p_allocation;

  if not found then
    insert into public.so_package_contents (package_id, allocation_id, qty)
    values (v_package, p_allocation, p_qty);
  end if;

  if v_serials <= 0 then
    delete from public.so_package_contents where id = p_content;
  else
    update public.so_package_contents
    set qty = v_serials
    where id = p_content;
  end if;

  return public.sales_order_pack_sheet(v_order);
end;
$$;

comment on function public.set_pack_item_content(uuid, uuid, integer, text, uuid) is
  'Sets the loose quantity of one packed item, or moves that quantity onto another picked line in the same package. Serials stay on the item the pick recorded. Does not create an item. A shipped order keeps its status.';

revoke all on function public.set_pack_item_content(uuid, uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.set_pack_item_content(uuid, uuid, integer, text, uuid) to service_role;
