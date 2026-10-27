-- Stock units: an optional serial and country of origin on one piece of an item.
-- bin_contents.qty is the on-hand quantity. A stock_units row is an identified
-- piece inside that quantity. The serial may be null so a later warehouse edit
-- can fill it in, or a later flow can insert rows for quantity that has none.
-- Country of origin is the same ISO alpha-3 code as items.coo. Alpha-2 is accepted
-- and stored as alpha-3. Both fields are optional.
-- A receive with K identities for quantity N inserts K units and adds N to the bin.
-- K cannot exceed N. Pieces with neither a serial nor a country stay as quantity only.
-- A move or pick relocates the fewest units that would otherwise exceed the quantity
-- left behind. Units with no serial move first. The ledger's unit_id is set when a
-- movement covers exactly one unit. inventory_movement_units lists every unit on
-- the out and the in row.
-- Sales-order serials stay on so_units and now point at stock_units. A serial first
-- seen at pick time creates a unit in the staging bin. Finish still does not require
-- a serial or a country.
-- Not applied here. Review and apply by hand on project fxsbpreasbdalwthyzvk
-- after supabase/migrations/20261027170000_sales_order_picking.sql.

create table public.stock_units (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id),
  serial_number text,
  serial_source text,
  country_of_origin text,
  bin_id uuid references public.bins (id),
  cycle_id uuid references public.bin_cycles (id),
  status text not null default 'in_stock',
  origin text not null default 'receive',
  received_event_id uuid references public.stock_events (id),
  pick_id uuid references public.so_picks (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_units_status_check check (status in ('in_stock', 'issued')),
  constraint stock_units_origin_check check (origin in ('receive', 'pick')),
  constraint stock_units_serial_source_check check (
    serial_source is null or serial_source in ('receive', 'pick')
  ),
  constraint stock_units_serial_pair_check check (
    (serial_number is null and serial_source is null)
    or (
      serial_number is not null
      and serial_source is not null
      and char_length(serial_number) > 0
      and char_length(serial_number) <= 80
      and serial_number = btrim(serial_number)
    )
  ),
  constraint stock_units_location_check check (
    (status = 'in_stock' and bin_id is not null and cycle_id is not null)
    or (status <> 'in_stock' and bin_id is null and cycle_id is null)
  ),
  constraint stock_units_coo_fkey foreign key (country_of_origin) references public.countries (alpha3)
);

comment on table public.stock_units is
  'One piece of an item. bin_contents.qty is the on-hand quantity. A row may omit serial_number until a later update fills it in. in_stock rows sit in a bin cycle. issued rows have left the bin and are reserved for a later ship flow. origin receive was created while receiving. origin pick was created when a serial was first known on a sales order.';

comment on column public.stock_units.serial_source is
  'receive when the serial was captured on the receipt. pick when a sales-order attach filled a blank serial or created the unit. Null while the unit has no serial.';

comment on column public.stock_units.country_of_origin is
  'ISO 3166-1 alpha-3, the same code as items.coo. Null when the piece has no country yet. A later edit can set it.';

comment on column public.stock_units.pick_id is
  'The open sales-order pick that moved this unit into staging. Null while the unit is still in a stock bin.';

create unique index stock_units_item_serial_idx
  on public.stock_units (item_id, lower(btrim(serial_number)))
  where serial_number is not null;

create index stock_units_item_idx on public.stock_units (item_id);
create index stock_units_cycle_item_idx
  on public.stock_units (cycle_id, item_id)
  where status = 'in_stock';
create index stock_units_bin_item_idx
  on public.stock_units (bin_id, item_id)
  where status = 'in_stock';
create index stock_units_pick_idx on public.stock_units (pick_id) where pick_id is not null;
create index stock_units_event_idx
  on public.stock_units (received_event_id)
  where received_event_id is not null;
create index stock_units_coo_idx
  on public.stock_units (country_of_origin)
  where country_of_origin is not null;

create or replace function public.stock_units_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.serial_number is not null then
    new.serial_number := nullif(btrim(new.serial_number), '');
  end if;
  if new.serial_number is null then
    new.serial_source := null;
  end if;
  return new;
end;
$$;

create trigger stock_units_touch
before insert or update on public.stock_units
for each row execute function public.stock_units_touch();

alter table public.so_units
  add column stock_unit_id uuid,
  add column country_of_origin text;

alter table public.so_units
  add constraint so_units_stock_unit_fkey
  foreign key (stock_unit_id) references public.stock_units (id);

alter table public.so_units
  add constraint so_units_coo_fkey
  foreign key (country_of_origin) references public.countries (alpha3);

create unique index so_units_stock_unit_idx
  on public.so_units (stock_unit_id)
  where stock_unit_id is not null;

create index so_units_coo_idx
  on public.so_units (country_of_origin)
  where country_of_origin is not null;

create unique index so_units_item_serial_ci_idx
  on public.so_units (item_id, lower(btrim(serial_number)))
  where serial_number is not null;

comment on column public.so_units.stock_unit_id is
  'The stock unit this sales-order serial identifies. Null on serials recorded before stock units existed.';

comment on column public.so_units.country_of_origin is
  'ISO alpha-3 copied from the stock unit when the serial was attached. Optional.';

alter table public.inventory_movements
  add constraint inventory_movements_unit_fkey
  foreign key (unit_id) references public.stock_units (id);

create index inventory_movements_unit_idx
  on public.inventory_movements (unit_id)
  where unit_id is not null;

comment on column public.inventory_movements.unit_id is
  'Set when this ledger row covers exactly one stock unit. A quantity that covers several units keeps this null and lists them in inventory_movement_units.';

create table public.inventory_movement_units (
  movement_id uuid not null references public.inventory_movements (id) on delete cascade,
  stock_unit_id uuid not null references public.stock_units (id),
  primary key (movement_id, stock_unit_id)
);

comment on table public.inventory_movement_units is
  'Units a quantity ledger row moved. The matching out and in rows each get one link per unit. inventory_movements.unit_id repeats the link when there is only one unit.';

create index inventory_movement_units_unit_idx
  on public.inventory_movement_units (stock_unit_id);

create or replace function public.assert_cycle_item_units(p_cycle uuid, p_item uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_units integer;
  v_qty integer;
begin
  if p_cycle is null or p_item is null then
    return;
  end if;

  select count(*) into v_units
  from public.stock_units
  where cycle_id = p_cycle
    and item_id = p_item
    and status = 'in_stock';

  select qty into v_qty
  from public.bin_contents
  where cycle_id = p_cycle
    and item_id = p_item;

  if v_units > coalesce(v_qty, 0) then
    raise exception 'That bin would have % units for this item and only % on hand.', v_units, coalesce(v_qty, 0)
      using errcode = '23514';
  end if;
end;
$$;

comment on function public.assert_cycle_item_units(uuid, uuid) is
  'Rejects a cycle whose in-stock units exceed bin_contents.qty. Quantity with no unit row is allowed.';

create or replace function public.assert_stock_unit_balance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name = 'stock_units' then
    if tg_op = 'UPDATE' then
      if old.cycle_id is distinct from new.cycle_id or old.item_id is distinct from new.item_id then
        perform public.assert_cycle_item_units(old.cycle_id, old.item_id);
      end if;
      perform public.assert_cycle_item_units(new.cycle_id, new.item_id);
    elsif tg_op = 'DELETE' then
      perform public.assert_cycle_item_units(old.cycle_id, old.item_id);
    else
      perform public.assert_cycle_item_units(new.cycle_id, new.item_id);
    end if;
  elsif tg_op = 'DELETE' then
    perform public.assert_cycle_item_units(old.cycle_id, old.item_id);
  else
    perform public.assert_cycle_item_units(new.cycle_id, new.item_id);
  end if;
  return null;
end;
$$;

create constraint trigger stock_units_balance
after insert or update or delete on public.stock_units
deferrable initially deferred
for each row
execute function public.assert_stock_unit_balance();

create constraint trigger bin_contents_cover_units
after insert or update or delete on public.bin_contents
deferrable initially deferred
for each row
execute function public.assert_stock_unit_balance();

create or replace function public.normalize_serial(p_serial text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_serial, '')), '');
$$;

