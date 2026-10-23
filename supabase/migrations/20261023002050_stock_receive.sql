-- Phase 1 stock. One row per physical bin code. Each use is a bin cycle.
-- Default put-away locations are settings. A change is stored on bins and
-- cycles created after it. Existing rows are left as they are.
-- Location types are a prefix plus a pattern. Shelves (HWS) and racking (HWR)
-- are seeded. Other types can be added later. This file does not invent a lab code.
-- items.quantity is not written. Quantity for this slice lives on bin_contents.
-- Not applied here. Review and apply by hand.

create or replace function public.location_pattern_ok(p_pattern text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_pattern is null or btrim(p_pattern) = '' then
    return false;
  end if;
  perform '' ~ p_pattern;
  return true;
exception when others then
  return false;
end;
$$;

create table public.location_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  prefix text not null,
  pattern text not null,
  created_at timestamptz not null default now(),
  constraint location_types_slug_unique unique (slug),
  constraint location_types_prefix_unique unique (prefix),
  constraint location_types_slug_check check (slug ~ '^[a-z][a-z0-9_]{0,40}$'),
  constraint location_types_prefix_check check (prefix ~ '^[A-Z][A-Z0-9]{0,11}$'),
  constraint location_types_name_check check (char_length(btrim(name)) between 1 and 80),
  constraint location_types_pattern_check check (
    char_length(pattern) between 2 and 200
    and public.location_pattern_ok(pattern)
  )
);

comment on table public.location_types is
  'A place kind. prefix plus pattern validates a location code. Shelves and racking are seeded. Admins add other kinds, such as an office lab, without a code being invented here.';

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  location_type_id uuid not null references public.location_types (id),
  "row" text,
  bay text,
  elevation text,
  orientation text,
  description text,
  created_at timestamptz not null default now(),
  constraint locations_code_unique unique (code),
  constraint locations_code_check check (code = btrim(code) and char_length(code) > 0),
  constraint locations_row_check check ("row" is null or "row" ~ '^\d{2}$'),
  constraint locations_bay_check check (bay is null or bay ~ '^\d{2}$'),
  constraint locations_elevation_check check (elevation is null or elevation ~ '^\d{2}$'),
  constraint locations_orientation_check check (orientation is null or orientation in ('N', 'S', 'E', 'W', 'C'))
);

comment on table public.locations is
  'A place a bin can be put away to. The code matches its location type. Row, bay, elevation, and orientation are filled for shelves and racking.';

create or replace function public.locations_apply_type()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slug text;
  v_prefix text;
  v_pattern text;
  v_name text;
begin
  new.code := upper(btrim(coalesce(new.code, '')));
  select slug, prefix, pattern, name
  into v_slug, v_prefix, v_pattern, v_name
  from public.location_types
  where id = new.location_type_id;

  if v_slug is null then
    raise exception 'Choose a location type.'
      using errcode = '23503';
  end if;
  if left(new.code, char_length(v_prefix)) <> v_prefix or new.code !~ v_pattern then
    raise exception '% does not match the % pattern.', new.code, v_name
      using errcode = '22023';
  end if;

  if v_slug = 'shelves' then
    new."row" := split_part(new.code, '.', 2);
    new.bay := split_part(new.code, '.', 3);
    new.elevation := split_part(new.code, '.', 4);
    new.orientation := null;
  elsif v_slug = 'racking' then
    new."row" := split_part(new.code, '.', 2);
    new.bay := split_part(new.code, '.', 3);
    new.elevation := split_part(new.code, '.', 4);
    new.orientation := nullif(split_part(new.code, '.', 5), '');
  else
    new."row" := null;
    new.bay := null;
    new.elevation := null;
    new.orientation := null;
  end if;

  if new.description is null or btrim(new.description) = '' then
    new.description := v_name;
  end if;
  return new;
end;
$$;

create trigger locations_apply_type
before insert or update on public.locations
for each row execute function public.locations_apply_type();

insert into public.location_types (slug, name, prefix, pattern) values
  ('shelves', 'Henderson Warehouse Shelves', 'HWS', '^HWS\.\d{2}\.\d{2}\.\d{2}$'),
  ('racking', 'Henderson Warehouse Racking', 'HWR', '^HWR\.\d{2}\.\d{2}\.\d{2}(\.[NSEWC])?$');

