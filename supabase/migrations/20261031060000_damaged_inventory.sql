-- Damaged goods stay in the bin and are not for sale.
-- bin_contents.qty remains the for-sale quantity. damaged_qty is the same SKU
-- in the same open cycle that search, picks, and a later listing quantity ignore.
-- stock_units.stock_status marks the piece. A later write-down references
-- bin_contents.id for damaged_qty and stock_units.id while stock_status is
-- damaged. It does not change either quantity or the status. $0 damaged goods
-- stay out of stock and are not received. quarantine and hold match
-- inventory_movements and are not a location.
-- Not applied here. Apply by hand after supabase/migrations/20261030153100_qbo_sync_log_chunk_phase.sql.
-- Deploying does not run this file.

alter table public.bin_contents
  add column if not exists damaged_qty integer not null default 0;

alter table public.bin_contents
  drop constraint if exists bin_contents_qty_check;

alter table public.bin_contents
  drop constraint if exists bin_contents_damaged_qty_check;

alter table public.bin_contents
  drop constraint if exists bin_contents_present_check;

alter table public.bin_contents
  add constraint bin_contents_qty_check check (qty >= 0);

alter table public.bin_contents
  add constraint bin_contents_damaged_qty_check check (damaged_qty >= 0);

alter table public.bin_contents
  add constraint bin_contents_present_check check (qty > 0 or damaged_qty > 0);

comment on column public.bin_contents.qty is
  'Quantity of this SKU available for sale in the open cycle. Inventory search, picks, and item_for_sale_qty use this column. Damaged pieces are not included.';

comment on column public.bin_contents.damaged_qty is
  'Pieces of this SKU still in the bin that are not for sale. A later write-down of residual value references bin_contents.id, stores the previous cost, and leaves qty, damaged_qty, and stock_status unchanged. $0 damaged goods are left out of stock instead of received.';

comment on column public.bin_contents.id is
  'Stable id of this SKU in this cycle. A later cost adjustment hangs off this id for the damaged quantity.';

alter table public.stock_events
  add column if not exists damaged boolean not null default false;

comment on column public.stock_events.damaged is
  'True when this receipt was marked damaged, the same flag as DMG on a starting-inventory sheet. The balance sits in bin_contents.damaged_qty. A later edit stores the flag on stock_event_edits and moves the receipt quantity between the two balances.';

alter table public.stock_units
  add column if not exists stock_status text not null default 'available';

alter table public.stock_units
  drop constraint if exists stock_units_stock_status_check;

alter table public.stock_units
  add constraint stock_units_stock_status_check
  check (stock_status in ('available', 'damaged', 'quarantine', 'hold'));

comment on column public.stock_units.stock_status is
  'available pieces can be picked. damaged pieces stay in the bin and are not for sale. A later write-down references stock_units.id while this is damaged and does not change the status or the quantity. quarantine and hold match inventory_movements.stock_status and are not used by receiving.';

create index if not exists stock_units_damaged_idx
  on public.stock_units (item_id, cycle_id)
  where status = 'in_stock' and stock_status = 'damaged';

