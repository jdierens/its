-- What is in one target bin on the move screen, newest arrival first.
-- A blank code or a location code returns no rows.
-- An item line is for-sale quantity on the open cycle. Its time is the latest
-- receive, put-away, or transfer into this bin. A nested bin uses the move
-- that put it here. Damaged-only quantity is not listed.
-- Apply by hand after supabase/migrations/20261024064500_move_inventory.sql
-- and supabase/migrations/20261023070123_receipt_edits.sql.
-- Not applied here. Deploying does not run this file.

create or replace function public.list_bin_entries(p_code text, p_limit integer)
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

  with target as (
    select bin.id
    from public.bins bin
    where upper(bin.reference) = v_code
  ),
  entries as (
    select
      ('item:' || contents.id::text) as id,
      coalesce(arrival.occurred_at, cycle.opened_at) as occurred_at,
      coalesce(nullif(btrim(arrival.initials), ''), cycle.opened_by_initials, '') as initials,
      btrim(coalesce(item.sku, '') || ' ' || coalesce(item.name, '')) as what,
      coalesce(
        nullif(btrim(arrival.from_place), ''),
        nullif(btrim(cycle.project), ''),
        nullif(btrim(cycle.origin_description), ''),
        ''
      ) as from_place,
      contents.qty as qty
    from public.bin_contents contents
    join target on target.id = contents.bin_id
    join public.items item on item.id = contents.item_id
    join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
    left join lateral (
      select arrived.occurred_at, arrived.initials, arrived.from_place
      from (
        select
          event.occurred_at,
          coalesce(event.operator_initials, '') as initials,
          case
            when nullif(btrim(event.project), '') is not null then btrim(event.project)
            else 'Received'
          end as from_place
        from public.stock_events event
        where event.bin_id = contents.bin_id
          and event.item_id = contents.item_id
          and event.event_type = 'receive_into_bin'
          and coalesce(event.qty, 0) > 0
        union all
        select
          event.occurred_at,
          coalesce(event.operator_initials, ''),
          'Put away'
        from public.stock_events event
        where event.bin_id = contents.bin_id
          and event.item_id = contents.item_id
          and event.event_type = 'receipt_adjustment'
          and coalesce(event.qty, 0) > 0
        union all
        select
          in_row.occurred_at,
          coalesce(in_row.operator_label, ''),
          public.bin_display_label(from_bin.type, from_bin.reference)
        from public.inventory_movements in_row
        join public.inventory_movements out_row
          on out_row.transfer_id = in_row.transfer_id
         and out_row.direction = 'out'
         and out_row.item_id = in_row.item_id
        join public.bins from_bin on from_bin.id = out_row.bin_id
        where in_row.bin_id = contents.bin_id
          and in_row.item_id = contents.item_id
          and in_row.direction = 'in'
          and in_row.ref_type = 'bin_transfer'
      ) arrived
      order by arrived.occurred_at desc
      limit 1
    ) arrival on true
    where contents.qty > 0

    union all

    select
      ('bin:' || child.id::text),
      coalesce(arrival.created_at, child.created_at),
      coalesce(arrival.actor, ''),
      public.bin_display_label(child.type, child.reference),
      coalesce(arrival.from_place, ''),
      null::integer
    from public.bins child
    join target on target.id = child.parent_bin_id
    left join lateral (
      select
        event.created_at,
        coalesce(event.actor, '') as actor,
        case
          when from_parent.id is not null then public.bin_display_label(from_parent.type, from_parent.reference)
          when from_location.code is not null then from_location.code
          else ''
        end as from_place
      from public.bin_events event
      left join public.bins from_parent on from_parent.id = event.from_parent_bin_id
      left join public.locations from_location on from_location.id = event.from_location_id
      where event.bin_id = child.id
        and event.event_type = 'moved'
        and event.to_parent_bin_id = target.id
      order by event.created_at desc, event.id desc
      limit 1
    ) arrival on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entries.id,
    'occurred_at', entries.occurred_at,
    'initials', entries.initials,
    'what', entries.what,
    'from_place', entries.from_place,
    'qty', entries.qty
  ) order by entries.occurred_at desc nulls last, entries.id desc), '[]'::jsonb)
  into v_rows
  from (
    select * from entries
    order by occurred_at desc nulls last, id desc
    limit v_limit
  ) as entries;
  return v_rows;
end;
$$;

comment on function public.list_bin_entries(text, integer) is
  'For-sale items and nested bins currently in one bin, newest arrival first. A blank or unknown code returns none. Item time is the latest receive, put-away, or transfer in. A nested bin uses the move that put it here.';

revoke all on function public.list_bin_entries(text, integer) from public, anon, authenticated;
grant execute on function public.list_bin_entries(text, integer) to service_role;

notify pgrst, 'reload schema';