insert into public.locations (code, location_type_id, description)
select 'HWS.00.00.00', id, 'Henderson Warehouse Shelves'
from public.location_types
where slug = 'shelves';

insert into public.locations (code, location_type_id, description)
select 'HWR.00.00.00', id, 'Henderson Warehouse Racking'
from public.location_types
where slug = 'racking';

create table public.bin_default_locations (
  bin_type text primary key,
  location_id uuid not null references public.locations (id),
  updated_at timestamptz not null default now(),
  constraint bin_default_locations_type_check check (bin_type in ('B', 'C', 'P'))
);

comment on table public.bin_default_locations is
  'The put-away location used when a bin of this suffix is created, and recorded on a cycle when that cycle opens. Updating a row here does not change bins or cycles that already exist.';

insert into public.bin_default_locations (bin_type, location_id)
select suffix.bin_type, loc.id
from (values ('B', 'HWS.00.00.00'), ('C', 'HWS.00.00.00'), ('P', 'HWR.00.00.00')) as suffix(bin_type, code)
join public.locations loc on loc.code = suffix.code;

alter table public.bins
  add column created_by_initials text;

comment on column public.bins.reference is
  'The physical code, one row per code. This is the label. A later use of the same code is a new bin cycle, not a new bins row.';

comment on column public.bins.current_location_id is
  'Where the bin is now. Set from bin_default_locations when the row is created, then changed by a move. A settings change does not rewrite it.';

comment on column public.bins.created_by_initials is
  'Initials recorded when Receiving creates the bin. Null for bins reserved from the print desk.';

alter table public.bins
  add constraint bins_current_location_id_fkey
  foreign key (current_location_id) references public.locations (id);

create or replace function public.bins_apply_default_location()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.current_location_id is null then
    select d.location_id into new.current_location_id
    from public.bin_default_locations d
    where d.bin_type = new.type;
  end if;
  return new;
end;
$$;

create trigger bins_apply_default_location
before insert on public.bins
for each row execute function public.bins_apply_default_location();

create table public.bin_cycles (
  id uuid primary key default gen_random_uuid(),
  bin_id uuid not null references public.bins (id),
  status text not null,
  origin_description text,
  project text,
  incoming_tag text,
  default_location_id uuid references public.locations (id),
  opened_location_id uuid references public.locations (id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by_initials text,
  constraint bin_cycles_status_check check (status in ('open', 'closed')),
  constraint bin_cycles_closed_check check (
    (status = 'open' and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  )
);

comment on table public.bin_cycles is
  'One use of a physical bin. Opens on the first receive into an empty bin and closes when its quantity reaches 0. The next receive opens another cycle on the same bins row. Lineage points here. default_location_id is the put-away setting at open and is not rewritten when the setting changes.';

create unique index bin_cycles_one_open_idx
  on public.bin_cycles (bin_id)
  where status = 'open';

create index bin_cycles_bin_opened_idx
  on public.bin_cycles (bin_id, opened_at desc);

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
    or new.incoming_tag is distinct from old.incoming_tag
    or new.default_location_id is distinct from old.default_location_id
    or new.opened_location_id is distinct from old.opened_location_id
    or new.opened_at is distinct from old.opened_at
    or new.opened_by_initials is distinct from old.opened_by_initials
  then
    raise exception 'A bin cycle keeps the origin it opened with.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger bin_cycles_keep_origin
before update on public.bin_cycles
for each row execute function public.bin_cycles_keep_origin();

create table public.bin_contents (
  id uuid primary key default gen_random_uuid(),
  bin_id uuid not null references public.bins (id),
  cycle_id uuid not null references public.bin_cycles (id),
  item_id uuid not null references public.items (id),
  qty integer not null,
  constraint bin_contents_qty_check check (qty > 0),
  constraint bin_contents_cycle_item_unique unique (cycle_id, item_id)
);

comment on table public.bin_contents is
  'Quantity of one SKU in an open bin cycle. Rows exist only while qty is above 0, so an empty bin is not a consolidation target.';

create index bin_contents_item_idx on public.bin_contents (item_id);

create or replace function public.bin_contents_same_bin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.bin_cycles c
    where c.id = new.cycle_id
      and c.bin_id = new.bin_id
  ) then
    raise exception 'That cycle is not on this bin.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger bin_contents_same_bin
before insert or update on public.bin_contents
for each row execute function public.bin_contents_same_bin();

create table public.stock_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  bin_id uuid not null references public.bins (id),
  cycle_id uuid references public.bin_cycles (id),
  item_id uuid references public.items (id),
  qty integer,
  occurred_at timestamptz not null default now(),
  operator_initials text not null,
  comment text,
  project text,
  incoming_tag text,
  from_location_id uuid references public.locations (id),
  to_location_id uuid references public.locations (id),
  constraint stock_events_type_check check (event_type in ('receive_into_bin', 'move_bin_location')),
  constraint stock_events_initials_check check (char_length(btrim(operator_initials)) > 0),
  constraint stock_events_receive_check check (
    event_type <> 'receive_into_bin'
    or (
      item_id is not null
      and cycle_id is not null
      and qty is not null
      and qty > 0
    )
  ),
  constraint stock_events_move_check check (
    event_type <> 'move_bin_location'
    or to_location_id is not null
  )
);

