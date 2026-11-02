-- Recent moves for the bin or location on the move screen.
-- A blank code returns no rows, so this function cannot list the warehouse.
-- The older list_recent_moves(integer) stays for anything still calling it.
-- Apply by hand after supabase/migrations/20261024064500_move_inventory.sql.
-- Not applied here. Deploying does not run this file.

create or replace function public.list_recent_moves(p_code text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_rows jsonb;
begin
  if v_code = '' then
    return '[]'::jsonb;
  end if;

  with moves as (
    select
      event.id::text as id,
      event.created_at as occurred_at,
      coalesce(event.actor, '') as initials,
      public.bin_display_label(bin.type, bin.reference) as what,
      case
        when from_parent.id is not null then public.bin_display_label(from_parent.type, from_parent.reference)
        when from_location.code is not null then from_location.code
        else 'no place'
      end as from_place,
      case
        when to_parent.id is not null then public.bin_display_label(to_parent.type, to_parent.reference)
        when to_location.code is not null then to_location.code
        else 'no place'
      end as to_place,
      null::integer as qty
    from public.bin_events event
    join public.bins bin on bin.id = event.bin_id
    left join public.bins from_parent on from_parent.id = event.from_parent_bin_id
    left join public.bins to_parent on to_parent.id = event.to_parent_bin_id
    left join public.locations from_location on from_location.id = event.from_location_id
    left join public.locations to_location on to_location.id = event.to_location_id
    where event.event_type = 'moved'
      and (
        upper(bin.reference) = v_code
        or upper(coalesce(from_parent.reference, '')) = v_code
        or upper(coalesce(to_parent.reference, '')) = v_code
        or upper(coalesce(from_location.code, '')) = v_code
        or upper(coalesce(to_location.code, '')) = v_code
      )
    union all
    select
      out_row.id::text,
      out_row.occurred_at,
      coalesce(out_row.operator_label, ''),
      btrim(coalesce(item.sku, '') || ' ' || coalesce(item.name, '')),
      public.bin_display_label(from_bin.type, from_bin.reference),
      public.bin_display_label(to_bin.type, to_bin.reference),
      out_row.qty::integer
    from public.inventory_movements out_row
    join public.inventory_movements in_row
      on in_row.transfer_id = out_row.transfer_id
     and in_row.direction = 'in'
    join public.items item on item.id = out_row.item_id
    join public.bins from_bin on from_bin.id = out_row.bin_id
    join public.bins to_bin on to_bin.id = in_row.bin_id
    where out_row.direction = 'out'
      and out_row.ref_type = 'bin_transfer'
      and (
        upper(from_bin.reference) = v_code
        or upper(to_bin.reference) = v_code
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', moves.id,
    'occurred_at', moves.occurred_at,
    'initials', moves.initials,
    'what', moves.what,
    'from_place', moves.from_place,
    'to_place', moves.to_place,
    'qty', moves.qty
  ) order by moves.occurred_at desc, moves.id desc), '[]'::jsonb)
  into v_rows
  from (
    select * from moves
    order by occurred_at desc, id desc
    limit v_limit
  ) as moves;
  return v_rows;
end;
$$;

comment on function public.list_recent_moves(text, integer) is
  'Recent moves for one bin or location. A blank code returns none. A bin includes its own moves, bins moved into or out of it, and item transfers. A location includes bin moves that start or end there.';

revoke all on function public.list_recent_moves(text, integer) from public, anon, authenticated;
grant execute on function public.list_recent_moves(text, integer) to service_role;

notify pgrst, 'reload schema';