create or replace function public.adjust_bin_cycle_qty(
  p_cycle_id uuid,
  p_bin_id uuid,
  p_item_id uuid,
  p_delta integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_qty integer;
  v_damaged integer;
  v_exists boolean;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'Enter a whole number other than 0.'
      using errcode = '22023';
  end if;

  select qty, damaged_qty into v_qty, v_damaged
  from public.bin_contents
  where cycle_id = p_cycle_id
    and item_id = p_item_id
  for update;
  v_exists := found;

  v_qty := coalesce(v_qty, 0) + p_delta;
  v_damaged := coalesce(v_damaged, 0);
  if v_qty < 0 then
    v_qty := 0;
  end if;

  if v_qty = 0 and v_damaged = 0 then
    delete from public.bin_contents
    where cycle_id = p_cycle_id
      and item_id = p_item_id;
  elsif v_exists then
    update public.bin_contents
    set qty = v_qty
    where cycle_id = p_cycle_id
      and item_id = p_item_id;
  elsif v_qty > 0 then
    insert into public.bin_contents (bin_id, cycle_id, item_id, qty, damaged_qty)
    values (p_bin_id, p_cycle_id, p_item_id, v_qty, 0)
    on conflict (cycle_id, item_id) do update
    set qty = excluded.qty;
  end if;

  perform public.finish_bin_cycle(p_cycle_id);
  return v_qty;
end;
$$;

comment on function public.adjust_bin_cycle_qty(uuid, uuid, uuid, integer) is
  'Adds or removes for-sale quantity on a cycle. damaged_qty stays. The row remains while either quantity is above 0, so a damaged-only balance does not close the cycle.';

create or replace function public.adjust_bin_cycle_damaged_qty(
  p_cycle_id uuid,
  p_bin_id uuid,
  p_item_id uuid,
  p_delta integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_qty integer;
  v_damaged integer;
  v_exists boolean;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'Enter a whole number other than 0.'
      using errcode = '22023';
  end if;

  select qty, damaged_qty into v_qty, v_damaged
  from public.bin_contents
  where cycle_id = p_cycle_id
    and item_id = p_item_id
  for update;
  v_exists := found;

  v_qty := coalesce(v_qty, 0);
  v_damaged := coalesce(v_damaged, 0) + p_delta;
  if v_damaged < 0 then
    v_damaged := 0;
  end if;

  if v_qty = 0 and v_damaged = 0 then
    delete from public.bin_contents
    where cycle_id = p_cycle_id
      and item_id = p_item_id;
  elsif v_exists then
    update public.bin_contents
    set damaged_qty = v_damaged
    where cycle_id = p_cycle_id
      and item_id = p_item_id;
  elsif v_damaged > 0 then
    insert into public.bin_contents (bin_id, cycle_id, item_id, qty, damaged_qty)
    values (p_bin_id, p_cycle_id, p_item_id, 0, v_damaged)
    on conflict (cycle_id, item_id) do update
    set damaged_qty = excluded.damaged_qty;
  end if;

  perform public.finish_bin_cycle(p_cycle_id);
  return v_damaged;
end;
$$;

comment on function public.adjust_bin_cycle_damaged_qty(uuid, uuid, uuid, integer) is
  'Adds or removes damaged quantity on a cycle. For-sale qty stays. A row with only damaged quantity keeps the cycle open.';

create or replace function public.bin_occupied_qty(p_bin uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(qty + damaged_qty), 0)::integer
  from public.bin_contents
  where bin_id = p_bin;
$$;

comment on function public.bin_occupied_qty(uuid) is
  'Physical quantity in a bin, for sale and damaged. Used to decide whether the open cycle stays. For-sale checks use qty alone.';

create or replace function public.item_for_sale_qty(p_item uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(bc.qty), 0)::integer
  from public.bin_contents bc
  join public.bin_cycles c on c.id = bc.cycle_id and c.status = 'open'
  where bc.item_id = p_item;
$$;

comment on function public.item_for_sale_qty(uuid) is
  'Open-cycle quantity available for sale. damaged_qty is not included. Inventory search and picks use the same qty column. A later eBay quantity push should call this instead of summing damaged pieces.';

-- Bin-empty checks must see damaged quantity, or a damaged-only bin looks empty
-- and the next receipt closes the cycle that still holds it.
do $patch$
declare
  r record;
  v_def text;
  v_next text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    v_def := pg_get_functiondef(r.oid);
    if v_def !~ 'into v_on_hand[[:space:]]+from public\.bin_contents[[:space:]]+where bin_id = [A-Za-z0-9_.]+;' then
      continue;
    end if;
    v_next := regexp_replace(
      v_def,
      'select coalesce\(sum\(qty\), 0\) into v_on_hand[[:space:]]+from public\.bin_contents[[:space:]]+where bin_id = ([A-Za-z0-9_.]+);',
      'select public.bin_occupied_qty(\1) into v_on_hand;',
      'g'
    );
    if v_next = v_def then
      raise exception 'Could not count damaged quantity as occupying %', r.proname;
    end if;
    execute v_next;
  end loop;
end;
$patch$;

create or replace function public.stock_events_mark_damaged()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.event_type = 'receive_into_bin'
    and current_setting('its.receipt_damaged', true) = 'true'
  then
    new.damaged := true;
  end if;
  return new;
end;
$$;

comment on function public.stock_events_mark_damaged() is
  'Copies the receive call''s damaged flag onto the receipt. The flag is transaction-local and is not a column the older receive function writes itself.';

drop trigger if exists stock_events_mark_damaged on public.stock_events;

create trigger stock_events_mark_damaged
before insert on public.stock_events
for each row execute function public.stock_events_mark_damaged();

create or replace function public.stock_events_move_damaged()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.event_type = 'receive_into_bin'
    and coalesce(new.damaged, false)
    and new.item_id is not null
    and new.cycle_id is not null
    and new.bin_id is not null
    and coalesce(new.qty, 0) > 0
  then
    -- receive_into_bin already added this quantity to for-sale qty. Move it.
    perform public.adjust_bin_cycle_damaged_qty(new.cycle_id, new.bin_id, new.item_id, new.qty);
    perform public.adjust_bin_cycle_qty(new.cycle_id, new.bin_id, new.item_id, -new.qty);
  end if;
  return new;
end;
$$;

comment on function public.stock_events_move_damaged() is
  'After a damaged receipt is inserted, moves that quantity from for-sale qty onto damaged_qty. A pending line has no item yet and does not move stock.';

drop trigger if exists stock_events_move_damaged on public.stock_events;

create trigger stock_events_move_damaged
after insert on public.stock_events
for each row execute function public.stock_events_move_damaged();

create or replace function public.stock_units_copy_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_vendor uuid;
  v_ownership text;
  v_damaged boolean;
begin
  if new.received_event_id is not null then
    select vendor_id, ownership, damaged
    into v_vendor, v_ownership, v_damaged
    from public.stock_events
    where id = new.received_event_id;
    if new.vendor_id is null then
      new.vendor_id := v_vendor;
      if new.ownership is null then
        new.ownership := v_ownership;
      end if;
    end if;
    if coalesce(v_damaged, false) and new.stock_status = 'available' then
      new.stock_status := 'damaged';
    end if;
  end if;

  if new.vendor_id is null and new.pick_id is not null then
    select vendor_id, ownership
    into v_vendor, v_ownership
    from public.so_picks
    where id = new.pick_id;
    new.vendor_id := v_vendor;
    if new.ownership is null then
      new.ownership := v_ownership;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.stock_units_copy_owner() is
  'Copies vendor and ownership from the receipt, or from the pick when the unit is created there. A damaged receipt marks the unit damaged so it cannot be picked.';

create or replace function public.stock_units_block_unavailable_pick()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.stock_status is distinct from 'available'
    and old.status = 'in_stock'
    and (
      new.status = 'issued'
      or (new.pick_id is not null and old.pick_id is null)
    )
  then
    raise exception 'That piece is not available to pick.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

comment on function public.stock_units_block_unavailable_pick() is
  'Stops a damaged, quarantine, or hold piece from being issued or attached to a pick.';

drop trigger if exists stock_units_block_unavailable_pick on public.stock_units;

create trigger stock_units_block_unavailable_pick
before update on public.stock_units
for each row execute function public.stock_units_block_unavailable_pick();

create or replace function public.assert_cycle_item_units(p_cycle uuid, p_item uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_available integer;
  v_damaged integer;
  v_other integer;
  v_qty integer;
  v_damaged_qty integer;
begin
  if p_cycle is null or p_item is null then
    return;
  end if;

  select
    count(*) filter (where stock_status = 'available'),
    count(*) filter (where stock_status = 'damaged'),
    count(*) filter (where stock_status not in ('available', 'damaged'))
  into v_available, v_damaged, v_other
  from public.stock_units
  where cycle_id = p_cycle
    and item_id = p_item
    and status = 'in_stock';

  select qty, damaged_qty into v_qty, v_damaged_qty
  from public.bin_contents
  where cycle_id = p_cycle
    and item_id = p_item;

  if coalesce(v_other, 0) > 0 then
    raise exception 'That bin has units that are not available or damaged.'
      using errcode = '23514';
  end if;
  if coalesce(v_available, 0) > coalesce(v_qty, 0) then
    raise exception 'That bin would have % units for sale and only % available.', v_available, coalesce(v_qty, 0)
      using errcode = '23514';
  end if;
  if coalesce(v_damaged, 0) > coalesce(v_damaged_qty, 0) then
    raise exception 'That bin would have % damaged units and only % damaged.', v_damaged, coalesce(v_damaged_qty, 0)
      using errcode = '23514';
  end if;
end;
$$;

comment on function public.assert_cycle_item_units(uuid, uuid) is
  'Available units cannot exceed for-sale qty. Damaged units cannot exceed damaged_qty. Quantity with no unit row is allowed.';

-- Picks and moves of for-sale quantity must not take damaged units with them.
do $patch$
declare
  r record;
  v_def text;
  v_next text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('relocate_stock_units', 'issue_picked_units', 'record_pick_serial')
  loop
    v_def := pg_get_functiondef(r.oid);
    if position('and status = ''in_stock'' and stock_status = ''available''' in v_def) > 0
      or position('and unit.status = ''in_stock'' and unit.stock_status = ''available''' in v_def) > 0
    then
      continue;
    end if;
    v_next := v_def;
    v_next := replace(v_next, 'and status = ''in_stock''', 'and status = ''in_stock'' and stock_status = ''available''');
    v_next := replace(v_next, 'and unit.status = ''in_stock''', 'and unit.status = ''in_stock'' and unit.stock_status = ''available''');
    v_next := replace(v_next, 'and swap.status = ''in_stock''', 'and swap.status = ''in_stock'' and swap.stock_status = ''available''');
    if v_next = v_def then
      raise exception '% does not filter in-stock units.', r.proname;
    end if;
    execute v_next;
  end loop;
end;
$patch$;

create or replace function public.receipt_is_damaged(p_event_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select (ed.new_values->>'damaged')::boolean
      from public.stock_event_edits ed
      where ed.stock_event_id = p_event_id
        and ed.new_values ? 'damaged'
      order by ed.edited_at desc, ed.id desc
      limit 1
    ),
    (
      select e.damaged
      from public.stock_events e
      where e.id = p_event_id
    ),
    false
  );
$$;

comment on function public.receipt_is_damaged(uuid) is
  'The damaged flag on a receipt. A later edit wins over the value written when the receipt was inserted. A quantity edit that does not mention the flag leaves it in place.';

create or replace function public.apply_receipt_qty_delta(
  p_event_id uuid,
  p_cycle uuid,
  p_bin uuid,
  p_item uuid,
  p_delta integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_delta is null or p_delta = 0 then
    return;
  end if;
  if public.receipt_is_damaged(p_event_id) then
    perform public.adjust_bin_cycle_damaged_qty(p_cycle, p_bin, p_item, p_delta);
  else
    perform public.adjust_bin_cycle_qty(p_cycle, p_bin, p_item, p_delta);
  end if;
end;
$$;

comment on function public.apply_receipt_qty_delta(uuid, uuid, uuid, uuid, integer) is
  'Moves a receipt quantity on the balance that matches its damaged flag. Linking a pending damaged line posts damaged_qty, not for-sale qty.';

create or replace function public.post_receipt_adjustment(
  p_event_id uuid,
  p_cycle_id uuid,
  p_bin_id uuid,
  p_item_id uuid,
  p_delta integer,
  p_initials text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_on integer;
  v_damaged boolean;
begin
  if p_delta is null or p_delta = 0 then
    return;
  end if;

  v_damaged := public.receipt_is_damaged(p_event_id);
  if v_damaged then
    select damaged_qty into v_on
    from public.bin_contents
    where cycle_id = p_cycle_id
      and item_id = p_item_id
    for update;
  else
    select qty into v_on
    from public.bin_contents
    where cycle_id = p_cycle_id
      and item_id = p_item_id
    for update;
  end if;

  if coalesce(v_on, 0) + p_delta < 0 then
    raise exception 'That would take the bin below 0.'
      using errcode = '22023';
  end if;

  perform public.apply_receipt_qty_delta(p_event_id, p_cycle_id, p_bin_id, p_item_id, p_delta);

  insert into public.stock_events (
    event_type,
    bin_id,
    cycle_id,
    item_id,
    qty,
    operator_initials,
    comment,
    corrects_event_id
  ) values (
    'receipt_adjustment',
    p_bin_id,
    p_cycle_id,
    p_item_id,
    p_delta,
    p_initials,
    case when v_damaged then 'Corrects a damaged receipt' else 'Corrects a receipt' end,
    p_event_id
  );
end;
$$;

comment on function public.post_receipt_adjustment(uuid, uuid, uuid, uuid, integer, text) is
  'Posts one receipt_adjustment and moves the balance that matches the receipt. A damaged receipt changes damaged_qty. A result below 0 is rejected before the move.';

do $patch$
declare
  r record;
  v_def text;
  v_next text;
  v_from text := 'perform public.adjust_bin_cycle_qty(v_cycle_id, v_bin.id, p_item_id, p_qty);';
  v_to text := 'perform public.apply_receipt_qty_delta(p_event_id, v_cycle_id, v_bin.id, p_item_id, p_qty);';
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'edit_receipt'
  loop
    v_def := pg_get_functiondef(r.oid);
    if position(v_from in v_def) = 0 then
      continue;
    end if;
    v_next := replace(v_def, v_from, v_to);
    execute v_next;
  end loop;
end;
$patch$;

do $patch$
declare
  v_def text;
  v_next text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'import_receiving_rows';

  if v_def is null then
    raise exception 'import_receiving_rows is missing.';
  end if;
  if position('p_damaged =>' in v_def) > 0 then
    return;
  end if;

  v_next := v_def;
  if position('v_wiped boolean;' in v_next) = 0
    or position('v_wiped := false;' in v_next) = 0
    or position('p_purchase_order_id => nullif(v_write ->> ''purchase_order_id'', '''')::uuid' in v_next) = 0
  then
    raise exception 'import_receiving_rows no longer matches the damaged patch.';
  end if;

  v_next := replace(v_next, 'v_wiped boolean;', E'v_wiped boolean;\n  v_damaged boolean;');
  v_next := replace(v_next, 'v_wiped := false;', E'v_wiped := false;\n    v_damaged := false;');
  v_next := replace(
    v_next,
    'if v_status = ''ok'' and v_comment is not null and char_length(v_comment) > 500 then',
    $sql$if v_status = 'ok' and v_row ? 'damaged' and jsonb_typeof(v_row -> 'damaged') is distinct from 'boolean' and jsonb_typeof(v_row -> 'damaged') is distinct from 'null' then
      v_status := 'error';
      v_reason := 'Damaged is yes or no.';
    elsif v_status = 'ok' and jsonb_typeof(v_row -> 'damaged') = 'boolean' then
      v_damaged := (v_row ->> 'damaged')::boolean;
    end if;

    if v_status = 'ok' and v_comment is not null and char_length(v_comment) > 500 then$sql$
  );
  v_next := replace(
    v_next,
    'if v_unit_count > 0 then
        v_message := v_message || format('' %s stock %s.'', v_unit_count, case when v_unit_count = 1 then ''unit'' else ''units'' end);
      end if;',
    'if v_unit_count > 0 then
        v_message := v_message || format('' %s stock %s.'', v_unit_count, case when v_unit_count = 1 then ''unit'' else ''units'' end);
      end if;
      if v_damaged then
        v_message := v_message || '' Damaged. Not for sale.'';
      end if;'
  );
  v_next := replace(
    v_next,
    '''client_request_id'', v_request',
    E'''client_request_id'', v_request,\n        ''damaged'', v_damaged'
  );
  v_next := replace(
    v_next,
    'p_purchase_order_id => nullif(v_write ->> ''purchase_order_id'', '''')::uuid',
    E'p_purchase_order_id => nullif(v_write ->> ''purchase_order_id'', '''')::uuid,\n      p_damaged => coalesce((v_write ->> ''damaged'')::boolean, false)'
  );

  if position('p_damaged' in v_next) = 0 or position('v_damaged' in v_next) = 0 then
    raise exception 'import_receiving_rows did not gain the damaged flag.';
  end if;
  execute v_next;
end;
$patch$;

create or replace function public.receive_into_bin(
  p_reference text,
  p_item_id uuid,
  p_qty integer,
  p_initials text,
  p_comment text,
  p_project text,
  p_origin text,
  p_incoming_tag text,
  p_received_on date,
  p_origin_qty integer,
  p_client_request_id text,
  p_scan_raw text,
  p_cleaned boolean,
  p_wiped boolean,
  p_search_query text,
  p_damaged boolean,
  p_units jsonb default null,
  p_vendor_id uuid default null,
  p_purchase_order_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- p_damaged has no default so a call that omits it still uses the older
  -- for-sale signature. A default here would make every receive ambiguous.
  perform set_config('its.receipt_damaged', case when p_damaged then 'true' else 'false' end, true);
  v_result := public.receive_into_bin(
    p_reference => p_reference,
    p_item_id => p_item_id,
    p_qty => p_qty,
    p_initials => p_initials,
    p_comment => p_comment,
    p_project => p_project,
    p_origin => p_origin,
    p_incoming_tag => p_incoming_tag,
    p_received_on => p_received_on,
    p_origin_qty => p_origin_qty,
    p_client_request_id => p_client_request_id,
    p_scan_raw => p_scan_raw,
    p_cleaned => p_cleaned,
    p_wiped => p_wiped,
    p_search_query => p_search_query,
    p_units => p_units,
    p_vendor_id => p_vendor_id,
    p_purchase_order_id => p_purchase_order_id
  );
  perform set_config('its.receipt_damaged', 'false', true);
  return v_result;
end;
$$;

comment on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, boolean, jsonb, uuid, uuid) is
  'Receives into a bin and, when damaged is true, keeps that quantity out of for-sale stock. The older signature stays and receives for sale. A receipt with no purchase order still requires a vendor.';

create or replace function public.set_receipt_damaged(
  p_event_id uuid,
  p_damaged boolean,
  p_initials text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_event public.stock_events;
  v_latest jsonb;
  v_old_damaged boolean;
  v_qty integer;
  v_item uuid;
  v_cycle uuid;
  v_bin uuid;
  v_have integer;
  v_damaged_have integer;
  v_avail_units integer;
  v_dmg_units integer;
  v_receipt_units integer;
  v_old jsonb;
  v_new jsonb;
begin
  if p_damaged is null then
    raise exception 'Damaged is yes or no.'
      using errcode = '22023';
  end if;
  if v_initials !~ '^[A-Z]{2}$' then
    raise exception 'Operator initials must be 2 letters.'
      using errcode = '22023';
  end if;

  select * into v_event
  from public.stock_events
  where id = p_event_id
    and event_type = 'receive_into_bin'
  for update;

  if not found then
    raise exception 'That receipt is not in the ledger.'
      using errcode = 'P0002';
  end if;

  v_old_damaged := public.receipt_is_damaged(p_event_id);
  if v_old_damaged is not distinct from p_damaged then
    return jsonb_build_object('edited', false, 'damaged', p_damaged);
  end if;

  select new_values into v_latest
  from public.stock_event_edits
  where stock_event_id = p_event_id
  order by edited_at desc, id desc
  limit 1;

  v_qty := coalesce(
    case when v_latest is null then v_event.qty else (v_latest->>'qty')::integer end,
    v_event.qty,
    0
  );
  v_item := case
    when v_latest is null then v_event.item_id
    else coalesce(nullif(v_latest->>'item_id', '')::uuid, v_event.item_id)
  end;
  v_cycle := v_event.cycle_id;
  v_bin := v_event.bin_id;
  if v_latest is not null and nullif(btrim(v_latest->>'cycle_id'), '') is not null then
    v_cycle := nullif(btrim(v_latest->>'cycle_id'), '')::uuid;
    v_bin := coalesce(nullif(btrim(v_latest->>'bin_id'), '')::uuid, v_event.bin_id);
  end if;

  if v_item is not null and v_cycle is not null and v_bin is not null and v_qty > 0 then
    perform pg_advisory_xact_lock(hashtextextended(v_cycle::text, 0));
    perform public.lock_item_units(v_item);

    select qty, damaged_qty
    into v_have, v_damaged_have
    from public.bin_contents
    where cycle_id = v_cycle
      and item_id = v_item
    for update;

    select
      count(*) filter (where stock_status = 'available'),
      count(*) filter (where stock_status = 'damaged')
    into v_avail_units, v_dmg_units
    from public.stock_units
    where cycle_id = v_cycle
      and item_id = v_item
      and status = 'in_stock';

    select count(*) into v_receipt_units
    from public.stock_units
    where received_event_id = p_event_id
      and status = 'in_stock'
      and pick_id is null
      and cycle_id = v_cycle
      and item_id = v_item
      and stock_status = case when p_damaged then 'available' else 'damaged' end;

    if coalesce(v_receipt_units, 0) > v_qty then
      raise exception 'This receipt has more identified pieces than its quantity.'
        using errcode = '22023';
    end if;

    if p_damaged then
      if coalesce(v_have, 0) < v_qty then
        raise exception 'That would take the bin below 0.'
          using errcode = '22023';
      end if;
      if coalesce(v_avail_units, 0) - coalesce(v_receipt_units, 0) > coalesce(v_have, 0) - v_qty then
        raise exception 'Those pieces are already identified. Damaged cannot be marked while the bin would have more units than quantity for sale.'
          using errcode = '22023';
      end if;
      perform public.adjust_bin_cycle_damaged_qty(v_cycle, v_bin, v_item, v_qty);
      perform public.adjust_bin_cycle_qty(v_cycle, v_bin, v_item, -v_qty);
    else
      if coalesce(v_damaged_have, 0) < v_qty then
        raise exception 'That would take the bin below 0.'
          using errcode = '22023';
      end if;
      if coalesce(v_dmg_units, 0) - coalesce(v_receipt_units, 0) > coalesce(v_damaged_have, 0) - v_qty then
        raise exception 'Those pieces are already identified. Clearing damaged would leave more damaged units than damaged quantity.'
          using errcode = '22023';
      end if;
      perform public.adjust_bin_cycle_qty(v_cycle, v_bin, v_item, v_qty);
      perform public.adjust_bin_cycle_damaged_qty(v_cycle, v_bin, v_item, -v_qty);
    end if;

    update public.stock_units
    set stock_status = case when p_damaged then 'damaged' else 'available' end
    where received_event_id = p_event_id
      and status = 'in_stock'
      and pick_id is null
      and cycle_id = v_cycle
      and item_id = v_item;
  end if;

  if v_latest is null then
    v_old := jsonb_build_object(
      'received_on', to_char(v_event.received_on, 'YYYY-MM-DD'),
      'project', v_event.project,
      'incoming_tag', v_event.incoming_tag,
      'origin_description', v_event.origin_description,
      'origin_qty', v_event.origin_qty,
      'comment', v_event.comment,
      'qty', v_event.qty,
      'item_id', v_event.item_id,
      'cleaned', v_event.cleaned,
      'wiped', v_event.wiped,
      'search_query', v_event.search_query,
      'bin_id', v_event.bin_id,
      'cycle_id', v_event.cycle_id,
      'damaged', v_old_damaged
    );
  else
    v_old := v_latest || jsonb_build_object('damaged', v_old_damaged);
  end if;
  v_new := v_old || jsonb_build_object('damaged', p_damaged);

  insert into public.stock_event_edits (
    stock_event_id,
    editor_initials,
    old_values,
    new_values
  ) values (
    p_event_id,
    v_initials,
    v_old,
    v_new
  );

  return jsonb_build_object('edited', true, 'damaged', p_damaged);
end;
$$;

comment on function public.set_receipt_damaged(uuid, boolean, text) is
  'Marks a receipt damaged or clears it. Posted quantity moves between for-sale qty and damaged_qty. Units from that receipt that are still in the bin follow. A later write-down is not posted here.';

drop view if exists public.receipt_lines;

create view public.receipt_lines
with (security_invoker = true) as
select
  e.id,
  e.occurred_at,
  e.operator_initials,
  case
    when ed.new_values is null then e.received_on
    else (ed.new_values->>'received_on')::date
  end as received_on,
  case
    when ed.new_values is null then e.project
    else nullif(btrim(ed.new_values->>'project'), '')
  end as project,
  case
    when ed.new_values is null then e.incoming_tag
    else nullif(btrim(ed.new_values->>'incoming_tag'), '')
  end as incoming_tag,
  case
    when ed.new_values is null then e.origin_description
    else nullif(btrim(ed.new_values->>'origin_description'), '')
  end as origin_description,
  case
    when ed.new_values is null then e.origin_qty
    else (ed.new_values->>'origin_qty')::integer
  end as origin_qty,
  case
    when ed.new_values is null then e.comment
    else nullif(btrim(ed.new_values->>'comment'), '')
  end as comment,
  case
    when ed.new_values is null then e.qty
    else (ed.new_values->>'qty')::integer
  end as qty,
  case
    when ed.new_values is null then e.item_id
    else (ed.new_values->>'item_id')::uuid
  end as item_id,
  coalesce(nullif(btrim(ed.new_values->>'sku'), ''), i.sku) as sku,
  coalesce(nullif(btrim(ed.new_values->>'item_name'), ''), i.name, '') as item_name,
  (ed.id is not null) as edited,
  ed.editor_initials,
  case
    when ed.new_values is not null and ed.new_values ? 'cleaned' then (ed.new_values->>'cleaned')::boolean
    else e.cleaned
  end as cleaned,
  case
    when ed.new_values is not null and ed.new_values ? 'wiped' then (ed.new_values->>'wiped')::boolean
    else e.wiped
  end as wiped,
  case
    when dmg.new_values is not null then (dmg.new_values->>'damaged')::boolean
    else e.damaged
  end as damaged,
  tax.short_code,
  tax.long_code,
  tax.name as taxonomy_name,
  case
    when ed.new_values is not null and ed.new_values ? 'bin_reference'
      then nullif(btrim(ed.new_values->>'bin_reference'), '')
    else bin.reference
  end as bin_reference,
  case
    when ed.new_values is not null and ed.new_values ? 'location_code'
      then nullif(btrim(ed.new_values->>'location_code'), '')
    else loc.code
  end as location_code,
  case
    when ed.new_values is not null and ed.new_values ? 'search_query' then nullif(btrim(ed.new_values->>'search_query'), '')
    else e.search_query
  end as search_query,
  e.vendor_id,
  vendor.display_name as vendor_name,
  e.ownership,
  e.purchase_order_id,
  po.number as po_number
from public.stock_events e
left join lateral (
  select id, new_values, editor_initials
  from public.stock_event_edits
  where stock_event_id = e.id
  order by edited_at desc, id desc
  limit 1
) ed on true
left join lateral (
  select new_values
  from public.stock_event_edits
  where stock_event_id = e.id
    and new_values ? 'damaged'
  order by edited_at desc, id desc
  limit 1
) dmg on true
left join public.items i
  on i.id = case
    when ed.new_values is null then e.item_id
    else (ed.new_values->>'item_id')::uuid
  end
left join public.taxonomies as tax on tax.id = i.taxonomy_id
left join public.bins as bin on bin.id = e.bin_id
left join public.locations as loc on loc.id = e.to_location_id
left join public.vendors as vendor on vendor.id = e.vendor_id
left join public.purchase_orders as po on po.id = e.purchase_order_id
where e.event_type = 'receive_into_bin';

comment on view public.receipt_lines is
  'Recent receipts with the latest correction applied. damaged follows the latest edit that set it, so a quantity correction does not clear the flag. Vendor, ownership, and purchase order stay on the receipt.';

do $patch$
declare
  v_def text;
  v_next text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'fetch_bin_detail';
  if v_def is null or position('''qty'', bc.qty' in v_def) = 0 then
    raise exception 'fetch_bin_detail does not list bin quantity.';
  end if;
  if position('damaged_qty' in v_def) > 0 then
    return;
  end if;
  v_next := replace(v_def, '''qty'', bc.qty', E'''qty'', bc.qty,\n    ''damaged_qty'', bc.damaged_qty');
  execute v_next;
end;
$patch$;

revoke all on function public.adjust_bin_cycle_qty(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.adjust_bin_cycle_damaged_qty(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.bin_occupied_qty(uuid) from public, anon, authenticated;
revoke all on function public.item_for_sale_qty(uuid) from public, anon, authenticated;
revoke all on function public.stock_events_mark_damaged() from public, anon, authenticated;
revoke all on function public.stock_events_move_damaged() from public, anon, authenticated;
revoke all on function public.stock_units_copy_owner() from public, anon, authenticated;
revoke all on function public.stock_units_block_unavailable_pick() from public, anon, authenticated;
revoke all on function public.assert_cycle_item_units(uuid, uuid) from public, anon, authenticated;
revoke all on function public.receipt_is_damaged(uuid) from public, anon, authenticated;
revoke all on function public.apply_receipt_qty_delta(uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.post_receipt_adjustment(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, boolean, jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_receipt_damaged(uuid, boolean, text) from public, anon, authenticated;

grant execute on function public.adjust_bin_cycle_qty(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.adjust_bin_cycle_damaged_qty(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.bin_occupied_qty(uuid) to service_role;
grant execute on function public.item_for_sale_qty(uuid) to service_role;
grant execute on function public.stock_events_mark_damaged() to service_role;
grant execute on function public.stock_events_move_damaged() to service_role;
grant execute on function public.stock_units_copy_owner() to service_role;
grant execute on function public.stock_units_block_unavailable_pick() to service_role;
grant execute on function public.assert_cycle_item_units(uuid, uuid) to service_role;
grant execute on function public.receipt_is_damaged(uuid) to service_role;
grant execute on function public.apply_receipt_qty_delta(uuid, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.post_receipt_adjustment(uuid, uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, boolean, jsonb, uuid, uuid) to service_role;
grant execute on function public.set_receipt_damaged(uuid, boolean, text) to service_role;

revoke all on table public.receipt_lines from public, anon, authenticated;
grant select on table public.receipt_lines to service_role;

notify pgrst, 'reload schema';