comment on table public.stock_events is
  'Append-only quantity log for this slice. receive_into_bin points at the bin cycle. move_bin_location points at the open cycle when there is one. items.quantity is not updated from these rows.';

create index stock_events_bin_idx on public.stock_events (bin_id, occurred_at);
create index stock_events_cycle_idx on public.stock_events (cycle_id, occurred_at);

create or replace function public.reject_stock_event_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Stock events cannot be changed.'
    using errcode = '55000';
end;
$$;

create trigger stock_events_append_only
before update or delete on public.stock_events
for each row execute function public.reject_stock_event_change();

create or replace function public.finish_bin_cycle(p_cycle_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.bin_contents where cycle_id = p_cycle_id
  ) then
    update public.bin_cycles
    set status = 'closed',
        closed_at = now()
    where id = p_cycle_id
      and status = 'open';
  end if;
end;
$$;

comment on function public.finish_bin_cycle(uuid) is
  'Closes an open cycle once it has no content rows. A later receive opens a new cycle.';

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
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'Enter a whole number other than 0.'
      using errcode = '22023';
  end if;

  select qty into v_qty
  from public.bin_contents
  where cycle_id = p_cycle_id
    and item_id = p_item_id
  for update;

  v_qty := coalesce(v_qty, 0) + p_delta;
  if v_qty <= 0 then
    delete from public.bin_contents
    where cycle_id = p_cycle_id
      and item_id = p_item_id;
    v_qty := 0;
  else
    insert into public.bin_contents (bin_id, cycle_id, item_id, qty)
    values (p_bin_id, p_cycle_id, p_item_id, v_qty)
    on conflict (cycle_id, item_id) do update
    set qty = excluded.qty;
  end if;

  perform public.finish_bin_cycle(p_cycle_id);
  return v_qty;
end;
$$;

comment on function public.adjust_bin_cycle_qty(uuid, uuid, uuid, integer) is
  'Adds or removes quantity on a cycle. At 0 the content row is removed and the cycle closes. Phase 1 receiving only adds.';

create or replace function public.operator_initials(p_initials text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_initials text := upper(btrim(coalesce(p_initials, '')));
begin
  if v_initials = '' or char_length(v_initials) > 12 then
    raise exception 'Operator initials are required.'
      using errcode = '22023';
  end if;
  return v_initials;
end;
$$;

create or replace function public.blank_to_null(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_value, '')), '');
$$;