create or replace function public.normalize_country(p_code text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_code text := nullif(upper(btrim(coalesce(p_code, ''))), '');
  v_alpha3 text;
begin
  if v_code is null then
    return null;
  end if;
  select alpha3 into v_alpha3
  from public.countries
  where alpha3 = v_code;
  if v_alpha3 is null then
    select alpha3 into v_alpha3
    from public.countries
    where alpha2 = v_code;
  end if;
  if v_alpha3 is null then
    raise exception 'Choose a country of origin.'
      using errcode = '22023';
  end if;
  return v_alpha3;
end;
$$;

comment on function public.normalize_country(text) is
  'Blank becomes null. An alpha-3 or alpha-2 country code becomes the alpha-3 stored on items.coo.';

create or replace function public.lock_item_units(p_item uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_item::text, 0));
end;
$$;

create or replace function public.link_movement_units(
  p_out uuid,
  p_in uuid,
  p_units uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_unit uuid;
begin
  if p_units is null or cardinality(p_units) = 0 then
    return;
  end if;

  if cardinality(p_units) = 1 and p_out is not null then
    update public.inventory_movements
    set unit_id = p_units[1]
    where id = p_out;
  end if;
  if cardinality(p_units) = 1 and p_in is not null then
    update public.inventory_movements
    set unit_id = p_units[1]
    where id = p_in;
  end if;

  foreach v_unit in array p_units loop
    if p_out is not null then
      insert into public.inventory_movement_units (movement_id, stock_unit_id)
      values (p_out, v_unit)
      on conflict do nothing;
    end if;
    if p_in is not null then
      insert into public.inventory_movement_units (movement_id, stock_unit_id)
      values (p_in, v_unit)
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

comment on function public.link_movement_units(uuid, uuid, uuid[]) is
  'Points the out and in ledger rows at the units they moved. unit_id is set only for a single unit.';

create or replace function public.place_received_units(
  p_event_id uuid,
  p_cycle uuid,
  p_bin uuid,
  p_item uuid,
  p_qty integer,
  p_units jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_line jsonb;
  v_serial text;
  v_coo text;
  v_sku text;
  v_seen text[] := '{}';
  v_count integer := 0;
begin
  if p_units is null or jsonb_typeof(p_units) = 'null' then
    return 0;
  end if;
  if jsonb_typeof(p_units) <> 'array' then
    raise exception 'Serials must be a list.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_units) = 0 then
    return 0;
  end if;
  if jsonb_array_length(p_units) > p_qty then
    raise exception 'Enter at most one serial for each piece.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_units) > 2000 then
    raise exception 'Enter at most 2000 serials on one receipt.'
      using errcode = '22023';
  end if;
  if p_item is null then
    raise exception 'Choose an item before entering serials.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.bin_cycles where id = p_cycle and bin_id = p_bin
  ) then
    raise exception 'That cycle is not on this bin.'
      using errcode = '23514';
  end if;

  perform public.lock_item_units(p_item);
  select nullif(btrim(sku), '') into v_sku from public.items where id = p_item;

  for v_line in
    select value from jsonb_array_elements(p_units)
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Serials must be a list.'
        using errcode = '22023';
    end if;
    v_serial := public.normalize_serial(v_line ->> 'serial');
    v_coo := public.normalize_country(v_line ->> 'coo');
    if v_serial is null and v_coo is null then
      continue;
    end if;
    if v_serial is not null then
      if char_length(v_serial) > 80 then
        raise exception 'A serial is at most 80 characters.'
          using errcode = '22023';
      end if;
      if v_sku is not null and upper(v_serial) = upper(v_sku) then
        raise exception 'That scan is the SKU, not a serial.'
          using errcode = '22023';
      end if;
      if v_serial ~ '^\d{1,5}-[A-Za-z]$' then
        raise exception 'That scan is a bin code, not a serial.'
          using errcode = '22023';
      end if;
      if lower(v_serial) = any (v_seen) then
        raise exception 'That serial is already in this receipt.'
          using errcode = '22023';
      end if;
      if exists (
        select 1
        from public.stock_units
        where item_id = p_item
          and serial_number is not null
          and lower(btrim(serial_number)) = lower(v_serial)
      ) or exists (
        select 1
        from public.so_units
        where item_id = p_item
          and lower(btrim(serial_number)) = lower(v_serial)
      ) then
        raise exception 'That serial is already recorded for this item.'
          using errcode = '22023';
      end if;
      v_seen := v_seen || lower(v_serial);
    end if;

    begin
      insert into public.stock_units (
        item_id, serial_number, serial_source, country_of_origin,
        bin_id, cycle_id, status, origin, received_event_id
      ) values (
        p_item,
        v_serial,
        case when v_serial is null then null else 'receive' end,
        v_coo,
        p_bin,
        p_cycle,
        'in_stock',
        'receive',
        p_event_id
      );
    exception
      when unique_violation then
        raise exception 'That serial is already recorded for this item.'
          using errcode = '22023';
    end;
    v_count := v_count + 1;
  end loop;

  if v_count > p_qty then
    raise exception 'Enter at most one serial for each piece.'
      using errcode = '22023';
  end if;
  return v_count;
end;
$$;

comment on function public.place_received_units(uuid, uuid, uuid, uuid, integer, jsonb) is
  'Inserts one in-stock unit per serial or country on a receipt. Fewer identities than the quantity leaves the rest as quantity only. Does not change bin_contents.';

create or replace function public.relocate_stock_units(
  p_from_cycle uuid,
  p_from_bin uuid,
  p_to_cycle uuid,
  p_to_bin uuid,
  p_item uuid,
  p_qty integer,
  p_pick uuid,
  p_out uuid,
  p_in uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_units integer;
  v_qty integer;
  v_move integer;
  v_ids uuid[];
begin
  if p_qty is null or p_qty < 1 or p_from_cycle is null or p_to_cycle is null then
    return 0;
  end if;

  perform public.lock_item_units(p_item);

  select count(*) into v_units
  from public.stock_units
  where cycle_id = p_from_cycle
    and item_id = p_item
    and status = 'in_stock';

  select qty into v_qty
  from public.bin_contents
  where cycle_id = p_from_cycle
    and item_id = p_item;

  v_move := greatest(coalesce(v_units, 0) - coalesce(v_qty, 0), 0);
  if v_move = 0 then
    return 0;
  end if;

  with chosen as (
    select id
    from public.stock_units
    where cycle_id = p_from_cycle
      and item_id = p_item
      and status = 'in_stock'
    order by (serial_number is null) desc, created_at, id
    limit v_move
    for update
  ),
  moved as (
    update public.stock_units unit
    set bin_id = p_to_bin,
        cycle_id = p_to_cycle,
        pick_id = coalesce(p_pick, unit.pick_id)
    from chosen
    where unit.id = chosen.id
    returning unit.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from moved;

  perform public.link_movement_units(p_out, p_in, v_ids);
  return coalesce(cardinality(v_ids), 0);
end;
$$;

comment on function public.relocate_stock_units(uuid, uuid, uuid, uuid, uuid, integer, uuid, uuid, uuid) is
  'Moves the units that no longer fit in the source cycle after a quantity change. Call it in the same transaction as the bin_contents update. Unserialized units move first.';

create or replace function public.return_pick_units(
  p_pick uuid,
  p_source_cycle uuid,
  p_source_bin uuid,
  p_out uuid,
  p_in uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item uuid;
  v_ids uuid[];
begin
  select item_id into v_item from public.so_picks where id = p_pick;
  if v_item is not null then
    perform public.lock_item_units(v_item);
  end if;

  update public.so_units
  set stock_unit_id = null
  where pick_id = p_pick
    and stock_unit_id is not null;

  delete from public.stock_units
  where pick_id = p_pick
    and origin = 'pick';

  with moved as (
    update public.stock_units
    set bin_id = p_source_bin,
        cycle_id = p_source_cycle,
        pick_id = null,
        serial_number = case when serial_source = 'pick' then null else serial_number end,
        serial_source = case when serial_source = 'pick' then null else serial_source end
    where pick_id = p_pick
      and origin = 'receive'
      and status = 'in_stock'
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from moved;

  perform public.link_movement_units(p_out, p_in, v_ids);
end;
$$;

comment on function public.return_pick_units(uuid, uuid, uuid, uuid, uuid) is
  'Puts receipt units from a pick back in the source bin and drops units that were created only for that pick. A serial filled in at pick time is cleared. A serial captured at receive stays.';

create or replace function public.settle_receipt_units()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_item uuid := nullif(new.old_values ->> 'item_id', '')::uuid;
  v_new_item uuid := nullif(new.new_values ->> 'item_id', '')::uuid;
  v_old_cycle uuid := nullif(new.old_values ->> 'cycle_id', '')::uuid;
  v_new_cycle uuid := nullif(new.new_values ->> 'cycle_id', '')::uuid;
  v_new_bin uuid := nullif(new.new_values ->> 'bin_id', '')::uuid;
  v_qty integer := nullif(new.new_values ->> 'qty', '')::integer;
  v_here integer;
begin
  if v_new_item is null and v_old_item is null then
    return new;
  end if;

  select count(*) into v_here
  from public.stock_units
  where received_event_id = new.stock_event_id
    and status = 'in_stock'
    and pick_id is null
    and (
      v_old_cycle is null
      or cycle_id = v_old_cycle
      or (v_new_cycle is not null and cycle_id = v_new_cycle)
    );

  if v_qty is not null and v_here > v_qty then
    raise exception 'This receipt has % units. Quantity cannot go below that.', v_here
      using errcode = '22023';
  end if;

  if v_new_item is not distinct from v_old_item
    and (v_new_cycle is null or v_new_cycle is not distinct from v_old_cycle) then
    return new;
  end if;

  begin
    update public.stock_units
    set item_id = coalesce(v_new_item, item_id),
        bin_id = coalesce(v_new_bin, bin_id),
        cycle_id = coalesce(v_new_cycle, cycle_id)
    where received_event_id = new.stock_event_id
      and status = 'in_stock'
      and pick_id is null
      and (v_old_cycle is null or cycle_id = v_old_cycle);
  exception
    when unique_violation then
      raise exception 'That serial is already recorded for this item.'
        using errcode = '22023';
  end;

  return new;
end;
$$;

create trigger stock_event_edits_follow_units
after insert on public.stock_event_edits
for each row execute function public.settle_receipt_units();

comment on function public.settle_receipt_units() is
  'Keeps units from a receipt on the bin and item a receipt edit just posted. Quantity cannot drop below the units from that receipt that are still in the bin.';

-- Replaced functions follow.

drop function if exists public.receive_into_bin(text, uuid, integer, text, text, text, text, text);
drop function if exists public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer);
drop function if exists public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text);
drop function if exists public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text);
drop function if exists public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean);
drop function if exists public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text);
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
  p_units jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ref text := upper(btrim(coalesce(p_reference, '')));
  v_initials text := public.operator_initials(p_initials);
  v_comment text := public.blank_to_null(p_comment);
  v_project text := public.blank_to_null(p_project);
  v_origin text := public.blank_to_null(p_origin);
  v_tag text := public.blank_to_null(p_incoming_tag);
  v_request text := public.blank_to_null(p_client_request_id);
  v_scan text := public.blank_to_null(p_scan_raw);
  v_search text := public.blank_to_null(p_search_query);
  v_check text;
  v_cleaned boolean;
  v_wiped boolean;
  v_bin public.bins;
  v_on_hand integer;
  v_cycle_id uuid;
  v_opened boolean := false;
  v_default uuid;
  v_qty integer;
  v_location text;
  v_event_id uuid;
  v_existing_id uuid;
  v_receipt jsonb;
