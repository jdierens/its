-- A receipt with no purchase order is consigned and names a vendor.
-- The vendor and consigned flag are stored on the receipt. A cycle opened
-- by that receipt keeps them. Stock units copy them, and a later pick copies
-- the vendor onto the pick so the pieces stay attributable after they move.
-- A receipt tied to a purchase order keeps the purchase order's vendor and
-- does not set consigned.
-- Apply after supabase/migrations/20261027230000_stock_units.sql.
-- Not applied here. Review and apply by hand on project fxsbpreasbdalwthyzvk.

alter table public.stock_events
  add column if not exists vendor_id uuid references public.vendors (id),
  add column if not exists ownership text,
  add column if not exists purchase_order_id uuid references public.purchase_orders (id);

alter table public.stock_events
  drop constraint if exists stock_events_ownership_check;

alter table public.stock_events
  add constraint stock_events_ownership_check
  check (ownership is null or ownership in ('owned', 'consigned'));

comment on column public.stock_events.vendor_id is
  'Vendor this receipt is attributed to. Required when purchase_order_id is null. A purchase order supplies its own vendor.';

comment on column public.stock_events.ownership is
  'consigned when the receipt has no purchase order. Null on a purchase-order receipt, which is not forced to consigned.';

comment on column public.stock_events.purchase_order_id is
  'Purchase order this receipt was tied to. Null means the receipt is consigned to vendor_id.';

create index if not exists stock_events_vendor_idx
  on public.stock_events (vendor_id)
  where vendor_id is not null;

create index if not exists stock_events_purchase_order_idx
  on public.stock_events (purchase_order_id)
  where purchase_order_id is not null;

alter table public.bin_cycles
  add column if not exists vendor_id uuid references public.vendors (id);

comment on column public.bin_cycles.vendor_id is
  'Vendor copied when the cycle opens, or filled once from the source bin when a pick opens staging. A later receipt into an open cycle does not rewrite it. That receipt keeps its own vendor.';

create index if not exists bin_cycles_vendor_idx
  on public.bin_cycles (vendor_id)
  where vendor_id is not null;

alter table public.stock_units
  add column if not exists vendor_id uuid references public.vendors (id),
  add column if not exists ownership text;

alter table public.stock_units
  drop constraint if exists stock_units_ownership_check;

alter table public.stock_units
  add constraint stock_units_ownership_check
  check (ownership is null or ownership in ('owned', 'consigned'));

comment on column public.stock_units.vendor_id is
  'Vendor copied from the receipt, or from the pick when the unit is first identified there. A move keeps it.';

comment on column public.stock_units.ownership is
  'consigned when the unit came from a receipt with no purchase order. Null on a purchase-order receipt. A move keeps it.';

create index if not exists stock_units_vendor_idx
  on public.stock_units (vendor_id)
  where vendor_id is not null;

alter table public.so_picks
  add column if not exists vendor_id uuid references public.vendors (id);

comment on column public.so_picks.vendor_id is
  'Vendor copied from the source bin cycle at pick time. Null when that cycle has no vendor.';

create index if not exists so_picks_vendor_idx
  on public.so_picks (vendor_id)
  where vendor_id is not null;

create or replace function public.bin_cycles_keep_origin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.bin_id is distinct from old.bin_id
    or new.origin_description is distinct from old.origin_description
    or new.project is distinct from old.project
    or new.ownership is distinct from old.ownership
    or new.incoming_tag is distinct from old.incoming_tag
    or new.default_location_id is distinct from old.default_location_id
    or new.opened_location_id is distinct from old.opened_location_id
    or new.opened_at is distinct from old.opened_at
    or new.opened_by_initials is distinct from old.opened_by_initials
    or (new.vendor_id is distinct from old.vendor_id and old.vendor_id is not null)
  then
    raise exception 'A bin cycle keeps the origin it opened with.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

comment on function public.bin_cycles_keep_origin() is
  'A cycle keeps the project, ownership, and vendor it opened with. Vendor may be filled once while it is still null, which is how a pick stamps staging.';