create or replace function public.resolve_location(p_code text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_id uuid;
  v_type uuid;
  v_count integer;
begin
  if v_code = '' then
    raise exception 'Enter a location code.'
      using errcode = '22023';
  end if;

  select id into v_id
  from public.locations
  where code = v_code;
  if v_id is not null then
    return v_id;
  end if;

  select count(*) into v_count
  from public.location_types
  where left(v_code, char_length(prefix)) = prefix
    and v_code ~ pattern;

  if v_count = 0 then
    raise exception 'No location type matches %.', v_code
      using errcode = '22023';
  end if;
  if v_count > 1 then
    raise exception 'More than one location type matches %.', v_code
      using errcode = '22023';
  end if;

  select id into v_type
  from public.location_types
  where left(v_code, char_length(prefix)) = prefix
    and v_code ~ pattern;

  insert into public.locations (code, location_type_id)
  values (v_code, v_type)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_receiving_bin(
  p_type text,
  p_code text,
  p_initials text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_type text := upper(btrim(coalesce(p_type, '')));
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_initials text := public.operator_initials(p_initials);
  v_next integer;
  v_number integer;
  v_existing text;
  v_bin public.bins;
  v_location text;
begin
  if v_type not in ('B', 'C', 'P') then
    raise exception 'Choose box, crate, or pallet.'
      using errcode = '22023';
  end if;

  select next_number into v_next
  from public.bin_counter
  where id
  for update;

  if v_next is null then
    raise exception 'Bin counter is missing.'
      using errcode = '55000';
  end if;

  if v_code = '' then
    if v_next < 10000 or v_next > 99999 then
      raise exception 'The next bin number must be five digits. Set it in Settings.'
        using errcode = '22023';
    end if;
    v_number := v_next;
    v_code := v_number::text || '-' || v_type;
  else
    if v_code !~ '^\d{5}-[BCP]$' or right(v_code, 1) <> v_type then
      raise exception 'A bin code is five digits, a hyphen, and B, C, or P.'
        using errcode = '22023';
    end if;
    v_number := split_part(v_code, '-', 1)::integer;
    if v_number::text <> split_part(v_code, '-', 1) then
      raise exception 'A bin code is five digits, a hyphen, and B, C, or P.'
        using errcode = '22023';
    end if;
  end if;

  select reference into v_existing
  from public.bins
  where number = v_number;
  if v_existing is not null then
    raise exception '% already exists. Scan it instead of creating a new one.', v_existing
      using errcode = '23505';
  end if;

  insert into public.bins (
    number,
    type,
    reference,
    printed_count,
    last_printed_at,
    created_by_initials
  ) values (
    v_number,
    v_type,
    v_number::text || '-' || v_type,
    1,
    now(),
    v_initials
  )
  returning * into v_bin;

  insert into public.bin_events (bin_id, event_type, actor)
  values (v_bin.id, 'created', v_initials), (v_bin.id, 'printed', v_initials);

  if v_number >= v_next then
    update public.bin_counter
    set next_number = v_number + 1
    where id;
  end if;

  select code into v_location
  from public.locations
  where id = v_bin.current_location_id;

  return jsonb_build_object(
    'id', v_bin.id,
    'reference', v_bin.reference,
    'type', v_bin.type,
    'number', v_bin.number,
    'location_code', v_location,
    'location_id', v_bin.current_location_id
  );
end;
$$;

comment on function public.create_receiving_bin(text, text, text) is
  'Creates one bin from the next free code, or from a typed five-digit code, and counts one label print. The insert trigger places it at the current default for its suffix.';

create or replace function public.receive_into_bin(
  p_reference text,
  p_item_id uuid,
  p_qty integer,
  p_initials text,
  p_comment text,
  p_project text,
  p_origin text,
  p_incoming_tag text
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
  v_bin public.bins;
  v_on_hand integer;
  v_cycle_id uuid;
  v_opened boolean := false;
  v_default uuid;
  v_qty integer;
  v_cycle_project text;
  v_cycle_tag text;
  v_location text;
begin
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 then
    raise exception 'Enter a whole number of at least 1.'
      using errcode = '22023';
  end if;
  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'Comment must be 500 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_origin is not null and char_length(v_origin) > 500 then
    raise exception 'Origin must be 500 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_project is not null and char_length(v_project) > 120 then
    raise exception 'Project must be 120 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_tag is not null and char_length(v_tag) > 120 then
    raise exception 'Incoming tag must be 120 characters or fewer.'
      using errcode = '22023';
  end if;
  if p_item_id is null or not exists (select 1 from public.items where id = p_item_id) then
    raise exception 'Choose an item.'
      using errcode = '22023';
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

  select project, incoming_tag
  into v_cycle_project, v_cycle_tag
  from public.bin_cycles
  where id = v_cycle_id;

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
    to_location_id
  ) values (
    'receive_into_bin',
    v_bin.id,
    v_cycle_id,
    p_item_id,
    p_qty,
    v_initials,
    v_comment,
    v_cycle_project,
    v_cycle_tag,
    v_bin.current_location_id
  );

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
    'qty', v_qty
  );
end;
$$;

comment on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text) is
  'Receives a known SKU into an existing bin. The first receive into an empty bin opens a cycle and records the current put-away default. A later receive joins the open cycle and does not change its origin. Does not write items.quantity.';