begin
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 then
    raise exception 'Enter a whole number of at least 1.'
      using errcode = '22023';
  end if;
  if p_received_on is null then
    raise exception 'Enter a receiving date.'
      using errcode = '22023';
  end if;
  if p_origin_qty is not null and (p_origin_qty < 0 or p_origin_qty > 1000000) then
    raise exception 'Originating system qty is a whole number from 0 to 1000000.'
      using errcode = '22023';
  end if;
  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'Comment must be 500 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_origin is not null and char_length(v_origin) > 500 then
    raise exception 'Originating system must be 500 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_project is not null and char_length(v_project) > 120 then
    raise exception 'Project must be 120 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_tag is not null and char_length(v_tag) > 120 then
    raise exception 'Incoming bin must be 120 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_request is not null and char_length(v_request) > 80 then
    raise exception 'Request id must be 80 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_scan is not null and char_length(v_scan) > 500 then
    raise exception 'The scan must be 500 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_search is not null and char_length(v_search) > 500 then
    raise exception 'The search must be 500 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_comment is null then
    v_comment := v_scan;
  end if;

  if p_item_id is null
    and p_units is not null
    and jsonb_typeof(p_units) <> 'null'
    and (jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) > 0) then
    raise exception 'Choose an item before entering serials.'
      using errcode = '22023';
  end if;

  if p_item_id is null then
    if v_search is null then
      raise exception 'Enter a search.'
        using errcode = '22023';
    end if;
    v_cleaned := null;
    v_wiped := null;
  else
    if not exists (select 1 from public.items where id = p_item_id) then
      raise exception 'Choose an item.'
        using errcode = '22023';
    end if;
    v_check := public.item_receive_check(p_item_id);
    if v_check = 'cleaned' then
      v_cleaned := coalesce(p_cleaned, false);
      v_wiped := null;
    elsif v_check = 'wiped' then
      v_cleaned := null;
      v_wiped := coalesce(p_wiped, false);
    else
      v_cleaned := null;
      v_wiped := null;
    end if;
  end if;

  if v_request is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_request, 0));
    select id into v_existing_id
    from public.stock_events
    where client_request_id = v_request;
    if found then
      return public.receive_event_payload(v_existing_id);
    end if;
  end if;

  select * into v_bin
  from public.bins
  where reference = v_ref
  for update;

  if not found then
    raise exception 'No bin with that code. Use New bin.'
      using errcode = 'P0002';
  end if;

  select coalesce(sum(qty), 0) into v_on_hand
  from public.bin_contents
  where bin_id = v_bin.id;

  if p_item_id is null then
    if v_on_hand > 0 and not exists (
      select 1
      from public.bin_cycles
      where bin_id = v_bin.id
        and status = 'open'
    ) then
      raise exception 'This bin has quantity and no open cycle.'
        using errcode = '55000';
    end if;

    insert into public.stock_events (
      event_type,
      bin_id,
      cycle_id,
      item_id,
      qty,
      operator_initials,
      comment,
      project,
      incoming_tag,
      origin_description,
      origin_qty,
      received_on,
      to_location_id,
      client_request_id,
      scan_raw,
      cleaned,
      wiped,
      search_query
    ) values (
      'receive_into_bin',
      v_bin.id,
      null,
      null,
      p_qty,
      v_initials,
      v_comment,
      v_project,
      v_tag,
      v_origin,
      p_origin_qty,
      p_received_on,
      v_bin.current_location_id,
      v_request,
      v_scan,
      null,
      null,
      v_search
    )
    returning id into v_event_id;

    select code into v_location
    from public.locations
    where id = v_bin.current_location_id;

    return jsonb_build_object(
      'bin_id', v_bin.id,
      'reference', v_bin.reference,
      'type', v_bin.type,
      'cycle_id', null,
      'cycle_opened', false,
      'location_code', v_location,
      'qty', p_qty,
      'received_on', p_received_on,
      'event_id', v_event_id,
      'pending', true
    );
  end if;

  if v_on_hand <= 0 then
    update public.bin_cycles
    set status = 'closed',
        closed_at = coalesce(closed_at, now())
    where bin_id = v_bin.id
      and status = 'open';

    if v_bin.current_location_id is null then
      select location_id into v_bin.current_location_id
      from public.bin_default_locations
      where bin_type = v_bin.type;
      update public.bins
      set current_location_id = v_bin.current_location_id
      where id = v_bin.id;
    end if;

    select location_id into v_default
    from public.bin_default_locations
    where bin_type = v_bin.type;

    insert into public.bin_cycles (
      bin_id,
      status,
      origin_description,
      project,
      incoming_tag,
      default_location_id,
      opened_location_id,
      opened_by_initials
    ) values (
      v_bin.id,
      'open',
      v_origin,
      v_project,
      v_tag,
      v_default,
      v_bin.current_location_id,
      v_initials
    )
    returning id into v_cycle_id;
    v_opened := true;
  else
    select id into v_cycle_id
    from public.bin_cycles
    where bin_id = v_bin.id
      and status = 'open';
    if v_cycle_id is null then
      raise exception 'This bin has quantity and no open cycle.'
        using errcode = '55000';
    end if;
  end if;

  v_qty := public.adjust_bin_cycle_qty(v_cycle_id, v_bin.id, p_item_id, p_qty);

  insert into public.stock_events (
    event_type,
    bin_id,
    cycle_id,
    item_id,
    qty,
    operator_initials,
    comment,
    project,
    incoming_tag,
    origin_description,
    origin_qty,
    received_on,
    to_location_id,
    client_request_id,
    scan_raw,
    cleaned,
    wiped,
    search_query
  ) values (
    'receive_into_bin',
    v_bin.id,
    v_cycle_id,
    p_item_id,
    p_qty,
    v_initials,
    v_comment,
    v_project,
    v_tag,
    v_origin,
    p_origin_qty,
    p_received_on,
    v_bin.current_location_id,
    v_request,
    v_scan,
    v_cleaned,
    v_wiped,
    v_search
  )
  returning id into v_event_id;

  select code into v_location
  from public.locations
  where id = v_bin.current_location_id;

  return jsonb_build_object(
    'bin_id', v_bin.id,
    'reference', v_bin.reference,
    'type', v_bin.type,
    'cycle_id', v_cycle_id,
    'cycle_opened', v_opened,
    'location_code', v_location,
    'qty', v_qty,
    'received_on', p_received_on,
    'event_id', v_event_id,
    'pending', false,
    'units', public.place_received_units(v_event_id, v_cycle_id, v_bin.id, p_item_id, p_qty, p_units)
  );