create or replace function public.stock_units_copy_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_vendor uuid;
  v_ownership text;
begin
  if new.vendor_id is null and new.received_event_id is not null then
    select vendor_id, ownership
    into v_vendor, v_ownership
    from public.stock_events
    where id = new.received_event_id;
    new.vendor_id := v_vendor;
    if new.ownership is null then
      new.ownership := v_ownership;
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
  'Copies vendor and ownership from the receipt, or from the pick when the unit is created there.';

drop trigger if exists stock_units_copy_owner on public.stock_units;

create trigger stock_units_copy_owner
before insert on public.stock_units
for each row execute function public.stock_units_copy_owner();

create or replace function public.so_picks_copy_vendor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_vendor uuid;
begin
  if new.vendor_id is null and new.from_bin_id is not null then
    select c.vendor_id into v_vendor
    from public.bin_cycles c
    where c.bin_id = new.from_bin_id
      and c.vendor_id is not null
    order by (c.status = 'open') desc, c.opened_at desc
    limit 1;
    new.vendor_id := v_vendor;
  end if;

  if new.vendor_id is not null and new.to_bin_id is not null then
    update public.bin_cycles
    set vendor_id = new.vendor_id
    where bin_id = new.to_bin_id
      and status = 'open'
      and vendor_id is null;
  end if;

  return new;
end;
$$;

comment on function public.so_picks_copy_vendor() is
  'Copies the source cycle vendor onto the pick and, once, onto the open staging cycle.';

drop trigger if exists so_picks_copy_vendor on public.so_picks;

create trigger so_picks_copy_vendor
before insert on public.so_picks
for each row execute function public.so_picks_copy_vendor();

drop function if exists public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, jsonb);

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
  v_vendor uuid;
  v_ownership text;
  v_po uuid;
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

  v_po := p_purchase_order_id;
  if v_po is null then
    if p_vendor_id is null then
      raise exception 'Choose a vendor. A receipt without a purchase order is consigned.'
        using errcode = '22023';
    end if;
    if not exists (select 1 from public.vendors where id = p_vendor_id) then
      raise exception 'Choose a vendor.'
        using errcode = '22023';
    end if;
    v_vendor := p_vendor_id;
    v_ownership := 'consigned';
  else
    select po.vendor_id into v_vendor
    from public.purchase_orders po
    where po.id = v_po;
    if not found then
      raise exception 'Choose a purchase order.'
        using errcode = '22023';
    end if;
    if p_vendor_id is not null and p_vendor_id is distinct from v_vendor then
      raise exception 'That vendor is not on this purchase order.'
        using errcode = '22023';
    end if;
    v_ownership := null;
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
      search_query,
      vendor_id,
      ownership,
      purchase_order_id
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
      v_search,
      v_vendor,
      v_ownership,
      v_po
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
      ownership,
      vendor_id,
      default_location_id,
      opened_location_id,
      opened_by_initials
    ) values (
      v_bin.id,
      'open',
      v_origin,
      v_project,
      v_tag,
      v_ownership,
      v_vendor,
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
    search_query,
    vendor_id,
    ownership,
    purchase_order_id
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
    v_search,
    v_vendor,
    v_ownership,
    v_po
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




comment on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, jsonb, uuid, uuid) is
  'Receives a known SKU into an existing bin, or stores a pending line when the item is null. A receipt with no purchase order requires a vendor and is stored as consigned. A purchase order supplies its vendor and is not marked consigned. Optional units record a serial or country for some of the quantity.';

comment on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text) is
  'Records a receipt correction. A cycle opened while linking an item or changing putaway keeps the receipt vendor and consigned flag. The receive row keeps the vendor it was posted with.';

