-- Move inventory: nest bins, move a bin, and move a quantity.
-- A bin sits in one parent bin or at a location. current_location_id stays the
-- effective location (the root ancestor's location) so existing screens keep working.
-- Not applied here. Review and apply by hand. Do not run this against production
-- until it has been reviewed.

alter table public.bins
  add column parent_bin_id uuid references public.bins (id);

alter table public.bins
  add constraint bins_parent_not_self check (parent_bin_id <> id);

comment on column public.bins.parent_bin_id is
  'The bin this one sits in. Null when it sits at a location. Never both a parent and its own location: current_location_id is the effective location, copied from the root ancestor in the same transaction.';

comment on column public.bins.current_location_id is
  'Effective location. A bin at a place stores that location here. A nested bin stores its root ancestor''s location here, updated when any ancestor moves.';

create index bins_parent_bin_id_idx on public.bins (parent_bin_id);

alter table public.bin_events
  add column from_parent_bin_id uuid references public.bins (id),
  add column to_parent_bin_id uuid references public.bins (id);

comment on column public.bin_events.from_parent_bin_id is
  'Parent bin before a moved event. Null when the bin was at a location.';

comment on column public.bin_events.to_parent_bin_id is
  'Parent bin after a moved event. Null when the bin was put at a location. Descendants are not given their own row.';

create index bin_events_moved_idx
  on public.bin_events (created_at desc)
  where event_type = 'moved';

create table public.move_requests (
  client_request_id text primary key,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint move_requests_id_len check (char_length(client_request_id) between 8 and 80)
);

comment on table public.move_requests is
  'One stored result per client request id. A repeat of that id returns this result and does not move anything again.';

alter table public.move_requests enable row level security;
revoke all on table public.move_requests from public, anon, authenticated;
grant select, insert on table public.move_requests to service_role;

alter table public.inventory_movements
  drop constraint inventory_movements_ref_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_ref_type_check check (
    ref_type in (
      'project', 'purchase_receipt', 'putaway', 'status_change', 'sales_order', 'rma',
      'vendor_return', 'adjustment', 'cycle_count', 'opening_balance', 'scrap', 'internal_use',
      'bin_transfer'
    )
  );

create index inventory_movements_transfer_idx
  on public.inventory_movements (transfer_id)
  where transfer_id is not null;

create or replace function public.bin_kind(p_type text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_type
    when 'B' then 'box'
    when 'C' then 'crate'
    when 'P' then 'pallet'
    else 'bin'
  end;
$$;

create or replace function public.bin_type_rank(p_type text)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_type
    when 'B' then 1
    when 'C' then 2
    when 'P' then 3
    else 0
  end;
$$;

create or replace function public.bin_display_label(p_type text, p_reference text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select initcap(public.bin_kind(p_type)) || ' ' || p_reference;
$$;

create or replace function public.bin_holder(p_bin uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when parent.id is not null then public.bin_display_label(parent.type, parent.reference)
    when loc.code is not null then loc.code
    else 'no place'
  end
  from public.bins bin
  left join public.bins parent on parent.id = bin.parent_bin_id
  left join public.locations loc on loc.id = bin.current_location_id
  where bin.id = p_bin;
$$;

create or replace function public.bin_path(p_bin uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive up as (
    select bin.id, bin.parent_bin_id, bin.reference, bin.type, bin.current_location_id, 1 as depth
    from public.bins bin
    where bin.id = p_bin
    union all
    select parent.id, parent.parent_bin_id, parent.reference, parent.type, parent.current_location_id, up.depth + 1
    from public.bins parent
    join up on up.parent_bin_id = parent.id
    where up.depth < 50
  )
  select concat_ws(
    ' > ',
    (
      select loc.code
      from public.locations loc
      where loc.id = (select up.current_location_id from up order by up.depth desc limit 1)
    ),
    (select string_agg(public.bin_display_label(up.type, up.reference), ' > ' order by up.depth desc) from up)
  );
$$;

create or replace function public.bin_holding_counts(p_bin uuid, out boxes integer, out items integer)
returns record
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive tree as (
    select bin.id, bin.type, 1 as depth
    from public.bins bin
    where bin.id = p_bin
    union all
    select child.id, child.type, tree.depth + 1
    from public.bins child
    join tree on child.parent_bin_id = tree.id
    where tree.depth < 50
  )
  select
    (select count(*)::integer from tree where tree.type = 'B' and tree.id <> p_bin),
    (
      select coalesce(sum(contents.qty), 0)::integer
      from public.bin_contents contents
      where contents.bin_id in (select tree.id from tree)
    );
$$;

create or replace function public.bin_nest_problem(p_child uuid, p_parent uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_child_type text;
  v_parent_type text;
  v_hit uuid;
begin
  if p_child is null or p_parent is null then
    return 'Choose a bin or a location.';
  end if;
  if p_child = p_parent then
    return 'A bin cannot go into itself.';
  end if;

  select type into v_child_type from public.bins where id = p_child;
  select type into v_parent_type from public.bins where id = p_parent;
  if v_child_type is null or v_parent_type is null then
    return 'No bin with that code. Use New bin.';
  end if;

  if public.bin_type_rank(v_child_type) > public.bin_type_rank(v_parent_type) then
    return format(
      'A %s cannot go into a %s.',
      public.bin_kind(v_child_type),
      public.bin_kind(v_parent_type)
    );
  end if;

  with recursive walk as (
    select id, parent_bin_id, 1 as depth
    from public.bins
    where id = p_parent
    union all
    select bin.id, bin.parent_bin_id, walk.depth + 1
    from public.bins bin
    join walk on walk.parent_bin_id = bin.id
    where walk.depth < 50
  )
  select id into v_hit from walk where id = p_child limit 1;

  if v_hit is not null then
    return 'That bin is inside the one you are moving.';
  end if;
  return null;
end;
$$;

create or replace function public.location_target_problem(p_code text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_count integer;
begin
  if v_code = '' then
    return 'Enter a location code.';
  end if;
  if exists (select 1 from public.locations where code = v_code) then
    return null;
  end if;
  select count(*) into v_count
  from public.location_types
  where left(v_code, char_length(prefix)) = prefix
    and v_code ~ pattern;
  if v_count = 0 then
    return format('No location type matches %s.', v_code);
  end if;
  if v_count > 1 then
    return format('More than one location type matches %s.', v_code);
  end if;
  return null;
end;
$$;

create or replace function public.bin_move_problem(
  p_bin uuid,
  p_target_bin uuid,
  p_location uuid,
  p_location_code text
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_parent uuid;
  v_location uuid;
  v_code text;
  v_label text;
  v_has_bin boolean := p_target_bin is not null;
  v_has_location boolean := p_location is not null or nullif(btrim(coalesce(p_location_code, '')), '') is not null;
begin
  if v_has_bin and v_has_location then
    return 'Choose a bin or a location, not both.';
  end if;
  if not v_has_bin and not v_has_location then
    return 'Choose a bin or a location.';
  end if;

  select parent_bin_id, current_location_id
  into v_parent, v_location
  from public.bins
  where id = p_bin;
  if not found then
    return 'No bin with that code. Use New bin.';
  end if;

  if v_has_bin then
    if v_parent is not distinct from p_target_bin then
      select public.bin_display_label(type, reference) into v_label
      from public.bins
      where id = p_target_bin;
      return format('That bin is already in %s.', coalesce(v_label, 'that bin'));
    end if;
    return public.bin_nest_problem(p_bin, p_target_bin);
  end if;

  if p_location is null then
    return public.location_target_problem(p_location_code);
  end if;
  if v_parent is null and v_location is not distinct from p_location then
    select code into v_code from public.locations where id = p_location;
    return format('That bin is already at %s.', coalesce(v_code, 'that location'));
  end if;
  return null;
end;
$$;

create or replace function public.describe_bin_move(p_bin uuid, p_to_label text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_type text;
  v_reference text;
  v_boxes integer;
  v_items integer;
begin
  select type, reference into v_type, v_reference from public.bins where id = p_bin;
  select counts.boxes, counts.items into v_boxes, v_items from public.bin_holding_counts(p_bin) as counts;
  return format(
    'Move %s (%s boxes, %s items) from %s to %s',
    public.bin_display_label(v_type, v_reference),
    coalesce(v_boxes, 0),
    coalesce(v_items, 0),
    coalesce(public.bin_holder(p_bin), 'no place'),
    p_to_label
  );
end;
$$;

create or replace function public.item_move_problem(
  p_from uuid,
  p_to uuid,
  p_item uuid,
  p_qty integer
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_have integer;
begin
  if p_from is null or p_to is null then
    return 'No bin with that code. Use New bin.';
  end if;
  if p_from = p_to then
    return 'Choose a different bin.';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 1000000 then
    return 'Enter a whole number of at least 1.';
  end if;
  if p_item is null or not exists (select 1 from public.items where id = p_item) then
    return 'Choose an item.';
  end if;
  select contents.qty into v_have
  from public.bin_contents contents
  join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
  where contents.bin_id = p_from
    and contents.item_id = p_item;
  if v_have is null then
    return 'That bin does not hold this item.';
  end if;
  if p_qty > v_have then
    return format('Only %s are in that bin.', v_have);
  end if;
  return null;
end;
$$;

create or replace function public.bins_place_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  if new.parent_bin_id is not null
    and (tg_op = 'INSERT' or new.parent_bin_id is distinct from old.parent_bin_id)
  then
    v_problem := public.bin_nest_problem(new.id, new.parent_bin_id);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger bins_place_check
before insert or update of parent_bin_id on public.bins
for each row execute function public.bins_place_check();

create or replace function public.bins_place_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location uuid;
begin
  if tg_op = 'UPDATE'
    and new.parent_bin_id is not distinct from old.parent_bin_id
    and new.current_location_id is not distinct from old.current_location_id
  then
    return null;
  end if;

  if new.parent_bin_id is null then
    v_location := new.current_location_id;
  else
    select current_location_id into v_location
    from public.bins
    where id = new.parent_bin_id;
  end if;

  if new.current_location_id is distinct from v_location then
    update public.bins
    set current_location_id = v_location
    where id = new.id;
  end if;

  with recursive tree as (
    select id, 1 as depth
    from public.bins
    where parent_bin_id = new.id
    union all
    select child.id, tree.depth + 1
    from public.bins child
    join tree on child.parent_bin_id = tree.id
    where tree.depth < 50
  )
  update public.bins bin
  set current_location_id = v_location
  from tree
  where bin.id = tree.id
    and bin.current_location_id is distinct from v_location;

  return null;
end;
$$;

create trigger bins_place_sync
after insert or update of parent_bin_id, current_location_id on public.bins
for each row execute function public.bins_place_sync();

create or replace function public.ensure_open_bin_cycle(p_bin uuid, p_initials text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cycle uuid;
  v_on_hand integer;
  v_location uuid;
  v_type text;
  v_default uuid;
begin
  select coalesce(sum(qty), 0) into v_on_hand
  from public.bin_contents
  where bin_id = p_bin;

  if v_on_hand > 0 then
    select id into v_cycle
    from public.bin_cycles
    where bin_id = p_bin
      and status = 'open';
    if v_cycle is null then
      raise exception 'This bin has quantity and no open cycle.'
        using errcode = '55000';
    end if;
    return v_cycle;
  end if;

  update public.bin_cycles
  set status = 'closed',
      closed_at = coalesce(closed_at, now())
  where bin_id = p_bin
    and status = 'open';

  select type, current_location_id into v_type, v_location
  from public.bins
  where id = p_bin;

  select location_id into v_default
  from public.bin_default_locations
  where bin_type = v_type;

  insert into public.bin_cycles (
    bin_id,
    status,
    default_location_id,
    opened_location_id,
    opened_by_initials
  ) values (
    p_bin,
    'open',
    v_default,
    v_location,
    p_initials
  )
  returning id into v_cycle;
  return v_cycle;
end;
$$;

create or replace function public.begin_move_request(p_request text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request text := public.blank_to_null(p_request);
  v_result jsonb;
begin
  if v_request is null then
    raise exception 'Request id is required.'
      using errcode = '22023';
  end if;
  if char_length(v_request) > 80 or char_length(v_request) < 8 then
    raise exception 'Request id must be 80 characters or fewer.'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_request, 0));
  select result into v_result
  from public.move_requests
  where client_request_id = v_request;
  return v_result;
end;
$$;

create or replace function public.finish_move_request(p_request text, p_result jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request text := public.blank_to_null(p_request);
begin
  if v_request is null then
    return;
  end if;
  insert into public.move_requests (client_request_id, result)
  values (v_request, p_result);
end;
$$;

create or replace function public.perform_bin_move(
  p_bin uuid,
  p_target_bin uuid,
  p_location uuid,
  p_initials text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bin public.bins;
  v_from_parent uuid;
  v_from_location uuid;
  v_to_location uuid;
  v_to_label text;
  v_from_label text;
  v_bin_label text;
  v_boxes integer;
  v_items integer;
  v_from_parent_ref text;
  v_cycle uuid;
  v_summary text;
  v_event uuid;
  v_reverse jsonb;
begin
  select * into v_bin from public.bins where id = p_bin;
  v_from_parent := v_bin.parent_bin_id;
  v_from_location := v_bin.current_location_id;
  v_from_label := public.bin_holder(p_bin);
  v_bin_label := public.bin_display_label(v_bin.type, v_bin.reference);
  select counts.boxes, counts.items into v_boxes, v_items
  from public.bin_holding_counts(p_bin) as counts;

  if p_target_bin is not null then
    select public.bin_display_label(type, reference) into v_to_label
    from public.bins
    where id = p_target_bin;
    update public.bins
    set parent_bin_id = p_target_bin
    where id = p_bin;
    v_reverse := jsonb_build_object(
      'op', 'bin',
      'bin_ref', v_bin.reference,
      'target_bin_ref', (
        select reference from public.bins where id = v_from_parent
      ),
      'target_location_code', case
        when v_from_parent is null then (select code from public.locations where id = v_from_location)
        else null
      end
    );
  else
    select code into v_to_label from public.locations where id = p_location;
    update public.bins
    set parent_bin_id = null,
        current_location_id = p_location
    where id = p_bin;
    v_reverse := jsonb_build_object(
      'op', 'bin',
      'bin_ref', v_bin.reference,
      'target_bin_ref', (select reference from public.bins where id = v_from_parent),
      'target_location_code', case
        when v_from_parent is null then (select code from public.locations where id = v_from_location)
        else null
      end
    );
  end if;

  select current_location_id into v_to_location from public.bins where id = p_bin;
  v_summary := format(
    'Move %s (%s boxes, %s items) from %s to %s',
    v_bin_label,
    coalesce(v_boxes, 0),
    coalesce(v_items, 0),
    coalesce(v_from_label, 'no place'),
    coalesce(v_to_label, 'no place')
  );

  insert into public.bin_events (
    bin_id,
    event_type,
    actor,
    from_location_id,
    to_location_id,
    from_parent_bin_id,
    to_parent_bin_id
  ) values (
    p_bin,
    'moved',
    p_initials,
    v_from_location,
    v_to_location,
    v_from_parent,
    case when p_target_bin is not null then p_target_bin else null end
  )
  returning id into v_event;

  select id into v_cycle
  from public.bin_cycles
  where bin_id = p_bin
    and status = 'open';

  if v_to_location is not null and v_from_location is distinct from v_to_location then
    insert into public.stock_events (
      event_type,
      bin_id,
      cycle_id,
      operator_initials,
      from_location_id,
      to_location_id
    ) values (
      'move_bin_location',
      p_bin,
      v_cycle,
      p_initials,
      v_from_location,
      v_to_location
    );
  end if;

  select reference into v_from_parent_ref from public.bins where id = v_from_parent;

  return jsonb_build_object(
    'reference', v_bin.reference,
    'from_location_code', (select code from public.locations where id = v_from_location),
    'to_location_code', (select code from public.locations where id = v_to_location),
    'cycle_id', v_cycle,
    'summary', v_summary,
    'event_id', v_event,
    'from_parent_ref', v_from_parent_ref,
    'reverse_op', v_reverse
  );
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

create or replace function public.lock_bins(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
  from public.bins
  where id = any (p_ids)
  order by id
  for update;
end;
$$;

create or replace function public.resolve_bin_ref(p_reference text)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ref text := upper(btrim(coalesce(p_reference, '')));
  v_id uuid;
begin
  if v_ref = '' then
    raise exception 'No bin with that code. Use New bin.'
      using errcode = 'P0002';
  end if;
  select id into v_id from public.bins where reference = v_ref;
  if v_id is null then
    raise exception 'No bin with that code. Use New bin.'
      using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

create or replace function public.move_bin(
  p_bin_ref text,
  p_target_bin_ref text,
  p_target_location_code text,
  p_initials text,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_request text := public.blank_to_null(p_client_request_id);
  v_target_ref text := public.blank_to_null(p_target_bin_ref);
  v_location_code text := public.blank_to_null(p_target_location_code);
  v_prior jsonb;
  v_bin uuid;
  v_target uuid;
  v_location uuid;
  v_problem text;
  v_done jsonb;
  v_result jsonb;
begin
  if v_request is not null then
    v_prior := public.begin_move_request(v_request);
    if v_prior is not null then
      return v_prior;
    end if;
  end if;

  v_bin := public.resolve_bin_ref(p_bin_ref);
  if v_target_ref is not null then
    v_target := public.resolve_bin_ref(v_target_ref);
  end if;
  if v_location_code is not null and v_target is null then
    v_problem := public.location_target_problem(v_location_code);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
    v_location := public.resolve_location(v_location_code);
  end if;

  perform public.lock_bins(array_remove(array[v_bin, v_target], null));
  v_problem := public.bin_move_problem(v_bin, v_target, v_location, v_location_code);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;

  v_done := public.perform_bin_move(v_bin, v_target, v_location, v_initials);
  v_result := v_done || jsonb_build_object(
    'reverse', jsonb_build_array(v_done -> 'reverse_op'),
    'initials', v_initials
  );
  if v_done -> 'reverse_op' ->> 'target_bin_ref' is null
    and v_done -> 'reverse_op' ->> 'target_location_code' is null
  then
    v_result := v_result || jsonb_build_object('reverse', '[]'::jsonb);
  end if;
  perform public.finish_move_request(v_request, v_result);
  return v_result;
end;
$$;

create or replace function public.unnest(
  p_bin_ref text,
  p_target_location_code text,
  p_initials text,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.blank_to_null(p_client_request_id) is null then
    raise exception 'Request id is required.'
      using errcode = '22023';
  end if;
  if public.blank_to_null(p_target_location_code) is null then
    raise exception 'Enter a location code.'
      using errcode = '22023';
  end if;
  return public.move_bin(p_bin_ref, null, p_target_location_code, p_initials, p_client_request_id);
end;
$$;

create or replace function public.move_bins(
  p_bin_refs text[],
  p_target_bin_ref text,
  p_target_location_code text,
  p_initials text,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_prior jsonb;
  v_ref text;
  v_refs text[] := '{}';
  v_bin uuid;
  v_target uuid;
  v_location uuid;
  v_target_ref text := public.blank_to_null(p_target_bin_ref);
  v_location_code text := public.blank_to_null(p_target_location_code);
  v_problem text;
  v_done jsonb;
  v_reverse jsonb := '[]'::jsonb;
  v_summaries text[] := '{}';
  v_result jsonb;
  v_to_label text;
begin
  v_prior := public.begin_move_request(p_client_request_id);
  if v_prior is not null then
    return v_prior;
  end if;
  if p_bin_refs is null or cardinality(p_bin_refs) < 1 then
    raise exception 'Choose a bin to move.'
      using errcode = '22023';
  end if;
  if cardinality(p_bin_refs) > 50 then
    raise exception 'Move at most 50 bins at once.'
      using errcode = '22023';
  end if;

  foreach v_ref in array p_bin_refs loop
    if public.blank_to_null(v_ref) is not null
      and not (upper(btrim(v_ref)) = any (v_refs))
    then
      v_refs := v_refs || upper(btrim(v_ref));
    end if;
  end loop;
  if cardinality(v_refs) < 1 then
    raise exception 'Choose a bin to move.'
      using errcode = '22023';
  end if;

  if v_target_ref is not null then
    v_target := public.resolve_bin_ref(v_target_ref);
    select public.bin_display_label(type, reference) into v_to_label
    from public.bins where id = v_target;
  elsif v_location_code is not null then
    v_problem := public.location_target_problem(v_location_code);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
    v_location := public.resolve_location(v_location_code);
    v_to_label := (select code from public.locations where id = v_location);
  else
    raise exception 'Choose a bin or a location.'
      using errcode = '22023';
  end if;

  foreach v_ref in array v_refs loop
    v_bin := public.resolve_bin_ref(v_ref);
    perform public.lock_bins(array_remove(array[v_bin, v_target], null));
    v_problem := public.bin_move_problem(v_bin, v_target, v_location, null);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
    v_done := public.perform_bin_move(v_bin, v_target, v_location, v_initials);
    v_reverse := v_reverse || jsonb_build_array(v_done -> 'reverse_op');
    v_summaries := v_summaries || coalesce(v_done ->> 'summary', '');
  end loop;

  v_result := jsonb_build_object(
    'summary', array_to_string(v_summaries, ' '),
    'reverse', v_reverse,
    'initials', v_initials,
    'to_label', v_to_label
  );
  perform public.finish_move_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

create or replace function public.move_item_qty(
  p_from_bin_ref text,
  p_to_bin_ref text,
  p_item_id uuid,
  p_qty integer,
  p_initials text,
  p_comment text,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_comment text := public.blank_to_null(p_comment);
  v_prior jsonb;
  v_from uuid;
  v_to uuid;
  v_problem text;
  v_done jsonb;
  v_result jsonb;
begin
  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'Comment must be 500 characters or fewer.'
      using errcode = '22023';
  end if;
  v_prior := public.begin_move_request(p_client_request_id);
  if v_prior is not null then
    return v_prior;
  end if;

  v_from := public.resolve_bin_ref(p_from_bin_ref);
  v_to := public.resolve_bin_ref(p_to_bin_ref);
  perform public.lock_bins(array[v_from, v_to]);
  v_problem := public.item_move_problem(v_from, v_to, p_item_id, p_qty);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;

  v_done := public.perform_item_move(v_from, v_to, p_item_id, p_qty, v_initials, v_comment);
  v_result := v_done || jsonb_build_object(
    'reverse', jsonb_build_array(v_done -> 'reverse_op'),
    'initials', v_initials
  );
  perform public.finish_move_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

create or replace function public.empty_bin_into(
  p_from_bin text,
  p_to_bin text,
  p_initials text,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_prior jsonb;
  v_from uuid;
  v_to uuid;
  v_child uuid;
  v_item uuid;
  v_qty integer;
  v_problem text;
  v_done jsonb;
  v_reverse jsonb := '[]'::jsonb;
  v_from_label text;
  v_to_label text;
  v_boxes integer;
  v_items integer;
  v_result jsonb;
  v_moved boolean := false;
begin
  v_prior := public.begin_move_request(p_client_request_id);
  if v_prior is not null then
    return v_prior;
  end if;

  v_from := public.resolve_bin_ref(p_from_bin);
  v_to := public.resolve_bin_ref(p_to_bin);
  if v_from = v_to then
    raise exception 'Choose a different bin.'
      using errcode = '22023';
  end if;
  perform public.lock_bins(array[v_from, v_to]);
  select public.bin_display_label(type, reference) into v_from_label from public.bins where id = v_from;
  select public.bin_display_label(type, reference) into v_to_label from public.bins where id = v_to;
  select counts.boxes, counts.items into v_boxes, v_items from public.bin_holding_counts(v_from) as counts;

  for v_child in
    select id from public.bins
    where parent_bin_id = v_from
      and id <> v_to
    order by reference
  loop
    perform public.lock_bins(array[v_child]);
    v_problem := public.bin_move_problem(v_child, v_to, null, null);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
  end loop;

  for v_child in
    select id from public.bins
    where parent_bin_id = v_from
      and id <> v_to
    order by reference
  loop
    v_done := public.perform_bin_move(v_child, v_to, null, v_initials);
    v_reverse := v_reverse || jsonb_build_array(v_done -> 'reverse_op');
    v_moved := true;
  end loop;

  for v_item, v_qty in
    select contents.item_id, contents.qty
    from public.bin_contents contents
    join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
    where contents.bin_id = v_from
    order by contents.item_id
  loop
    v_problem := public.item_move_problem(v_from, v_to, v_item, v_qty);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
    v_done := public.perform_item_move(v_from, v_to, v_item, v_qty, v_initials, 'empty bin');
    v_reverse := v_reverse || jsonb_build_array(v_done -> 'reverse_op');
    v_moved := true;
  end loop;

  if not v_moved then
    raise exception 'That bin is already empty.'
      using errcode = '22023';
  end if;

  v_result := jsonb_build_object(
    'summary', format(
      'Empty %s (%s boxes, %s items) into %s',
      v_from_label,
      coalesce(v_boxes, 0),
      coalesce(v_items, 0),
      v_to_label
    ),
    'reverse', v_reverse,
    'initials', v_initials
  );
  perform public.finish_move_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

create or replace function public.undo_move(
  p_original_request_id text,
  p_initials text,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_prior jsonb;
  v_original jsonb;
  v_op jsonb;
  v_done jsonb;
  v_reverse jsonb := '[]'::jsonb;
  v_bin uuid;
  v_target uuid;
  v_location uuid;
  v_from uuid;
  v_to uuid;
  v_problem text;
  v_result jsonb;
  v_summaries text[] := '{}';
begin
  v_prior := public.begin_move_request(p_client_request_id);
  if v_prior is not null then
    return v_prior;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(public.blank_to_null(p_original_request_id), 0));
  select result into v_original
  from public.move_requests
  where client_request_id = public.blank_to_null(p_original_request_id);
  if v_original is null or jsonb_typeof(v_original -> 'reverse') <> 'array' then
    raise exception 'That move was not found.'
      using errcode = 'P0002';
  end if;
  if jsonb_array_length(v_original -> 'reverse') = 0 then
    raise exception 'That move has nowhere to go back to.'
      using errcode = '22023';
  end if;

  for v_op in
    select value
    from jsonb_array_elements(v_original -> 'reverse') with ordinality as listed(value, ordinal)
    order by listed.ordinal desc
  loop
    if v_op ->> 'op' = 'bin' then
      v_bin := public.resolve_bin_ref(v_op ->> 'bin_ref');
      v_target := null;
      v_location := null;
      if public.blank_to_null(v_op ->> 'target_bin_ref') is not null then
        v_target := public.resolve_bin_ref(v_op ->> 'target_bin_ref');
      elsif public.blank_to_null(v_op ->> 'target_location_code') is not null then
        v_location := public.resolve_location(v_op ->> 'target_location_code');
      else
        raise exception 'That move has nowhere to go back to.'
          using errcode = '22023';
      end if;
      perform public.lock_bins(array_remove(array[v_bin, v_target], null));
      v_problem := public.bin_move_problem(v_bin, v_target, v_location, null);
      if v_problem is not null then
        raise exception '%', v_problem using errcode = '22023';
      end if;
      v_done := public.perform_bin_move(v_bin, v_target, v_location, v_initials);
    elsif v_op ->> 'op' = 'item' then
      v_from := public.resolve_bin_ref(v_op ->> 'from_bin_ref');
      v_to := public.resolve_bin_ref(v_op ->> 'to_bin_ref');
      perform public.lock_bins(array[v_from, v_to]);
      v_problem := public.item_move_problem(
        v_from,
        v_to,
        (v_op ->> 'item_id')::uuid,
        (v_op ->> 'qty')::integer
      );
      if v_problem is not null then
        raise exception '%', v_problem using errcode = '22023';
      end if;
      v_done := public.perform_item_move(
        v_from,
        v_to,
        (v_op ->> 'item_id')::uuid,
        (v_op ->> 'qty')::integer,
        v_initials,
        coalesce(v_op ->> 'comment', 'undo')
      );
    else
      raise exception 'That move was not found.'
        using errcode = 'P0002';
    end if;
    v_reverse := v_reverse || jsonb_build_array(v_done -> 'reverse_op');
    v_summaries := v_summaries || coalesce(v_done ->> 'summary', '');
  end loop;

  v_result := jsonb_build_object(
    'summary', array_to_string(v_summaries, ' '),
    'reverse', v_reverse,
    'initials', v_initials,
    'undone_request_id', public.blank_to_null(p_original_request_id)
  );
  perform public.finish_move_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

create or replace function public.move_bin_to_location(
  p_reference text,
  p_location_code text,
  p_initials text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.move_bin(p_reference, null, p_location_code, p_initials, null);
end;
$$;

create or replace function public.preview_move(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := coalesce(p_payload ->> 'kind', '');
  v_target_ref text := public.blank_to_null(p_payload ->> 'target_bin');
  v_location_code text := public.blank_to_null(p_payload ->> 'target_location');
  v_target uuid;
  v_location uuid;
  v_bin uuid;
  v_from uuid;
  v_problem text;
  v_ref text;
  v_lines text[] := '{}';
  v_to_label text;
  v_from_label text;
  v_boxes integer;
  v_items integer;
  v_item uuid;
  v_qty integer;
  v_line text;
begin
  if v_target_ref is not null then
    select id, public.bin_display_label(type, reference)
    into v_target, v_to_label
    from public.bins
    where reference = upper(v_target_ref);
    if v_target is null then
      return jsonb_build_object('ok', false, 'message', 'No bin with that code. Use New bin.');
    end if;
  end if;
  if v_location_code is not null and v_target is null then
    v_problem := public.location_target_problem(v_location_code);
    if v_problem is not null then
      return jsonb_build_object('ok', false, 'message', v_problem);
    end if;
    select id, code into v_location, v_to_label
    from public.locations
    where code = upper(v_location_code);
    v_to_label := coalesce(v_to_label, upper(v_location_code));
  end if;

  if v_kind in ('bin', 'bins') then
    if v_target is null and v_location_code is null then
      return jsonb_build_object('ok', false, 'message', 'Choose a bin or a location.');
    end if;
    if v_target is not null and v_location_code is not null then
      return jsonb_build_object('ok', false, 'message', 'Choose a bin or a location, not both.');
    end if;
    for v_ref in
      select distinct upper(btrim(value))
      from jsonb_array_elements_text(coalesce(p_payload -> 'bin_refs', '[]'::jsonb)) as refs(value)
      where btrim(value) <> ''
    loop
      select id into v_bin from public.bins where reference = v_ref;
      if v_bin is null then
        return jsonb_build_object('ok', false, 'message', 'No bin with that code. Use New bin.');
      end if;
      v_problem := public.bin_move_problem(v_bin, v_target, v_location, case when v_location is null then v_location_code else null end);
      if v_problem is not null then
        return jsonb_build_object('ok', false, 'message', v_problem);
      end if;
      v_lines := v_lines || public.describe_bin_move(v_bin, v_to_label);
    end loop;
    if cardinality(v_lines) = 0 then
      return jsonb_build_object('ok', false, 'message', 'Choose a bin to move.');
    end if;
    return jsonb_build_object('ok', true, 'summary', array_to_string(v_lines, ' '));
  end if;

  if v_kind = 'item' then
    if v_target is null then
      return jsonb_build_object('ok', false, 'message', 'Put the quantity into a bin. A location can take a bin.');
    end if;
    if v_location_code is not null then
      return jsonb_build_object('ok', false, 'message', 'Choose a bin or a location, not both.');
    end if;
    select id into v_from from public.bins where reference = upper(btrim(coalesce(p_payload ->> 'from_bin', '')));
    if v_from is null then
      return jsonb_build_object('ok', false, 'message', 'No bin with that code. Use New bin.');
    end if;
    v_item := nullif(p_payload ->> 'item_id', '')::uuid;
    v_qty := nullif(p_payload ->> 'qty', '')::integer;
    v_problem := public.item_move_problem(v_from, v_target, v_item, v_qty);
    if v_problem is not null then
      return jsonb_build_object('ok', false, 'message', v_problem);
    end if;
    select
      format(
        'Move %s of %s from %s to %s',
        v_qty,
        btrim(coalesce(item.sku, '') || ' ' || coalesce(item.name, '')),
        public.bin_display_label(source.type, source.reference),
        v_to_label
      )
    into v_line
    from public.items item, public.bins source
    where item.id = v_item
      and source.id = v_from;
    return jsonb_build_object('ok', true, 'summary', v_line);
  end if;

  if v_kind = 'empty' then
    if v_target is null then
      return jsonb_build_object('ok', false, 'message', 'Empty a bin into another bin.');
    end if;
    select id into v_from from public.bins where reference = upper(btrim(coalesce(p_payload ->> 'from_bin', '')));
    if v_from is null then
      return jsonb_build_object('ok', false, 'message', 'No bin with that code. Use New bin.');
    end if;
    if v_from = v_target then
      return jsonb_build_object('ok', false, 'message', 'Choose a different bin.');
    end if;
    if not exists (
      select 1 from public.bins where parent_bin_id = v_from and id <> v_target
      union all
      select 1 from public.bin_contents contents
      join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
      where contents.bin_id = v_from
    ) then
      return jsonb_build_object('ok', false, 'message', 'That bin is already empty.');
    end if;
    for v_bin in
      select id from public.bins where parent_bin_id = v_from and id <> v_target
    loop
      v_problem := public.bin_move_problem(v_bin, v_target, null, null);
      if v_problem is not null then
        return jsonb_build_object('ok', false, 'message', v_problem);
      end if;
    end loop;
    select public.bin_display_label(type, reference) into v_from_label from public.bins where id = v_from;
    select counts.boxes, counts.items into v_boxes, v_items from public.bin_holding_counts(v_from) as counts;
    return jsonb_build_object(
      'ok', true,
      'summary', format('Empty %s (%s boxes, %s items) into %s', v_from_label, coalesce(v_boxes, 0), coalesce(v_items, 0), v_to_label)
    );
  end if;

  return jsonb_build_object('ok', false, 'message', 'Choose what to move.');
end;
$$;

create or replace function public.fetch_move_place(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_bin public.bins;
  v_location uuid;
  v_location_code text;
  v_children jsonb;
  v_items jsonb;
  v_boxes integer;
  v_items_n integer;
begin
  if v_code = '' then
    return jsonb_build_object('kind', 'unknown', 'code', '', 'message', 'Scan or type a bin or a location.');
  end if;

  if v_code ~ '^\d{1,5}-[BCP]$' then
    select * into v_bin from public.bins where reference = v_code;
    if not found then
      return jsonb_build_object(
        'kind', 'missing_bin',
        'code', v_code,
        'type', right(v_code, 1),
        'message', 'No bin with that code. Use New bin.'
      );
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', child.id,
      'reference', child.reference,
      'type', child.type,
      'label', public.bin_display_label(child.type, child.reference),
      'boxes', (select counts.boxes from public.bin_holding_counts(child.id) as counts),
      'items', (select counts.items from public.bin_holding_counts(child.id) as counts)
    ) order by child.reference), '[]'::jsonb)
    into v_children
    from public.bins child
    where child.parent_bin_id = v_bin.id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', item.id,
      'sku', coalesce(item.sku, ''),
      'name', coalesce(item.name, ''),
      'qty', contents.qty
    ) order by item.sku), '[]'::jsonb)
    into v_items
    from public.bin_contents contents
    join public.items item on item.id = contents.item_id
    join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
    where contents.bin_id = v_bin.id;

    select counts.boxes, counts.items into v_boxes, v_items_n
    from public.bin_holding_counts(v_bin.id) as counts;

    return jsonb_build_object(
      'kind', 'bin',
      'code', v_bin.reference,
      'path', public.bin_path(v_bin.id),
      'place', public.bin_holder(v_bin.id),
      'bin', jsonb_build_object(
        'id', v_bin.id,
        'reference', v_bin.reference,
        'type', v_bin.type,
        'label', public.bin_display_label(v_bin.type, v_bin.reference),
        'boxes', coalesce(v_boxes, 0),
        'items', coalesce(v_items_n, 0)
      ),
      'children', v_children,
      'items', v_items
    );
  end if;

  select id, code into v_location, v_location_code
  from public.locations
  where code = v_code;
  if v_location is null then
    return jsonb_build_object(
      'kind', 'unknown',
      'code', v_code,
      'message', 'No bin or location with that code.'
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', bin.id,
    'reference', bin.reference,
    'type', bin.type,
    'label', public.bin_display_label(bin.type, bin.reference),
    'boxes', (select counts.boxes from public.bin_holding_counts(bin.id) as counts),
    'items', (select counts.items from public.bin_holding_counts(bin.id) as counts)
  ) order by bin.reference), '[]'::jsonb)
  into v_children
  from public.bins bin
  where bin.parent_bin_id is null
    and bin.current_location_id = v_location;

  return jsonb_build_object(
    'kind', 'location',
    'code', v_location_code,
    'path', v_location_code,
    'place', v_location_code,
    'children', v_children,
    'items', '[]'::jsonb
  );
end;
$$;

create or replace function public.list_recent_moves(p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_rows jsonb;
begin
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

comment on function public.move_bin(text, text, text, text, text) is
  'Moves one bin into a parent bin or to a location. Exactly one target. Writes one bin_events moved row. Descendants keep their parent and take the new effective location. Idempotent when p_client_request_id is set.';

comment on function public.unnest(text, text, text, text) is
  'Puts a bin at a location. This is move_bin with a location target and no parent.';

comment on function public.move_item_qty(text, text, uuid, integer, text, text, text) is
  'Moves part or all of one item from one bin to another. Writes an out and an in inventory_movements row with one transfer_id. Does not change items.quantity.';

comment on function public.empty_bin_into(text, text, text, text) is
  'Moves every child bin and every quantity in the source bin into the target bin. The source bin stays where it is.';

comment on function public.move_bin_to_location(text, text, text) is
  'Moves the bin to a location code. Wrapper around move_bin for the bin screen. Does not take a request id.';

comment on function public.undo_move(text, text, text) is
  'Reverses a stored move and logs the reverse. A repeat of the new request id does not move twice.';

revoke all on function public.bin_kind(text) from public, anon, authenticated, service_role;
revoke all on function public.bin_type_rank(text) from public, anon, authenticated, service_role;
revoke all on function public.bin_display_label(text, text) from public, anon, authenticated, service_role;
revoke all on function public.bin_holder(uuid) from public, anon, authenticated, service_role;
revoke all on function public.bin_path(uuid) from public, anon, authenticated, service_role;
revoke all on function public.bin_holding_counts(uuid) from public, anon, authenticated, service_role;
revoke all on function public.bin_nest_problem(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.location_target_problem(text) from public, anon, authenticated, service_role;
revoke all on function public.bin_move_problem(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.describe_bin_move(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.item_move_problem(uuid, uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.ensure_open_bin_cycle(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.begin_move_request(text) from public, anon, authenticated, service_role;
revoke all on function public.finish_move_request(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.perform_bin_move(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.perform_item_move(uuid, uuid, uuid, integer, text, text) from public, anon, authenticated, service_role;
revoke all on function public.lock_bins(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.resolve_bin_ref(text) from public, anon, authenticated, service_role;

revoke all on function public.bins_place_check() from public, anon, authenticated;
revoke all on function public.bins_place_sync() from public, anon, authenticated;
grant execute on function public.bins_place_check() to service_role;
grant execute on function public.bins_place_sync() to service_role;

revoke all on function public.move_bin(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.unnest(text, text, text, text) from public, anon, authenticated;
revoke all on function public.move_bins(text[], text, text, text, text) from public, anon, authenticated;
revoke all on function public.move_item_qty(text, text, uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.empty_bin_into(text, text, text, text) from public, anon, authenticated;
revoke all on function public.undo_move(text, text, text) from public, anon, authenticated;
revoke all on function public.move_bin_to_location(text, text, text) from public, anon, authenticated;
revoke all on function public.preview_move(jsonb) from public, anon, authenticated;
revoke all on function public.fetch_move_place(text) from public, anon, authenticated;
revoke all on function public.list_recent_moves(integer) from public, anon, authenticated;

grant execute on function public.move_bin(text, text, text, text, text) to service_role;
grant execute on function public.unnest(text, text, text, text) to service_role;
grant execute on function public.move_bins(text[], text, text, text, text) to service_role;
grant execute on function public.move_item_qty(text, text, uuid, integer, text, text, text) to service_role;
grant execute on function public.empty_bin_into(text, text, text, text) to service_role;
grant execute on function public.undo_move(text, text, text) to service_role;
grant execute on function public.move_bin_to_location(text, text, text) to service_role;
grant execute on function public.preview_move(jsonb) to service_role;
grant execute on function public.fetch_move_place(text) to service_role;
grant execute on function public.list_recent_moves(integer) to service_role;

notify pgrst, 'reload schema';