create or replace function public.move_bin_to_location(
  p_reference text,
  p_location_code text,
  p_initials text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ref text := upper(btrim(coalesce(p_reference, '')));
  v_initials text := public.operator_initials(p_initials);
  v_bin public.bins;
  v_from uuid;
  v_to uuid;
  v_cycle uuid;
  v_from_code text;
  v_to_code text;
begin
  select * into v_bin
  from public.bins
  where reference = v_ref
  for update;

  if not found then
    raise exception 'No bin with that code. Use New bin.'
      using errcode = 'P0002';
  end if;

  v_to := public.resolve_location(p_location_code);
  v_from := v_bin.current_location_id;
  if v_from is not distinct from v_to then
    select code into v_to_code from public.locations where id = v_to;
    raise exception 'That bin is already at %.', v_to_code
      using errcode = '22023';
  end if;

  update public.bins
  set current_location_id = v_to
  where id = v_bin.id;

  select id into v_cycle
  from public.bin_cycles
  where bin_id = v_bin.id
    and status = 'open';

  insert into public.stock_events (
    event_type,
    bin_id,
    cycle_id,
    operator_initials,
    from_location_id,
    to_location_id
  ) values (
    'move_bin_location',
    v_bin.id,
    v_cycle,
    v_initials,
    v_from,
    v_to
  );

  select code into v_from_code from public.locations where id = v_from;
  select code into v_to_code from public.locations where id = v_to;

  return jsonb_build_object(
    'reference', v_bin.reference,
    'from_location_code', v_from_code,
    'to_location_code', v_to_code,
    'cycle_id', v_cycle
  );
end;
$$;

comment on function public.move_bin_to_location(text, text, text) is
  'Moves the bin to a location code that matches exactly one location type. Does not change the cycle''s recorded default or the location it opened at.';

create or replace function public.suggest_bins_for_sku(
  p_item_id uuid,
  p_project text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_project text := public.blank_to_null(p_project);
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'reference', b.reference,
    'qty', bc.qty,
    'location_code', l.code,
    'cycle_id', c.id
  ) order by b.reference), '[]'::jsonb)
  into v_rows
  from public.bin_contents bc
  join public.bin_cycles c on c.id = bc.cycle_id and c.status = 'open'
  join public.bins b on b.id = bc.bin_id
  left join public.locations l on l.id = b.current_location_id
  where bc.item_id = p_item_id
    and bc.qty > 0
    and c.project is not distinct from v_project;
  return v_rows;
end;
$$;

comment on function public.suggest_bins_for_sku(uuid, text) is
  'Open cycles on the same project that already hold this SKU. A blank project matches cycles with no project. Empty bins have no content rows, so they are not suggested.';