exception
  when unique_violation then
    if v_request is null then
      raise;
    end if;
    select id into v_existing_id
    from public.stock_events
    where client_request_id = v_request;
    if v_existing_id is null then
      raise;
    end if;
    return public.receive_event_payload(v_existing_id);
end;
$$;


comment on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, jsonb) is
  'Receives a known SKU into an existing bin, or stores a pending line when the item is null. Optional units record a serial or country for some of the quantity. Bin quantity still increases by the full quantity. A repeated client request id returns the receipt already written.';

comment on function public.pick_sales_order_line(uuid, uuid, uuid, integer, text, uuid, text) is
  'Moves a whole quantity from one stock bin into the order staging bin. Keeps the source project and consigned ownership. Relocates stock units that would no longer fit in the source. One request id picks once.';

comment on function public.undo_sales_order_pick(uuid, text, uuid) is
  'Moves a pick back to its source bin and keeps the project. Returns receipt units and drops units created for the pick. Removes any serials on that pick.';

comment on function public.perform_item_move(uuid, uuid, uuid, integer, text, text) is
  'Moves a quantity of one item between bins and relocates stock units that would no longer fit in the source. Does not change items.quantity.';

create or replace function public.sales_order_pick_sheet(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.sales_orders;
  v_customer text;
  v_list_id uuid;
  v_pick_status text;
  v_staging text;
  v_lines jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_staging_stock jsonb := '[]'::jsonb;
  v_orphans jsonb := '[]'::jsonb;
  v_handoff text;
  r record;
begin
  select * into v_order from public.sales_orders where id = p_order;
  if not found then
    raise exception 'Sales order not found.'
      using errcode = 'P0002';
  end if;

  select display_name into v_customer
  from public.customers
  where id = v_order.customer_id;

  select id, status into v_list_id, v_pick_status
  from public.so_pick_lists
  where sales_order_id = p_order
    and status <> 'cancelled'
  order by created_at desc
  limit 1;

  if v_order.staging_bin_id is not null then
    select reference into v_staging from public.bins where id = v_order.staging_bin_id;
  end if;

  for r in
    select
      a.id as allocation_id,
      a.item_id,
      a.qty as ordered,
      l.line_no,
      i.sku,
      i.name,
      i.coo as item_coo
    from public.so_lines l
    join public.so_line_allocations a on a.so_line_id = l.id
    join public.items i on i.id = a.item_id
    where l.sales_order_id = p_order
      and l.line_kind in ('product', 'kit')
      and i.item_type in ('Product', 'Kit/Package')
    order by l.line_no, a.alloc_no
  loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'allocation_id', r.allocation_id,
      'line_no', r.line_no,
      'sku', r.sku,
      'name', r.name,
      'item_coo', r.item_coo,
      'ordered', r.ordered,
      'picked', coalesce((
        select sum(p.qty_picked)
        from public.so_picks p
        where p.pick_list_id = v_list_id
          and p.allocation_id = r.allocation_id
      ), 0),
      'short', exists (
        select 1
        from public.so_picks p
        where p.pick_list_id = v_list_id
          and p.allocation_id = r.allocation_id
          and p.short
      ),
      'bins', coalesce((
        select jsonb_agg(jsonb_build_object(
          'bin_id', b.id,
          'reference', b.reference,
          'location', loc.code,
          'qty', contents.qty,
          'project', cycle.project,
          'ownership', public.so_pick_ownership(cycle.project, cycle.ownership)
        ) order by b.reference)
        from public.bin_contents contents
        join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
        join public.bins b on b.id = contents.bin_id
        left join public.locations loc on loc.id = b.current_location_id
        where contents.item_id = r.item_id
          and contents.qty > 0
          and not exists (
            select 1
            from public.sales_orders staged
            where staged.staging_bin_id = b.id
               or staged.staging_bin_id = b.parent_bin_id
          )
      ), '[]'::jsonb),
      'picks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'from_bin', fb.reference,
          'qty', p.qty_picked,
          'project', p.project,
          'ownership', p.ownership,
          'serials', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', u.id,
              'serial', u.serial_number,
              'coo', u.country_of_origin
            ) order by u.scanned_at, u.id)
            from public.so_units u
            where u.pick_id = p.id
          ), '[]'::jsonb)
        ) order by p.picked_at nulls last, p.id)
        from public.so_picks p
        left join public.bins fb on fb.id = p.from_bin_id
        where p.pick_list_id = v_list_id
          and p.allocation_id = r.allocation_id
          and p.qty_picked > 0
      ), '[]'::jsonb)
    ));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_no', skipped.line_no,
    'sku', skipped.sku,
    'name', skipped.name,
    'reason', skipped.reason
  ) order by skipped.line_no, skipped.sku), '[]'::jsonb)
  into v_skipped
  from (
    select
      l.line_no,
      i.sku,
      coalesce(i.name, l.customer_description) as name,
      case
        when l.line_kind not in ('product', 'kit') then 'Freight, fee, and service lines are not picked.'
        when a.id is null then 'No SKU on this line.'
        else 'Not a stock item.'
      end as reason
    from public.so_lines l
    left join public.so_line_allocations a on a.so_line_id = l.id
    left join public.items i on i.id = a.item_id
    where l.sales_order_id = p_order
      and not (
        l.line_kind in ('product', 'kit')
        and i.item_type in ('Product', 'Kit/Package')
      )
  ) skipped;

  if v_order.staging_bin_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'reference', b.reference,
      'project', cycle.project,
      'ownership', cycle.ownership,
      'qty', contents.qty,
      'sku', i.sku
    ) order by b.reference, i.sku), '[]'::jsonb)
    into v_staging_stock
    from public.bin_contents contents
    join public.bins b on b.id = contents.bin_id
    join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
    join public.items i on i.id = contents.item_id
    where b.id = v_order.staging_bin_id
       or b.parent_bin_id = v_order.staging_bin_id;
  end if;

  if v_list_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'from_bin', fb.reference,
      'qty', p.qty_picked,
      'project', p.project,
      'ownership', p.ownership,
      'sku', i.sku,
      'name', i.name,
      'serials', coalesce((
        select jsonb_agg(jsonb_build_object('id', u.id, 'serial', u.serial_number,
              'coo', u.country_of_origin) order by u.scanned_at)
        from public.so_units u
        where u.pick_id = p.id
      ), '[]'::jsonb)
    ) order by p.picked_at nulls last), '[]'::jsonb)
    into v_orphans
    from public.so_picks p
    left join public.bins fb on fb.id = p.from_bin_id
    left join public.items i on i.id = p.item_id
    where p.pick_list_id = v_list_id
      and p.allocation_id is null
      and p.qty_picked > 0;
  end if;

  v_handoff := case v_pick_status
    when 'picked' then 'Picked into the staging bin. Packing is next and is not on this screen yet.'
    when 'short' then 'Short pick is recorded. Packing is next and is not on this screen yet.'
    else null
  end;

  return jsonb_build_object(
    'order_id', v_order.id,
    'so_number', v_order.so_number,
    'status', v_order.status,
    'customer', coalesce(v_customer, ''),
    'customer_po', v_order.customer_po,
    'pick_list_id', v_list_id,
    'pick_status', v_pick_status,
    'staging_bin', v_staging,
    'staging', v_staging_stock,
    'finish_block', case
      when v_pick_status is distinct from 'open' then null
      else public.so_pick_finish_block(v_list_id)
    end,
    'handoff', v_handoff,
    'lines', v_lines,
    'skipped', v_skipped,
    'orphans', v_orphans
  );
