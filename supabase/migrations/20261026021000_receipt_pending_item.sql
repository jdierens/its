-- A receipt can be saved before an item exists.
-- The line stores the typed search, the qty, the comment, and a real bin.
-- On-hand, bin_contents, and the bin cycle stay unchanged until an item is linked.
-- The first link fills item_id and cycle_id on that row and posts the qty once,
-- the same way receive_into_bin posts a known SKU. A later item or qty change
-- is a receipt_adjustment, not a second receive.
-- The fourteen-argument edit function stays and forwards to the fifteen-argument one.
-- Not applied here. Review and apply by hand after 20261025195000_receipt_search_query.sql.

alter table public.stock_events drop constraint stock_events_receive_check;

alter table public.stock_events
  add constraint stock_events_receive_check check (
    event_type <> 'receive_into_bin'
    or (
      qty is not null
      and qty > 0
      and (
        (item_id is not null and cycle_id is not null)
        or (
          item_id is null
          and cycle_id is null
          and nullif(btrim(search_query), '') is not null
        )
      )
    )
  );

comment on constraint stock_events_receive_check on public.stock_events is
  'A receive stores a qty. A posted receive has an item and a cycle. A pending receive has neither, keeps the search text, and does not move stock.';

create or replace function public.reject_stock_event_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.event_type = 'receive_into_bin'
    and old.item_id is null
    and old.cycle_id is null
    and new.item_id is not null
    and new.cycle_id is not null
    and new.event_type = old.event_type
    and (
      to_jsonb(old) - 'item_id' - 'cycle_id' - 'bin_id' - 'to_location_id' - 'cleaned' - 'wiped'
    ) = (
      to_jsonb(new) - 'item_id' - 'cycle_id' - 'bin_id' - 'to_location_id' - 'cleaned' - 'wiped'
    )
  then
    return new;
  end if;
  raise exception 'Stock events cannot be changed.'
    using errcode = '55000';
end;
$$;

comment on function public.reject_stock_event_change() is
  'Stock events stay append-only. The one exception fills item, cycle, bin, and prep flags on a pending receive the first time an item is linked.';

revoke all on function public.reject_stock_event_change() from public, anon, authenticated;
grant execute on function public.reject_stock_event_change() to service_role;

create or replace function public.receive_event_payload(p_event_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'bin_id', e.bin_id,
    'reference', b.reference,
    'type', b.type,
    'cycle_id', e.cycle_id,
    'cycle_opened', e.item_id is not null and e.cycle_id is not null and not exists (
      select 1
      from public.stock_events earlier
      where earlier.cycle_id = e.cycle_id
        and (earlier.occurred_at, earlier.id) < (e.occurred_at, e.id)
    ),
    'location_code', l.code,
    'qty', case
      when e.item_id is null then e.qty
      else coalesce((
        select bc.qty
        from public.bin_contents bc
        where bc.cycle_id = e.cycle_id
          and bc.item_id = e.item_id
      ), e.qty)
    end,
    'received_on', e.received_on,
    'event_id', e.id,
    'pending', e.item_id is null
  )
  from public.stock_events e
  join public.bins b on b.id = e.bin_id
  left join public.locations l on l.id = e.to_location_id
  where e.id = p_event_id;
$$;

comment on function public.receive_event_payload(uuid) is
  'Receipt json for a repeated client request id. A pending line reports the line qty and does not claim a cycle was opened.';

revoke all on function public.receive_event_payload(uuid) from public, anon, authenticated;
grant execute on function public.receive_event_payload(uuid) to service_role;

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
  p_search_query text
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
    'pending', false
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

comment on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text) is
  'Receives a known SKU into an existing bin, or stores a pending line when the item is null. A pending line keeps the search text and does not move stock. A repeated client request id returns the receipt already written.';

revoke all on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text) to service_role;

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
  if v_bin_changed and not v_pending then
    raise exception 'The putaway bin stays as stored once an item is linked.'
      using errcode = '22023';
  end if;

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

  v_inventory := (not v_pending) and (
    p_qty is distinct from v_old_qty or p_item_id is distinct from v_old_item
  );
  if (v_link or v_inventory) and p_confirmed is not true then
    raise exception 'Confirm the quantity or SKU change.'
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
  elsif v_inventory then
    if p_item_id is distinct from v_old_item then
      perform public.post_receipt_adjustment(
        p_event_id, v_event.cycle_id, v_event.bin_id, v_old_item, -v_old_qty, v_initials
      );
      perform public.post_receipt_adjustment(
        p_event_id, v_event.cycle_id, v_event.bin_id, p_item_id, p_qty, v_initials
      );
    else
      perform public.post_receipt_adjustment(
        p_event_id, v_event.cycle_id, v_event.bin_id, p_item_id, p_qty - v_old_qty, v_initials
      );
    end if;

    if exists (
      select 1 from public.bin_contents where cycle_id = v_event.cycle_id
    ) then
      update public.bin_cycles
      set status = 'open',
          closed_at = null
      where id = v_event.cycle_id
        and status <> 'open';
    end if;
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

comment on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text) is
  'Records a receipt correction. A pending line can change search, qty, comment, and bin without an item and without moving stock. The first item link posts that qty into the bin once. A later qty or SKU change posts a receipt_adjustment and will not take the bin below 0.';

revoke all on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text) from public, anon, authenticated;
grant execute on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text) to service_role;

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
  p_search_query text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return public.edit_receipt(
    p_event_id,
    p_initials,
    p_received_on,
    p_project,
    p_incoming_tag,
    p_origin,
    p_origin_qty,
    p_comment,
    p_qty,
    p_item_id,
    p_confirmed,
    p_cleaned,
    p_wiped,
    p_search_query,
    null::text
  );
end;
$$;

comment on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text) is
  'Records a receipt correction and keeps the putaway bin already stored. Pending lines and the first item link are handled by the fifteen-argument function.';

revoke all on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text) to service_role;

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
  end as search_query
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
where e.event_type = 'receive_into_bin';

comment on view public.receipt_lines is
  'Recent receipts with the latest correction applied. A pending line has a blank SKU until an item is linked. The putaway bin can come from that correction while the line is still pending.';

revoke all on table public.receipt_lines from public, anon, authenticated;
grant select on table public.receipt_lines to service_role;

notify pgrst, 'reload schema';