create or replace function public.fetch_bin_detail(p_reference text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ref text := upper(btrim(coalesce(p_reference, '')));
  v_bin public.bins;
  v_location text;
  v_contents jsonb;
  v_cycles jsonb;
  v_loose jsonb;
begin
  select * into v_bin from public.bins where reference = v_ref;
  if not found then
    return null;
  end if;

  select code into v_location from public.locations where id = v_bin.current_location_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', i.id,
    'sku', i.sku,
    'name', i.name,
    'qty', bc.qty
  ) order by i.sku), '[]'::jsonb)
  into v_contents
  from public.bin_contents bc
  join public.items i on i.id = bc.item_id
  join public.bin_cycles c on c.id = bc.cycle_id and c.status = 'open'
  where bc.bin_id = v_bin.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'status', c.status,
    'origin_description', c.origin_description,
    'project', c.project,
    'incoming_tag', c.incoming_tag,
    'opened_at', c.opened_at,
    'closed_at', c.closed_at,
    'opened_by_initials', c.opened_by_initials,
    'default_location_code', dloc.code,
    'opened_location_code', oloc.code,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'event_type', e.event_type,
        'occurred_at', e.occurred_at,
        'operator_initials', e.operator_initials,
        'comment', e.comment,
        'qty', e.qty,
        'sku', i.sku,
        'project', e.project,
        'incoming_tag', e.incoming_tag,
        'from_location_code', fl.code,
        'to_location_code', tl.code
      ) order by e.occurred_at)
      from public.stock_events e
      left join public.items i on i.id = e.item_id
      left join public.locations fl on fl.id = e.from_location_id
      left join public.locations tl on tl.id = e.to_location_id
      where e.cycle_id = c.id
    ), '[]'::jsonb)
  ) order by (c.status = 'open') desc, c.opened_at desc), '[]'::jsonb)
  into v_cycles
  from public.bin_cycles c
  left join public.locations dloc on dloc.id = c.default_location_id
  left join public.locations oloc on oloc.id = c.opened_location_id
  where c.bin_id = v_bin.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'event_type', e.event_type,
    'occurred_at', e.occurred_at,
    'operator_initials', e.operator_initials,
    'from_location_code', fl.code,
    'to_location_code', tl.code
  ) order by e.occurred_at), '[]'::jsonb)
  into v_loose
  from public.stock_events e
  left join public.locations fl on fl.id = e.from_location_id
  left join public.locations tl on tl.id = e.to_location_id
  where e.bin_id = v_bin.id
    and e.cycle_id is null;

  return jsonb_build_object(
    'id', v_bin.id,
    'reference', v_bin.reference,
    'type', v_bin.type,
    'number', v_bin.number,
    'notes', v_bin.notes,
    'printed_count', v_bin.printed_count,
    'created_at', v_bin.created_at,
    'last_printed_at', v_bin.last_printed_at,
    'created_by_initials', v_bin.created_by_initials,
    'location_code', v_location,
    'location_id', v_bin.current_location_id,
    'contents', coalesce(v_contents, '[]'::jsonb),
    'cycles', coalesce(v_cycles, '[]'::jsonb),
    'loose_events', coalesce(v_loose, '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_bin_default_locations(
  p_box uuid,
  p_crate uuid,
  p_pallet uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_box is null or p_crate is null or p_pallet is null then
    raise exception 'Choose a location that already exists.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.locations where id = p_box)
    or not exists (select 1 from public.locations where id = p_crate)
    or not exists (select 1 from public.locations where id = p_pallet)
  then
    raise exception 'Choose a location that already exists.'
      using errcode = '22023';
  end if;

  update public.bin_default_locations
  set location_id = p_box, updated_at = now()
  where bin_type = 'B';
  update public.bin_default_locations
  set location_id = p_crate, updated_at = now()
  where bin_type = 'C';
  update public.bin_default_locations
  set location_id = p_pallet, updated_at = now()
  where bin_type = 'P';
end;
$$;

comment on function public.set_bin_default_locations(uuid, uuid, uuid) is
  'Saves the three put-away defaults. Does not update bins or bin_cycles.';

create or replace function public.add_location_type(
  p_name text,
  p_prefix text,
  p_pattern text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_prefix text := upper(btrim(coalesce(p_prefix, '')));
  v_pattern text := btrim(coalesce(p_pattern, ''));
  v_slug text := lower(v_prefix);
  v_row public.location_types;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'Enter a name for the location type.'
      using errcode = '22023';
  end if;
  if v_prefix !~ '^[A-Z][A-Z0-9]{0,11}$' then
    raise exception 'A prefix is 1 to 12 letters or digits, stored in capitals.'
      using errcode = '22023';
  end if;
  if left(v_pattern, 1) <> '^' or right(v_pattern, 1) <> '$' or char_length(v_pattern) > 200 then
    raise exception 'The pattern must start with ^ and end with $.'
      using errcode = '22023';
  end if;
  if position(v_prefix in v_pattern) = 0 then
    raise exception 'The pattern must include the prefix %.', v_prefix
      using errcode = '22023';
  end if;
  if not public.location_pattern_ok(v_pattern) then
    raise exception 'That pattern is not a valid regular expression.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.location_types where prefix = v_prefix) then
    raise exception 'Prefix % is already used.', v_prefix
      using errcode = '23505';
  end if;
  if exists (select 1 from public.location_types where slug = v_slug) then
    raise exception 'Prefix % is already used.', v_prefix
      using errcode = '23505';
  end if;

  insert into public.location_types (slug, name, prefix, pattern)
  values (v_slug, v_name, v_prefix, v_pattern)
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'slug', v_row.slug,
    'name', v_row.name,
    'prefix', v_row.prefix,
    'pattern', v_row.pattern
  );
end;
$$;

create or replace function public.add_location(p_code text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text;
  v_type text;
begin
  v_id := public.resolve_location(p_code);
  select l.code, t.name into v_code, v_type
  from public.locations l
  join public.location_types t on t.id = l.location_type_id
  where l.id = v_id;
  return jsonb_build_object('id', v_id, 'code', v_code, 'type_name', v_type);
end;
$$;

alter table public.location_types enable row level security;
alter table public.locations enable row level security;
alter table public.bin_default_locations enable row level security;
alter table public.bin_cycles enable row level security;
alter table public.bin_contents enable row level security;
alter table public.stock_events enable row level security;

revoke all on table public.location_types from public, anon, authenticated;
revoke all on table public.locations from public, anon, authenticated;
revoke all on table public.bin_default_locations from public, anon, authenticated;
revoke all on table public.bin_cycles from public, anon, authenticated;
revoke all on table public.bin_contents from public, anon, authenticated;
revoke all on table public.stock_events from public, anon, authenticated;

grant all on table public.location_types to service_role;
grant all on table public.locations to service_role;
grant all on table public.bin_default_locations to service_role;
grant all on table public.bin_cycles to service_role;
grant all on table public.bin_contents to service_role;
grant all on table public.stock_events to service_role;

revoke all on function public.location_pattern_ok(text) from public, anon, authenticated;
revoke all on function public.locations_apply_type() from public, anon, authenticated;
revoke all on function public.bins_apply_default_location() from public, anon, authenticated;
revoke all on function public.bin_cycles_keep_origin() from public, anon, authenticated;
revoke all on function public.bin_contents_same_bin() from public, anon, authenticated;
revoke all on function public.reject_stock_event_change() from public, anon, authenticated;
revoke all on function public.finish_bin_cycle(uuid) from public, anon, authenticated;
revoke all on function public.adjust_bin_cycle_qty(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.operator_initials(text) from public, anon, authenticated;
revoke all on function public.blank_to_null(text) from public, anon, authenticated;
revoke all on function public.resolve_location(text) from public, anon, authenticated;
revoke all on function public.create_receiving_bin(text, text, text) from public, anon, authenticated;
revoke all on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.move_bin_to_location(text, text, text) from public, anon, authenticated;
revoke all on function public.suggest_bins_for_sku(uuid, text) from public, anon, authenticated;
revoke all on function public.fetch_bin_detail(text) from public, anon, authenticated;
revoke all on function public.set_bin_default_locations(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.add_location_type(text, text, text) from public, anon, authenticated;
revoke all on function public.add_location(text) from public, anon, authenticated;

grant execute on function public.location_pattern_ok(text) to service_role;
grant execute on function public.locations_apply_type() to service_role;
grant execute on function public.bins_apply_default_location() to service_role;
grant execute on function public.bin_cycles_keep_origin() to service_role;
grant execute on function public.bin_contents_same_bin() to service_role;
grant execute on function public.reject_stock_event_change() to service_role;
grant execute on function public.finish_bin_cycle(uuid) to service_role;
grant execute on function public.adjust_bin_cycle_qty(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.operator_initials(text) to service_role;
grant execute on function public.blank_to_null(text) to service_role;
grant execute on function public.resolve_location(text) to service_role;
grant execute on function public.create_receiving_bin(text, text, text) to service_role;
grant execute on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text) to service_role;
grant execute on function public.move_bin_to_location(text, text, text) to service_role;
grant execute on function public.suggest_bins_for_sku(uuid, text) to service_role;
grant execute on function public.fetch_bin_detail(text) to service_role;
grant execute on function public.set_bin_default_locations(uuid, uuid, uuid) to service_role;
grant execute on function public.add_location_type(text, text, text) to service_role;
grant execute on function public.add_location(text) to service_role;