create or replace function public.edit_receipt(
  p_event_id uuid,
  p_initials text,
  p_received_on date,
  p_project text,
  p_incoming_tag text,
  p_origin text,
  p_origin_qty integer,
  p_comment text,
  p_qty integer,
  p_item_id uuid,
  p_confirmed boolean,
  p_cleaned boolean,
  p_wiped boolean,
  p_search_query text,
  p_bin_reference text
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
  v_old_received date;
  v_old_project text;
  v_old_tag text;
  v_old_origin text;
  v_old_origin_qty integer;
  v_old_comment text;
  v_old_qty integer;
  v_old_item uuid;
  v_old_sku text;
  v_old_name text;
  v_old_cleaned boolean;
  v_old_wiped boolean;
  v_old_search text;
  v_old_bin uuid;
  v_old_bin_ref text;
  v_old_location text;
  v_old_location_id uuid;
  v_project text := public.blank_to_null(p_project);
  v_tag text := public.blank_to_null(p_incoming_tag);
  v_origin text := public.blank_to_null(p_origin);
  v_comment text := public.blank_to_null(p_comment);
  v_search text := public.blank_to_null(p_search_query);
  v_requested text := upper(btrim(coalesce(p_bin_reference, '')));
  v_sku text;
  v_name text;
  v_check text;
  v_cleaned boolean;
  v_wiped boolean;
  v_old jsonb;
  v_new jsonb;
  v_pending boolean := false;
  v_link boolean := false;
  v_inventory boolean := false;
  v_bin_changed boolean := false;
  v_bin public.bins;
  v_on_hand integer := 0;
  v_cycle_id uuid;
  v_default uuid;
  v_location text;
  v_new_bin uuid;
  v_new_bin_ref text;
  v_new_location text;
  v_new_location_id uuid;
  v_stock_cycle uuid;
  v_stock_bin uuid;
  v_move boolean := false;
begin
  if v_initials !~ '^[A-Z]{2}$' then
    raise exception 'Operator initials must be 2 letters.'
      using errcode = '22023';
  end if;
  if p_received_on is null
    or extract(year from p_received_on) < 2000
    or extract(year from p_received_on) > 2100 then
    raise exception 'Enter a receiving date.'
      using errcode = '22023';
  end if;
  if p_origin_qty is not null and (p_origin_qty < 0 or p_origin_qty > 1000000) then
    raise exception 'Originating system qty is a whole number from 0 to 1000000.'
      using errcode = '22023';
  end if;
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then
    raise exception 'Enter a whole number from 0 to 1000000.'
      using errcode = '22023';
  end if;
  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'Comment must be 500 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_search is not null and char_length(v_search) > 500 then
    raise exception 'The search must be 500 characters or fewer.'
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
  if p_item_id is not null and not exists (select 1 from public.items where id = p_item_id) then
    raise exception 'Choose an item.'
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

  if v_event.cycle_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_event.cycle_id::text, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(p_event_id::text, 0));
  end if;

  select new_values into v_latest
  from public.stock_event_edits
  where stock_event_id = p_event_id
  order by edited_at desc, id desc
  limit 1;

  if v_latest is null then
    v_old_received := v_event.received_on;
    v_old_project := v_event.project;
    v_old_tag := v_event.incoming_tag;
    v_old_origin := v_event.origin_description;
    v_old_origin_qty := v_event.origin_qty;
    v_old_comment := v_event.comment;
    v_old_qty := v_event.qty;
    v_old_item := v_event.item_id;
  else
    v_old_received := (v_latest->>'received_on')::date;
    v_old_project := nullif(btrim(v_latest->>'project'), '');
    v_old_tag := nullif(btrim(v_latest->>'incoming_tag'), '');
    v_old_origin := nullif(btrim(v_latest->>'origin_description'), '');
    v_old_origin_qty := (v_latest->>'origin_qty')::integer;
    v_old_comment := nullif(btrim(v_latest->>'comment'), '');
    v_old_qty := (v_latest->>'qty')::integer;
    v_old_item := nullif(v_latest->>'item_id', '')::uuid;
  end if;

  v_old_cleaned := case
    when v_latest is not null and v_latest ? 'cleaned' then (v_latest->>'cleaned')::boolean
    else v_event.cleaned
  end;
  v_old_wiped := case
    when v_latest is not null and v_latest ? 'wiped' then (v_latest->>'wiped')::boolean
    else v_event.wiped
  end;
  v_old_search := case
    when v_latest is not null and v_latest ? 'search_query' then nullif(btrim(v_latest->>'search_query'), '')
    else v_event.search_query
  end;

  if v_latest is not null and v_latest ? 'bin_id' then
    v_old_bin := nullif(v_latest->>'bin_id', '')::uuid;
    v_old_bin_ref := nullif(btrim(v_latest->>'bin_reference'), '');
    v_old_location := case
      when v_latest ? 'location_code' then nullif(btrim(v_latest->>'location_code'), '')
      else null
    end;
    v_old_location_id := case
      when v_latest ? 'to_location_id' then nullif(v_latest->>'to_location_id', '')::uuid
      else null
    end;
  else
    v_old_bin := v_event.bin_id;
    v_old_location_id := v_event.to_location_id;
    select b.reference, l.code
    into v_old_bin_ref, v_old_location
    from public.bins b
    left join public.locations l on l.id = v_event.to_location_id
    where b.id = v_event.bin_id;
  end if;

  -- Stock sits on the cycle recorded by the latest correction. Until a putaway
  -- move, that is the cycle on the original receive.
  v_stock_cycle := v_event.cycle_id;
  v_stock_bin := v_event.bin_id;
  if v_latest is not null and nullif(btrim(v_latest->>'cycle_id'), '') is not null then
    v_stock_cycle := nullif(btrim(v_latest->>'cycle_id'), '')::uuid;
    v_stock_bin := coalesce(nullif(btrim(v_latest->>'bin_id'), '')::uuid, v_event.bin_id);
  end if;
  if v_stock_cycle is not null and v_stock_cycle is distinct from v_event.cycle_id then
    perform pg_advisory_xact_lock(hashtextextended(v_stock_cycle::text, 0));
  end if;

  v_pending := v_event.item_id is null and v_event.cycle_id is null and v_old_item is null;
  if v_event.bin_id is null then
    raise exception 'That receipt has no bin.'
      using errcode = '55000';
  end if;
  if v_event.cycle_id is null and not v_pending then
    raise exception 'That receipt has no cycle.'
      using errcode = '55000';
  end if;
  if p_item_id is null and not v_pending then
    raise exception 'Choose an item.'
      using errcode = '22023';
  end if;
  if p_item_id is null and v_search is null then
    raise exception 'Enter a search.'
      using errcode = '22023';
  end if;
  if v_pending and p_qty < 1 then
    raise exception 'Enter a whole number of at least 1.'
      using errcode = '22023';
  end if;

  if v_old_item is not null then
    select nullif(btrim(sku), ''), nullif(btrim(name), '')
    into v_old_sku, v_old_name
    from public.items
    where id = v_old_item;
  end if;

  if p_item_id is not null then
    select nullif(btrim(sku), ''), nullif(btrim(name), '')
    into v_sku, v_name
    from public.items
    where id = p_item_id;
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
  else
    v_cleaned := null;
    v_wiped := null;
  end if;

  if v_requested = '' then
    v_requested := coalesce(v_old_bin_ref, '');
  end if;
  if v_requested = '' then
    raise exception 'Enter a bin.'
      using errcode = '22023';
  end if;
  if v_requested !~ '^[0-9]{5}-[BCP]$' then
    raise exception 'A bin code is five digits, a hyphen, and B, C, or P.'
      using errcode = '22023';
  end if;

  v_link := v_pending and p_item_id is not null;
  v_bin_changed := v_requested is distinct from v_old_bin_ref;

  if v_bin_changed or v_link then
    select * into v_bin
    from public.bins
    where reference = v_requested
    for update;
    if not found then
      raise exception 'No bin with that code. Use New bin.'
        using errcode = 'P0002';
    end if;
    select coalesce(sum(qty), 0) into v_on_hand
    from public.bin_contents
    where bin_id = v_bin.id;
    if v_on_hand > 0 and not exists (
      select 1
      from public.bin_cycles
      where bin_id = v_bin.id
        and status = 'open'
    ) then
      raise exception 'This bin has quantity and no open cycle.'
        using errcode = '55000';
    end if;
    v_old_bin := coalesce(v_old_bin, v_event.bin_id);
    select code into v_location
    from public.locations
    where id = v_bin.current_location_id;
    v_new_bin := v_bin.id;
    v_new_bin_ref := v_bin.reference;
    v_new_location := v_location;
    v_new_location_id := v_bin.current_location_id;
  else
    v_new_bin := v_old_bin;
    v_new_bin_ref := v_old_bin_ref;
    v_new_location := v_old_location;
    v_new_location_id := v_old_location_id;
  end if;

  v_old := jsonb_build_object(
    'received_on', to_char(v_old_received, 'YYYY-MM-DD'),
    'project', v_old_project,
    'incoming_tag', v_old_tag,
    'origin_description', v_old_origin,
    'origin_qty', v_old_origin_qty,
    'comment', v_old_comment,
    'qty', v_old_qty,
    'item_id', v_old_item,
    'sku', v_old_sku,
    'item_name', v_old_name,
    'cleaned', v_old_cleaned,
    'wiped', v_old_wiped,
    'search_query', v_old_search,
    'bin_id', v_old_bin,
    'bin_reference', v_old_bin_ref,
    'location_code', v_old_location,
    'to_location_id', v_old_location_id
  );
  v_new := jsonb_build_object(
    'received_on', to_char(p_received_on, 'YYYY-MM-DD'),
    'project', v_project,
    'incoming_tag', v_tag,
    'origin_description', v_origin,
    'origin_qty', p_origin_qty,
    'comment', v_comment,
    'qty', p_qty,
    'item_id', p_item_id,
    'sku', v_sku,
    'item_name', v_name,
    'cleaned', v_cleaned,
    'wiped', v_wiped,
    'search_query', v_search,
    'bin_id', v_new_bin,
    'bin_reference', v_new_bin_ref,
    'location_code', v_new_location,
    'to_location_id', v_new_location_id
  );

  if v_old = v_new then
    return jsonb_build_object('edited', v_latest is not null, 'values', v_new);
  end if;

  if v_bin_changed and not v_pending then
    if v_bin.id is distinct from v_stock_bin then
      v_move := true;
    end if;
  end if;
  v_inventory := (not v_pending) and (
    p_qty is distinct from v_old_qty or p_item_id is distinct from v_old_item
  );
  if (v_move or v_inventory) and v_stock_cycle is null then
    raise exception 'That receipt has no cycle.'
      using errcode = '55000';
  end if;
  if (v_link or v_inventory or v_move) and p_confirmed is not true then
    raise exception 'Confirm the quantity, SKU, or putaway change.'
      using errcode = '22023';
  end if;

  if v_link then
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
        ownership,
        vendor_id,
        default_location_id,
        opened_location_id,
        opened_by_initials
      ) values (
        v_bin.id,
        'open',
        v_origin,
        v_project,
        v_tag,
        v_event.ownership,
        v_event.vendor_id,
        v_default,
        v_bin.current_location_id,
        v_initials
      )
      returning id into v_cycle_id;
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

    perform pg_advisory_xact_lock(hashtextextended(v_cycle_id::text, 0));
    perform public.adjust_bin_cycle_qty(v_cycle_id, v_bin.id, p_item_id, p_qty);

    update public.stock_events
    set item_id = p_item_id,
        cycle_id = v_cycle_id,
        bin_id = v_bin.id,
        to_location_id = v_bin.current_location_id,
        cleaned = v_cleaned,
        wiped = v_wiped
    where id = p_event_id
      and item_id is null
      and cycle_id is null;
    if not found then
      raise exception 'That receipt already has an item.'
        using errcode = '55000';
    end if;

    select code into v_location
    from public.locations
    where id = v_bin.current_location_id;
    v_new_bin := v_bin.id;
    v_new_bin_ref := v_bin.reference;
    v_new_location := v_location;
    v_new_location_id := v_bin.current_location_id;
    v_new := v_new || jsonb_build_object(
      'bin_id', v_new_bin,
      'bin_reference', v_new_bin_ref,
      'location_code', v_new_location,
      'to_location_id', v_new_location_id
    );
  elsif v_move then
    if v_old_qty > 0 and v_old_item is null then
      raise exception 'That receipt has no item.'
        using errcode = '55000';
    end if;

    -- Take this receipt's current quantity off the bin it sits on.
    if v_old_qty > 0 then
      perform public.post_receipt_adjustment(
        p_event_id, v_stock_cycle, v_stock_bin, v_old_item, -v_old_qty, v_initials
      );
    end if;
    if exists (
      select 1 from public.bin_contents where cycle_id = v_stock_cycle
    ) then
      update public.bin_cycles
      set status = 'open',
          closed_at = null
      where id = v_stock_cycle
        and status <> 'open';
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
        ownership,
        vendor_id,
        default_location_id,
        opened_location_id,
        opened_by_initials
      ) values (
        v_bin.id,
        'open',
        v_origin,
        v_project,
        v_tag,
        v_event.ownership,
        v_event.vendor_id,
        v_default,
        v_bin.current_location_id,
        v_initials
      )
      returning id into v_cycle_id;
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

    perform pg_advisory_xact_lock(hashtextextended(v_cycle_id::text, 0));

    -- Put that quantity on the destination cycle. A zero qty only retargets the line.
    if p_qty > 0 then
      perform public.post_receipt_adjustment(
        p_event_id, v_cycle_id, v_bin.id, p_item_id, p_qty, v_initials
      );
    end if;

    select code into v_location
    from public.locations
    where id = v_bin.current_location_id;
    v_new_bin := v_bin.id;
    v_new_bin_ref := v_bin.reference;
    v_new_location := v_location;
    v_new_location_id := v_bin.current_location_id;
    v_new := v_new || jsonb_build_object(
      'bin_id', v_new_bin,
      'bin_reference', v_new_bin_ref,
      'location_code', v_new_location,
      'to_location_id', v_new_location_id
    );
  elsif v_inventory then
    if p_item_id is distinct from v_old_item then
      perform public.post_receipt_adjustment(
        p_event_id, v_stock_cycle, v_stock_bin, v_old_item, -v_old_qty, v_initials
      );
      perform public.post_receipt_adjustment(
        p_event_id, v_stock_cycle, v_stock_bin, p_item_id, p_qty, v_initials
      );
    else
      perform public.post_receipt_adjustment(
        p_event_id, v_stock_cycle, v_stock_bin, p_item_id, p_qty - v_old_qty, v_initials
      );
    end if;

    if exists (
      select 1 from public.bin_contents where cycle_id = v_stock_cycle
    ) then
      update public.bin_cycles
      set status = 'open',
          closed_at = null
      where id = v_stock_cycle
        and status <> 'open';
    end if;
  end if;

  if coalesce(v_cycle_id, v_stock_cycle) is not null and (not v_pending or v_link) then
    v_new := v_new || jsonb_build_object('cycle_id', coalesce(v_cycle_id, v_stock_cycle));
    v_old := v_old || jsonb_build_object('cycle_id', v_stock_cycle);
  end if;

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

  return jsonb_build_object('edited', true, 'values', v_new);
end;
$$;

create or replace view public.receipt_lines
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
  'Recent receipts with the latest correction applied. Vendor, ownership, and purchase order stay on the receipt. A pending line has a blank SKU until an item is linked.';

revoke all on function public.stock_units_copy_owner() from public, anon, authenticated;
revoke all on function public.so_picks_copy_vendor() from public, anon, authenticated;
revoke all on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text) from public, anon, authenticated;

grant execute on function public.stock_units_copy_owner() to service_role;
grant execute on function public.so_picks_copy_vendor() to service_role;
grant execute on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, jsonb, uuid, uuid) to service_role;
grant execute on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text) to service_role;

revoke all on table public.receipt_lines from public, anon, authenticated;
grant select on table public.receipt_lines to service_role;

notify pgrst, 'reload schema';
