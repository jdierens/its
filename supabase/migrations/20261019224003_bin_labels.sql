-- Additive. Warehouse bins, one shared number counter, and a history table.
-- Existing physical labels are in the 1xxxx range, so the next number starts at 20000.
-- Users and locations do not exist yet. created_by and current_location_id are
-- nullable and have no foreign key. A parent bin can be added later.
-- The deployed app does not read these tables. RLS stays off, matching items.
-- Applied on fxsbpreasbdalwthyzvk as version 20261019224003.

create table public.bin_counter (
  id boolean primary key default true,
  next_number integer not null,
  constraint bin_counter_one_row check (id),
  constraint bin_counter_next_positive check (next_number > 0)
);

insert into public.bin_counter (id, next_number) values (true, 20000);

comment on table public.bin_counter is
  'One shared next bin number across pallet, crate, and box. Reserve, range, reprint, and settings lock this row with SELECT FOR UPDATE.';

create table public.bins (
  id uuid primary key default gen_random_uuid(),
  number integer not null,
  type text not null,
  reference text not null,
  notes text,
  printed_count integer not null default 0,
  last_printed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  current_location_id uuid,
  constraint bins_number_unique unique (number),
  constraint bins_reference_unique unique (reference),
  constraint bins_type_check check (type in ('P', 'C', 'B')),
  constraint bins_reference_format check (reference = (number::text || '-' || type)),
  constraint bins_number_positive check (number > 0),
  constraint bins_printed_count_nonnegative check (printed_count >= 0)
);

comment on table public.bins is
  'Warehouse bins. reference is number-type (20000-P). One shared counter. A parent bin can be added later.';

comment on column public.bins.created_by is
  'Who created the bin. Nullable uuid, no foreign key yet. Will reference users once Google sign-in exists. Until then this stays null; the print desk does not ask for a name.';

comment on column public.bins.current_location_id is
  'Where the bin is now. Nullable uuid, no foreign key yet. Will reference a locations table later.';

comment on column public.bins.notes is
  'Optional free-text notes. Not printed on the label.';

create index bins_created_at_idx on public.bins (created_at desc);

create table public.bin_events (
  id uuid primary key default gen_random_uuid(),
  bin_id uuid not null references public.bins (id),
  event_type text not null,
  actor text,
  from_location_id uuid,
  to_location_id uuid,
  created_at timestamptz not null default now(),
  constraint bin_events_type_check check (event_type in ('created', 'printed', 'reprinted', 'moved'))
);

comment on table public.bin_events is
  'History of a bin: created, printed, reprinted, or moved. Location columns have no foreign key yet, so a move can be logged once locations exist.';

comment on column public.bin_events.actor is
  'Who did this. Free text until Google sign-in exists, then a user id. Null when the print desk does not record a name.';

comment on column public.bin_events.from_location_id is
  'Previous location for a moved event. Nullable uuid, no foreign key yet.';

comment on column public.bin_events.to_location_id is
  'New location for a moved event. Nullable uuid, no foreign key yet.';

create index bin_events_bin_id_idx on public.bin_events (bin_id, created_at);

-- RLS stays off, matching items. These rows are warehouse labels, not tokens.
alter table public.bins disable row level security;
alter table public.bin_counter disable row level security;
alter table public.bin_events disable row level security;

grant all on table public.bins to anon, authenticated, service_role;
grant all on table public.bin_counter to anon, authenticated, service_role;
grant all on table public.bin_events to anon, authenticated, service_role;

insert into public.app_settings (key, value) values
  ('label_template_pallet', 'barcode'),
  ('label_template_crate', 'barcode'),
  ('label_template_box', 'barcode')
on conflict (key) do nothing;

comment on table public.app_settings is
  'App key/value settings. Not credentials. pricing_sales_window_days is the sales window. label_template is barcode or qr. label_template_pallet, label_template_crate, and label_template_box are barcode or qr.';

create or replace function public.reserve_bins(p_type text, p_count integer)
returns setof public.bins
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_type text := upper(btrim(coalesce(p_type, '')));
  v_start integer;
begin
  if v_type not in ('P', 'C', 'B') then
    raise exception 'Bin type must be Pallet, Crate, or Box'
      using errcode = '22023';
  end if;
  if p_count is null or p_count < 1 or p_count > 100 then
    raise exception 'Quantity must be a whole number from 1 to 100'
      using errcode = '22023';
  end if;

  select next_number into v_start
  from public.bin_counter
  where id
  for update;

  if v_start is null then
    raise exception 'Bin counter is missing'
      using errcode = '55000';
  end if;

  with inserted as (
    insert into public.bins (number, type, reference, printed_count, last_printed_at)
    select
      v_start + n.step,
      v_type,
      (v_start + n.step)::text || '-' || v_type,
      1,
      now()
    from generate_series(0, p_count - 1) as n(step)
    returning id
  ),
  created as (
    insert into public.bin_events (bin_id, event_type)
    select id, 'created' from inserted
    returning bin_id
  )
  insert into public.bin_events (bin_id, event_type)
  select bin_id, 'printed' from created;

  update public.bin_counter
  set next_number = v_start + p_count
  where id;

  return query
  select *
  from public.bins
  where number >= v_start
    and number < v_start + p_count
  order by number;
end;
$$;

comment on function public.reserve_bins(text, integer) is
  'Locks the shared counter, creates N bins of one type, prints them once, and advances the counter in the same transaction.';

create or replace function public.print_bin_range(p_type text, p_from integer, p_to integer)
returns setof public.bins
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_type text := upper(btrim(coalesce(p_type, '')));
  v_next integer;
  v_taken_number integer;
  v_taken_type text;