end;
$$;

create or replace function public.pick_sales_order_line(
  p_order uuid,
  p_allocation uuid,
  p_from uuid,
  p_qty integer,
  p_initials text,
  p_operator uuid,
  p_request text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
  v_request text := public.blank_to_null(p_request);
  v_list uuid;
  v_ordered numeric;
  v_item uuid;
  v_sku text;
  v_picked numeric;
  v_have integer;
  v_source_cycle uuid;
  v_project text;
  v_raw_ownership text;
  v_ownership text;
  v_target uuid;
  v_target_cycle uuid;
  v_got_project text;
  v_got_ownership text;
  v_number bigint;
  v_transfer uuid := gen_random_uuid();
  v_out uuid;
  v_in uuid;
  v_pick uuid;
  v_from_ref text;
  v_to_ref text;
begin
  if v_request is null or char_length(v_request) < 8 or char_length(v_request) > 80 then
    raise exception 'Request id is required.'
      using errcode = '22023';
  end if;
  if p_qty is null or p_qty < 1 then
    raise exception 'Enter a whole number of at least 1.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_request, 0));
  if exists (select 1 from public.so_picks where client_request_id = v_request) then
    if not exists (
      select 1
      from public.so_picks p
      join public.so_pick_lists pl on pl.id = p.pick_list_id
      where p.client_request_id = v_request
        and pl.sales_order_id = p_order
    ) then
      raise exception 'That request was already used.'
        using errcode = '22023';
    end if;
    return public.sales_order_pick_sheet(p_order);
  end if;

  if (select status from public.sales_orders where id = p_order for update) not in ('approved', 'picking') then
    raise exception 'Start from an approved sales order.'
      using errcode = '22023';
  end if;

  select id into v_list
  from public.so_pick_lists
  where sales_order_id = p_order
    and status = 'open'
  for update;
  if v_list is null then
    raise exception 'Open the pick sheet before recording a pick.'
      using errcode = '22023';
  end if;

  select a.qty, a.item_id, i.sku
  into v_ordered, v_item, v_sku
  from public.so_line_allocations a
  join public.so_lines l on l.id = a.so_line_id
  join public.items i on i.id = a.item_id
  where a.id = p_allocation
    and l.sales_order_id = p_order
    and l.line_kind in ('product', 'kit')
    and i.item_type in ('Product', 'Kit/Package');
  if v_item is null then
    raise exception 'That line is not picked.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.sales_orders staged
    join public.bins source on source.id = p_from
    where staged.staging_bin_id = source.id
       or staged.staging_bin_id = source.parent_bin_id
  ) then
    raise exception 'Pick from a stock bin, not a staging bin.'
      using errcode = '22023';
  end if;

  perform public.lock_bins(array[p_from]);

  select contents.qty, contents.cycle_id, cycle.project, cycle.ownership
  into v_have, v_source_cycle, v_project, v_raw_ownership
  from public.bin_contents contents
  join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
  where contents.bin_id = p_from
    and contents.item_id = v_item
  for update of contents;

  if v_have is null then
    raise exception 'That bin does not hold this item.'
      using errcode = '22023';
  end if;
  if p_qty > v_have then
    raise exception 'Only % are in that bin.', v_have
      using errcode = '22023';
  end if;

  select coalesce(sum(qty_picked), 0) into v_picked
  from public.so_picks
  where pick_list_id = v_list
    and allocation_id = p_allocation;
  if v_picked + p_qty > v_ordered then
    raise exception 'Only % still to pick.', greatest(v_ordered - v_picked, 0)
      using errcode = '22023';
  end if;

  v_project := nullif(btrim(coalesce(v_project, '')), '');
  v_ownership := public.so_pick_ownership(v_project, v_raw_ownership);
  v_target := public.so_pick_target_bin(p_order, v_project, v_ownership, v_initials);
  perform public.lock_bins(array[p_from, v_target]);
  v_target_cycle := public.so_pick_open_cycle(v_target, v_project, v_ownership, v_initials);

  select project, ownership into v_got_project, v_got_ownership
  from public.bin_cycles
  where id = v_target_cycle;
  if v_got_project is distinct from v_project or v_got_ownership is distinct from v_ownership then
    raise exception 'Staging lost the project on this stock.'
      using errcode = '55000';
  end if;

  perform public.adjust_bin_cycle_qty(v_source_cycle, p_from, v_item, -p_qty);
  perform public.adjust_bin_cycle_qty(v_target_cycle, v_target, v_item, p_qty);

  select so_number into v_number from public.sales_orders where id = p_order;
  select reference into v_from_ref from public.bins where id = p_from;
  select reference into v_to_ref from public.bins where id = v_target;

  insert into public.inventory_movements (
    item_id, bin_id, direction, qty, ownership, stock_status, transfer_id,
    ref_type, ref_id, ref_label, operator_id, operator_label, occurred_at, notes, reason
  ) values (
    v_item, p_from, 'out', p_qty, v_ownership, 'available', v_transfer,
    'sales_order', p_order, 'SO' || v_number::text, v_operator, v_initials, now(),
    v_project, 'sales order pick'
  )
  returning id into v_out;

  insert into public.inventory_movements (
    item_id, bin_id, direction, qty, ownership, stock_status, transfer_id,
    ref_type, ref_id, ref_label, source_movement_id, operator_id, operator_label,
    occurred_at, notes, reason
  ) values (
    v_item, v_target, 'in', p_qty, v_ownership, 'available', v_transfer,
    'sales_order', p_order, 'SO' || v_number::text, v_out, v_operator, v_initials, now(),
    v_project, 'sales order pick'
  )
  returning id into v_in;

  insert into public.so_picks (
    pick_list_id, allocation_id, item_id, from_bin_id, to_bin_id,
    qty_asked, qty_picked, short, transfer_id, project, ownership,
    operator_id, operator_label, picked_at, client_request_id
  ) values (
    v_list, p_allocation, v_item, p_from, v_target,
    p_qty, p_qty, false, v_transfer, v_project, v_ownership,
    v_operator, v_initials, now(), v_request
  )
  returning id into v_pick;

  perform public.relocate_stock_units(
    v_source_cycle, p_from, v_target_cycle, v_target, v_item, p_qty, v_pick, v_out, v_in
  );

  if v_picked + p_qty >= v_ordered then
    update public.so_picks
    set short = false
    where pick_list_id = v_list
      and allocation_id = p_allocation;
  end if;

  return public.sales_order_pick_sheet(p_order);
