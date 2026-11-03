-- Recent stock history for one SKU on the item page.
-- Receives and put-away corrections come from stock_events.
-- Moves and picks come from inventory_movements: one row per out,
-- with the transfer's in bin. An in that has no out for this SKU is kept.
-- A null item returns no rows, so this function cannot list the warehouse.
-- Apply by hand after supabase/migrations/20261031060000_damaged_inventory.sql
-- and supabase/migrations/20261024064500_move_inventory.sql.
-- Not applied here. Deploying does not run this file.

create index if not exists stock_events_item_occurred_idx
  on public.stock_events (item_id, occurred_at desc)
  where item_id is not null;

create or replace function public.list_item_entries(p_item_id uuid, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_rows jsonb;
begin
  if p_item_id is null then
    return '[]'::jsonb;
  end if;

  with entries as (
    select
      ('event:' || event.id::text) as id,
      event.occurred_at,
      coalesce(event.operator_initials, '') as initials,
      case
        when event.event_type = 'receive_into_bin' and coalesce(event.damaged, false) then 'Received damaged'
        when event.event_type = 'receive_into_bin' then 'Received'
        when event.event_type = 'receipt_adjustment' and coalesce(event.qty, 0) > 0 then 'Put away'
        when event.event_type = 'receipt_adjustment' then 'Adjusted'
        else replace(event.event_type, '_', ' ')
      end as what,
      case
        when event.event_type = 'receive_into_bin' then coalesce(
          nullif(btrim(event.project), ''),
          nullif(btrim(event.incoming_tag), ''),
          nullif(btrim(event.origin_description), ''),
          'Received'
        )
        else coalesce(nullif(btrim(event.comment), ''), 'Put away')
      end as from_place,
      public.bin_display_label(bin.type, bin.reference) as bin,
      event.qty as qty
    from public.stock_events event
    join public.bins bin on bin.id = event.bin_id
    where event.item_id = p_item_id
      and event.qty is not null
      and event.event_type in ('receive_into_bin', 'receipt_adjustment')

    union all

    select
      ('move:' || out_row.id::text),
      out_row.occurred_at,
      coalesce(out_row.operator_label, ''),
      case
        when out_row.ref_type = 'bin_transfer' then 'Moved'
        when out_row.ref_type = 'sales_order' and coalesce(out_row.reason, '') ilike '%undo%' then 'Pick undone'
        when out_row.ref_type = 'sales_order' then 'Picked'
        when nullif(btrim(out_row.reason), '') is not null then btrim(out_row.reason)
        else replace(out_row.ref_type, '_', ' ')
      end
        || case
          when out_row.ref_type = 'sales_order' and nullif(btrim(out_row.ref_label), '') is not null
            then ' ' || btrim(out_row.ref_label)
          else ''
        end,
      coalesce(
        case
          when from_bin.id is not null then public.bin_display_label(from_bin.type, from_bin.reference)
        end,
        nullif(btrim(out_row.notes), ''),
        ''
      ),
      coalesce(
        case
          when to_bin.id is not null then public.bin_display_label(to_bin.type, to_bin.reference)
        end,
        ''
      ),
      out_row.qty::integer
    from public.inventory_movements out_row
    left join lateral (
      select in_row.bin_id
      from public.inventory_movements in_row
      where in_row.transfer_id = out_row.transfer_id
        and in_row.item_id = out_row.item_id
        and in_row.direction = 'in'
        and in_row.id <> out_row.id
      order by in_row.occurred_at desc, in_row.id desc
      limit 1
    ) inbound on true
    left join public.bins from_bin on from_bin.id = out_row.bin_id
    left join public.bins to_bin on to_bin.id = inbound.bin_id
    where out_row.item_id = p_item_id
      and out_row.direction = 'out'

    union all

    select
      ('move:' || in_row.id::text),
      in_row.occurred_at,
      coalesce(in_row.operator_label, ''),
      case
        when in_row.ref_type = 'bin_transfer' then 'Moved'
        when in_row.ref_type = 'sales_order' and coalesce(in_row.reason, '') ilike '%undo%' then 'Pick undone'
        when in_row.ref_type = 'sales_order' then 'Picked'
        when nullif(btrim(in_row.reason), '') is not null then btrim(in_row.reason)
        else replace(in_row.ref_type, '_', ' ')
      end
        || case
          when in_row.ref_type = 'sales_order' and nullif(btrim(in_row.ref_label), '') is not null
            then ' ' || btrim(in_row.ref_label)
          else ''
        end,
      coalesce(nullif(btrim(in_row.notes), ''), ''),
      coalesce(
        case
          when to_bin.id is not null then public.bin_display_label(to_bin.type, to_bin.reference)
        end,
        ''
      ),
      in_row.qty::integer
    from public.inventory_movements in_row
    left join public.bins to_bin on to_bin.id = in_row.bin_id
    where in_row.item_id = p_item_id
      and in_row.direction = 'in'
      and not exists (
        select 1
        from public.inventory_movements out_row
        where out_row.transfer_id = in_row.transfer_id
          and out_row.item_id = in_row.item_id
          and out_row.direction = 'out'
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entries.id,
    'occurred_at', entries.occurred_at,
    'initials', entries.initials,
    'what', entries.what,
    'from_place', entries.from_place,
    'bin', entries.bin,
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

comment on function public.list_item_entries(uuid, integer) is
  'Newest stock history for one SKU. Receives and receipt adjustments come from stock_events. Moves and picks come from inventory_movements, one row per out, plus an in that has no out for this SKU. A null item returns none. At most 50 rows.';

revoke all on function public.list_item_entries(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_item_entries(uuid, integer) to service_role;

notify pgrst, 'reload schema';