begin
  if v_type not in ('P', 'C', 'B') then
    raise exception 'Bin type must be Pallet, Crate, or Box'
      using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_from < 1 or p_to < p_from then
    raise exception 'Enter a from and to, with from at least 1 and to at least from'
      using errcode = '22023';
  end if;
  if (p_to - p_from + 1) > 100 then
    raise exception 'A sequence can print at most 100 labels'
      using errcode = '22023';
  end if;

  select next_number into v_next
  from public.bin_counter
  where id
  for update;

  if v_next is null then
    raise exception 'Bin counter is missing'
      using errcode = '55000';
  end if;

  select number, type
  into v_taken_number, v_taken_type
  from public.bins
  where number between p_from and p_to
    and type <> v_type
  order by number
  limit 1;

  if v_taken_number is not null then
    raise exception '% is already a % label',
      v_taken_number::text || '-' || v_taken_type,
      case v_taken_type when 'P' then 'pallet' when 'C' then 'crate' else 'box' end
      using errcode = '23514';
  end if;

  with inserted as (
    insert into public.bins (number, type, reference)
    select gs.number, v_type, gs.number::text || '-' || v_type
    from generate_series(p_from, p_to) as gs(number)
    where not exists (
      select 1 from public.bins existing where existing.number = gs.number
    )
    returning id
  )
  insert into public.bin_events (bin_id, event_type)
  select id, 'created' from inserted;

  update public.bins
  set printed_count = printed_count + 1,
      last_printed_at = now()
  where number between p_from and p_to
    and type = v_type;

  insert into public.bin_events (bin_id, event_type)
  select id, 'printed'
  from public.bins
  where number between p_from and p_to
    and type = v_type;

  if p_to >= v_next then
    update public.bin_counter
    set next_number = p_to + 1
    where id;
  end if;

  return query
  select *
  from public.bins
  where number between p_from and p_to
    and type = v_type
  order by number;
end;
$$;

comment on function public.print_bin_range(text, integer, integer) is
  'Prints one label for each number in a range. Creates missing bins. Moves the shared counter to to+1 when the range reaches it, and never moves the counter backward.';

create or replace function public.reprint_bin(p_reference text, p_copies integer)
returns setof public.bins
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ref text := upper(btrim(coalesce(p_reference, '')));
  v_number integer;
  v_type text;
  v_next integer;
  v_bin public.bins;
begin
  if p_copies is null or p_copies < 1 or p_copies > 50 then
    raise exception 'Copies must be a whole number from 1 to 50'
      using errcode = '22023';
  end if;
  if v_ref !~ '^[0-9]+-[PCB]$' then
    raise exception 'Enter a bin reference like 20000-P'
      using errcode = '22023';
  end if;

  v_number := split_part(v_ref, '-', 1)::integer;
  v_type := split_part(v_ref, '-', 2);
  if v_number < 1 or v_number::text <> split_part(v_ref, '-', 1) then
    raise exception 'Enter a bin reference like 20000-P'
      using errcode = '22023';
  end if;

  select next_number into v_next
  from public.bin_counter
  where id
  for update;

  if v_next is null then
    raise exception 'Bin counter is missing'
      using errcode = '55000';
  end if;

  select * into v_bin
  from public.bins
  where number = v_number;

  if found then
    if v_bin.type <> v_type then
      raise exception '% is already a % label',
        v_bin.reference,
        case v_bin.type when 'P' then 'pallet' when 'C' then 'crate' else 'box' end
        using errcode = '23514';
    end if;

    update public.bins
    set printed_count = printed_count + p_copies,
        last_printed_at = now()
    where id = v_bin.id
    returning * into v_bin;

    insert into public.bin_events (bin_id, event_type)
    values (v_bin.id, 'reprinted');

    return next v_bin;
    return;
  end if;

  if v_number >= v_next then
    raise exception 'That reference is not printed yet. Use Print next or a sequence so the counter stays unique.'
      using errcode = '22023';
  end if;

  insert into public.bins (number, type, reference, printed_count, last_printed_at)
  values (v_number, v_type, v_number::text || '-' || v_type, p_copies, now())
  returning * into v_bin;

  insert into public.bin_events (bin_id, event_type)
  values (v_bin.id, 'created'), (v_bin.id, 'reprinted');

  return next v_bin;
end;
$$;

comment on function public.reprint_bin(text, integer) is
  'Prints more copies of a bin. Does not move the counter. A legacy reference below the counter is stored on first reprint. A reference at or above the counter must be reserved first.';

create or replace function public.set_bin_next_number(p_next integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_highest integer;
begin
  if p_next is null or p_next < 1 then
    raise exception 'Next bin number must be a whole number of at least 1'
      using errcode = '22023';
  end if;

  perform 1
  from public.bin_counter
  where id
  for update;

  select max(number) into v_highest
  from public.bins;

  if p_next <= coalesce(v_highest, 0) then
    raise exception 'Next number must be higher than the highest issued number (%)', v_highest
      using errcode = '22023';
  end if;

  update public.bin_counter
  set next_number = p_next
  where id;

  return p_next;
end;
$$;

comment on function public.set_bin_next_number(integer) is
  'Sets the shared next bin number. Refuses a value at or below the highest issued number so a label cannot be duplicated.';

revoke all on function public.reserve_bins(text, integer) from public;
revoke all on function public.print_bin_range(text, integer, integer) from public;
revoke all on function public.reprint_bin(text, integer) from public;
revoke all on function public.set_bin_next_number(integer) from public;

grant execute on function public.reserve_bins(text, integer) to anon, authenticated, service_role;
grant execute on function public.print_bin_range(text, integer, integer) to anon, authenticated, service_role;
grant execute on function public.reprint_bin(text, integer) to anon, authenticated, service_role;
grant execute on function public.set_bin_next_number(integer) to anon, authenticated, service_role;