end;
$$;

create or replace function public.undo_sales_order_pick(
  p_pick uuid,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
  v_order uuid;
  v_status text;
  v_item uuid;
  v_from uuid;
  v_to uuid;
  v_qty numeric;
  v_project text;
  v_ownership text;
  v_number bigint;
  v_have integer;
  v_source_cycle uuid;
  v_stage_cycle uuid;
  v_transfer uuid := gen_random_uuid();
  v_out uuid;
  v_in uuid;
begin
  select
    pl.sales_order_id, pl.status, p.item_id, p.from_bin_id, p.to_bin_id,
    p.qty_picked, p.project, p.ownership
  into v_order, v_status, v_item, v_from, v_to, v_qty, v_project, v_ownership
  from public.so_picks p
  join public.so_pick_lists pl on pl.id = p.pick_list_id
  where p.id = p_pick
  for update of p;

  if v_order is null then
    raise exception 'That pick was not found.'
      using errcode = 'P0002';
  end if;
  if v_status is distinct from 'open' then
    raise exception 'This pick sheet is already finished.'
      using errcode = '22023';
  end if;

  perform 1 from public.sales_orders where id = v_order for update;

  if coalesce(v_qty, 0) < 1 or v_from is null or v_to is null then
    delete from public.so_picks where id = p_pick;
    return public.sales_order_pick_sheet(v_order);
  end if;

  perform public.lock_bins(array[v_from, v_to]);

  select contents.qty, contents.cycle_id
  into v_have, v_stage_cycle
  from public.bin_contents contents
  join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
  where contents.bin_id = v_to
    and contents.item_id = v_item
  for update of contents;

  if v_have is null or v_have < v_qty then
    raise exception 'Staging no longer has that quantity.'
      using errcode = '22023';
  end if;
  if (select project from public.bin_cycles where id = v_stage_cycle) is distinct from nullif(btrim(coalesce(v_project, '')), '') then
    raise exception 'Staging no longer has that project.'
      using errcode = '22023';
  end if;

  if v_qty <> trunc(v_qty) then
    raise exception 'That pick is not a whole number.'
      using errcode = '22023';
  end if;

  v_source_cycle := public.so_restore_source_cycle(v_from, v_project, v_ownership, v_initials);
  perform public.adjust_bin_cycle_qty(v_stage_cycle, v_to, v_item, (-v_qty)::integer);
  perform public.adjust_bin_cycle_qty(v_source_cycle, v_from, v_item, v_qty::integer);

  select so_number into v_number from public.sales_orders where id = v_order;
  v_ownership := public.so_pick_ownership(v_project, v_ownership);

  insert into public.inventory_movements (
    item_id, bin_id, direction, qty, ownership, transfer_id, ref_type, ref_id, ref_label,
    operator_id, operator_label, notes, reason
  ) values (
    v_item, v_to, 'out', v_qty, v_ownership, v_transfer, 'sales_order', v_order,
    'SO' || v_number::text, v_operator, v_initials, nullif(btrim(coalesce(v_project, '')), ''),
    'undo sales order pick'
  )
  returning id into v_out;

  insert into public.inventory_movements (
    item_id, bin_id, direction, qty, ownership, transfer_id, ref_type, ref_id, ref_label,
    source_movement_id, operator_id, operator_label, notes, reason
  ) values (
    v_item, v_from, 'in', v_qty, v_ownership, v_transfer, 'sales_order', v_order,
    'SO' || v_number::text, v_out, v_operator, v_initials, nullif(btrim(coalesce(v_project, '')), ''),
    'undo sales order pick'
  )
  returning id into v_in;

  perform public.return_pick_units(p_pick, v_source_cycle, v_from, v_out, v_in);

  delete from public.so_picks where id = p_pick;
  return public.sales_order_pick_sheet(v_order);
end;
$$;

create or replace function public.perform_item_move(
  p_from uuid,
  p_to uuid,
  p_item uuid,
  p_qty integer,
  p_initials text,
  p_comment text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_have integer;
  v_source_cycle uuid;
  v_target_cycle uuid;
  v_from_ref text;
  v_to_ref text;
  v_from_label text;
  v_to_label text;
  v_sku text;
  v_name text;
  v_comment text := public.blank_to_null(p_comment);
  v_transfer uuid := gen_random_uuid();
  v_out uuid;
  v_in uuid;
  v_summary text;
begin
  select contents.qty, contents.cycle_id
  into v_have, v_source_cycle
  from public.bin_contents contents
  join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
  where contents.bin_id = p_from
    and contents.item_id = p_item
  for update of contents;

  if v_have is null then
    raise exception 'That bin does not hold this item.'
      using errcode = '22023';
  end if;
  if p_qty > v_have then
    raise exception 'Only % are in that bin.', v_have
      using errcode = '22023';
  end if;

  v_target_cycle := public.ensure_open_bin_cycle(p_to, p_initials);
  perform public.adjust_bin_cycle_qty(v_source_cycle, p_from, p_item, -p_qty);
  perform public.adjust_bin_cycle_qty(v_target_cycle, p_to, p_item, p_qty);

  select reference, public.bin_display_label(type, reference)
  into v_from_ref, v_from_label
  from public.bins
  where id = p_from;
  select reference, public.bin_display_label(type, reference)
  into v_to_ref, v_to_label
  from public.bins
  where id = p_to;
  select sku, name into v_sku, v_name from public.items where id = p_item;

  insert into public.inventory_movements (
    item_id,
    bin_id,
    direction,
    qty,
    transfer_id,
    ref_type,
    ref_id,
    ref_label,
    operator_label,
    occurred_at,
    notes,
    reason
  ) values (
    p_item,
    p_from,
    'out',
    p_qty,
    v_transfer,
    'bin_transfer',
    v_transfer,
    v_from_ref || ' to ' || v_to_ref,
    p_initials,
    now(),
    v_comment,
    coalesce(v_comment, 'bin transfer')
  )
  returning id into v_out;

  insert into public.inventory_movements (
    item_id,
    bin_id,
    direction,
    qty,
    transfer_id,
    ref_type,
    ref_id,
    ref_label,
    source_movement_id,
    operator_label,
    occurred_at,
    notes,
    reason
  ) values (
    p_item,
    p_to,
    'in',
    p_qty,
    v_transfer,
    'bin_transfer',
    v_transfer,
    v_from_ref || ' to ' || v_to_ref,
    v_out,
    p_initials,
    now(),
    v_comment,
    coalesce(v_comment, 'bin transfer')
  )
  returning id into v_in;

  perform public.relocate_stock_units(
    v_source_cycle, p_from, v_target_cycle, p_to, p_item, p_qty, null, v_out, v_in
  );

  v_summary := format(
    'Move %s of %s from %s to %s',
    p_qty,
    btrim(coalesce(v_sku, '') || ' ' || coalesce(v_name, '')),
    v_from_label,
    v_to_label
  );

  return jsonb_build_object(
    'summary', v_summary,
    'transfer_id', v_transfer,
    'qty', p_qty,
    'reverse_op', jsonb_build_object(
      'op', 'item',
      'from_bin_ref', v_to_ref,
      'to_bin_ref', v_from_ref,
      'item_id', p_item,
      'qty', p_qty,
      'comment', 'undo'
    )
  );
end;
$$;


drop function if exists public.record_pick_serial(uuid, text, text, uuid);

create or replace function public.record_pick_serial(
  p_pick uuid,
  p_serial text,
  p_initials text,
  p_operator uuid,
  p_coo text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator);
  v_serial text := public.normalize_serial(p_serial);
  v_coo text;
  v_order uuid;
  v_item uuid;
  v_sku text;
  v_qty numeric;
  v_from uuid;
  v_to uuid;
  v_attached integer;
  v_status text;
  v_unit uuid;
  v_unit_bin uuid;
  v_unit_cycle uuid;
  v_unit_pick uuid;
  v_stage_cycle uuid;
  v_stage_qty integer;
  v_stage_units integer;
  v_swap uuid;
  v_swap_bin uuid;
  v_swap_cycle uuid;
  v_ref text;
begin
  select pl.sales_order_id, pl.status, p.item_id, p.qty_picked, p.from_bin_id, p.to_bin_id, i.sku
  into v_order, v_status, v_item, v_qty, v_from, v_to, v_sku
  from public.so_picks p
  join public.so_pick_lists pl on pl.id = p.pick_list_id
  left join public.items i on i.id = p.item_id
  where p.id = p_pick
  for update of p;

  if v_order is null then
    raise exception 'That pick was not found.'
      using errcode = 'P0002';
  end if;
  if v_status is distinct from 'open' then
    raise exception 'This pick sheet is already finished.'
      using errcode = '22023';
  end if;
  if coalesce(v_qty, 0) < 1 then
    raise exception 'Pick a quantity before scanning a serial.'
      using errcode = '22023';
  end if;
  if v_serial is null then
    raise exception 'Enter a serial.'
      using errcode = '22023';
  end if;
  if char_length(v_serial) > 80 then
    raise exception 'A serial is at most 80 characters.'
      using errcode = '22023';
  end if;
  if v_sku is not null and upper(v_serial) = upper(btrim(v_sku)) then
    raise exception 'That scan is the SKU, not a serial.'
      using errcode = '22023';
  end if;
  if v_serial ~ '^\d{1,5}-[A-Za-z]$' then
    raise exception 'That scan is a bin code, not a serial.'
      using errcode = '22023';
  end if;
  v_coo := public.normalize_country(p_coo);

  perform public.lock_item_units(v_item);
  if exists (
    select 1
    from public.so_units
    where item_id = v_item
      and lower(btrim(serial_number)) = lower(v_serial)
  ) then
    raise exception 'That serial is already recorded for this item.'
      using errcode = '22023';
  end if;

  select count(*) into v_attached from public.so_units where pick_id = p_pick;
  if v_attached >= v_qty then
    raise exception 'This pick already has a serial for each piece.'
      using errcode = '22023';
  end if;

  select contents.cycle_id, contents.qty
  into v_stage_cycle, v_stage_qty
  from public.bin_contents contents
  join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
  where contents.bin_id = v_to
    and contents.item_id = v_item
  for update of contents;

  if v_stage_cycle is null then
    raise exception 'Staging no longer has that quantity.'
      using errcode = '22023';
  end if;

  select count(*) into v_stage_units
  from public.stock_units
  where cycle_id = v_stage_cycle
    and item_id = v_item
    and status = 'in_stock';

  select unit.id, unit.bin_id, unit.cycle_id, unit.pick_id, bin.reference
  into v_unit, v_unit_bin, v_unit_cycle, v_unit_pick, v_ref
  from public.stock_units unit
  left join public.bins bin on bin.id = unit.bin_id
  where unit.item_id = v_item
    and unit.serial_number is not null
    and lower(btrim(unit.serial_number)) = lower(v_serial)
  for update of unit;

  if v_unit is not null then
    if exists (select 1 from public.so_units where stock_unit_id = v_unit) then
      raise exception 'That serial is already recorded for this item.'
        using errcode = '22023';
    end if;
    if v_unit_pick is not null and v_unit_pick <> p_pick then
      raise exception 'That serial is on another pick.'
        using errcode = '22023';
    end if;
    if v_unit_bin is distinct from v_to and v_unit_bin is distinct from v_from then
      raise exception 'That serial is in %.', coalesce(v_ref, 'another bin')
        using errcode = '22023';
    end if;
    if v_unit_bin = v_from and v_unit_bin is distinct from v_to then
      if coalesce(v_stage_qty, 0) - coalesce(v_stage_units, 0) >= 1 then
        update public.stock_units
        set bin_id = v_to,
            cycle_id = v_stage_cycle,
            pick_id = p_pick,
            country_of_origin = coalesce(v_coo, country_of_origin)
        where id = v_unit;
      else
        select swap.id, swap.bin_id, swap.cycle_id
        into v_swap, v_swap_bin, v_swap_cycle
        from public.stock_units swap
        where swap.pick_id = p_pick
          and swap.status = 'in_stock'
          and swap.id <> v_unit
          and not exists (
            select 1 from public.so_units linked where linked.stock_unit_id = swap.id
          )
        order by (swap.serial_number is null) desc, swap.created_at, swap.id
        limit 1
        for update;
        if v_swap is null then
          raise exception 'That serial is in % and this pick is already identified.', coalesce(v_ref, 'the source bin')
            using errcode = '22023';
        end if;
        update public.stock_units
        set bin_id = v_unit_bin,
            cycle_id = v_unit_cycle,
            pick_id = null
        where id = v_swap;
        update public.stock_units
        set bin_id = v_swap_bin,
            cycle_id = v_swap_cycle,
            pick_id = p_pick,
            country_of_origin = coalesce(v_coo, country_of_origin)
        where id = v_unit;
      end if;
    else
      update public.stock_units
      set pick_id = p_pick,
          cycle_id = v_stage_cycle,
          bin_id = v_to,
          country_of_origin = coalesce(v_coo, country_of_origin)
      where id = v_unit;
    end if;
  else
    select unit.id
    into v_unit
    from public.stock_units unit
    where unit.pick_id = p_pick
      and unit.item_id = v_item
      and unit.status = 'in_stock'
      and unit.serial_number is null
      and not exists (
        select 1 from public.so_units linked where linked.stock_unit_id = unit.id
      )
    order by unit.created_at, unit.id
    limit 1
    for update;
    if v_unit is not null then
      update public.stock_units
      set serial_number = v_serial,
          serial_source = 'pick',
          country_of_origin = coalesce(v_coo, country_of_origin)
      where id = v_unit;
    else
      if coalesce(v_stage_qty, 0) - coalesce(v_stage_units, 0) < 1 then
        raise exception 'This pick already has a serial for each piece.'
          using errcode = '22023';
      end if;
      insert into public.stock_units (
        item_id, serial_number, serial_source, country_of_origin,
        bin_id, cycle_id, status, origin, pick_id
      ) values (
        v_item, v_serial, 'pick', v_coo, v_to, v_stage_cycle, 'in_stock', 'pick', p_pick
      )
      returning id into v_unit;
    end if;
  end if;

  insert into public.so_units (
    pick_id, item_id, serial_number, country_of_origin, stock_unit_id, operator_id, operator_label
  )
  select p_pick, v_item, v_serial, unit.country_of_origin, unit.id, v_operator, v_initials
  from public.stock_units unit
  where unit.id = v_unit;

  return public.sales_order_pick_sheet(v_order);
exception
  when unique_violation then
    raise exception 'That serial is already recorded for this item.'
      using errcode = '22023';
end;
$$;

comment on function public.record_pick_serial(uuid, text, text, uuid, text) is
  'Attaches one optional serial to a pick and links it to a stock unit. Country of origin is optional. A serial already in another bin is rejected. Finish does not require a serial.';

create or replace function public.remove_pick_serial(
  p_unit uuid,
  p_initials text,
  p_operator uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_status text;
  v_stock uuid;
  v_origin text;
  v_serial_source text;
begin
  perform public.operator_initials(p_initials);
  perform public.so_known_operator(p_operator);

  select pl.sales_order_id, pl.status, u.stock_unit_id
  into v_order, v_status, v_stock
  from public.so_units u
  join public.so_picks p on p.id = u.pick_id
  join public.so_pick_lists pl on pl.id = p.pick_list_id
  where u.id = p_unit;

  if v_order is null then
    raise exception 'That serial was not found.'
      using errcode = 'P0002';
  end if;
  if v_status is distinct from 'open' then
    raise exception 'This pick sheet is already finished.'
      using errcode = '22023';
  end if;

  if v_stock is not null then
    select origin, serial_source
    into v_origin, v_serial_source
    from public.stock_units
    where id = v_stock
    for update;

    update public.so_units
    set stock_unit_id = null
    where id = p_unit;

    if v_serial_source = 'pick' then
      update public.stock_units
      set serial_number = null,
          serial_source = null
      where id = v_stock;
    end if;

    if v_origin = 'pick' and not exists (
      select 1
      from public.stock_units
      where id = v_stock
        and (serial_number is not null or country_of_origin is not null)
    ) then
      delete from public.stock_units where id = v_stock;
    end if;
  end if;

  delete from public.so_units where id = p_unit;
  return public.sales_order_pick_sheet(v_order);
end;
$$;


alter table public.stock_units enable row level security;
alter table public.inventory_movement_units enable row level security;

revoke all on table public.stock_units from public, anon, authenticated;
revoke all on table public.inventory_movement_units from public, anon, authenticated;
grant all on table public.stock_units to service_role;
grant all on table public.inventory_movement_units to service_role;

revoke all on function public.stock_units_touch() from public, anon, authenticated;
revoke all on function public.assert_cycle_item_units(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assert_stock_unit_balance() from public, anon, authenticated;
revoke all on function public.normalize_serial(text) from public, anon, authenticated;
revoke all on function public.normalize_country(text) from public, anon, authenticated;
revoke all on function public.lock_item_units(uuid) from public, anon, authenticated;
revoke all on function public.link_movement_units(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.place_received_units(uuid, uuid, uuid, uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.relocate_stock_units(uuid, uuid, uuid, uuid, uuid, integer, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.return_pick_units(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.settle_receipt_units() from public, anon, authenticated;
revoke all on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_pick_serial(uuid, text, text, uuid, text) from public, anon, authenticated;

grant execute on function public.stock_units_touch() to service_role;
grant execute on function public.assert_cycle_item_units(uuid, uuid) to service_role;
grant execute on function public.assert_stock_unit_balance() to service_role;
grant execute on function public.normalize_serial(text) to service_role;
grant execute on function public.normalize_country(text) to service_role;
grant execute on function public.lock_item_units(uuid) to service_role;
grant execute on function public.link_movement_units(uuid, uuid, uuid[]) to service_role;
grant execute on function public.place_received_units(uuid, uuid, uuid, uuid, integer, jsonb) to service_role;
grant execute on function public.relocate_stock_units(uuid, uuid, uuid, uuid, uuid, integer, uuid, uuid, uuid) to service_role;
grant execute on function public.return_pick_units(uuid, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.settle_receipt_units() to service_role;
grant execute on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, jsonb) to service_role;
grant execute on function public.record_pick_serial(uuid, text, text, uuid, text) to service_role;

notify pgrst, 'reload schema';
