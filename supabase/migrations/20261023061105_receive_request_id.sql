-- One client request id writes one receipt line.
-- stock_events is append-only, so the id is stored on the insert.
-- Not applied here. Review and apply by hand after 20261023055637_receiving_form.sql.

alter table public.stock_events
  add column client_request_id text;

comment on column public.stock_events.client_request_id is
  'Id from one click of Save receipt. A repeat of the same id returns the existing line.';

create unique index stock_events_client_request_id_idx
  on public.stock_events (client_request_id)
  where client_request_id is not null;

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
  p_client_request_id text
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
  if p_item_id is null or not exists (select 1 from public.items where id = p_item_id) then
    raise exception 'Choose an item.'
      using errcode = '22023';
  end if;

  if v_request is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_request, 0));
    select id into v_existing_id
    from public.stock_events
    where client_request_id = v_request;
    if found then
      select jsonb_build_object(
        'bin_id', e.bin_id,
        'reference', b.reference,
        'type', b.type,
        'cycle_id', e.cycle_id,
        'cycle_opened', not exists (
          select 1
          from public.stock_events earlier
          where earlier.cycle_id = e.cycle_id
            and (earlier.occurred_at, earlier.id) < (e.occurred_at, e.id)
        ),
        'location_code', l.code,
        'qty', coalesce((
          select bc.qty
          from public.bin_contents bc
          where bc.cycle_id = e.cycle_id
            and bc.item_id = e.item_id
        ), e.qty),
        'received_on', e.received_on
      )
      into v_receipt
      from public.stock_events e
      join public.bins b on b.id = e.bin_id
      left join public.locations l on l.id = e.to_location_id
      where e.id = v_existing_id;
      return v_receipt;
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
    client_request_id
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
    v_request
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
    'event_id', v_event_id
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
    select jsonb_build_object(
      'bin_id', e.bin_id,
      'reference', b.reference,
      'type', b.type,
      'cycle_id', e.cycle_id,
      'cycle_opened', not exists (
        select 1
        from public.stock_events earlier
        where earlier.cycle_id = e.cycle_id
          and (earlier.occurred_at, earlier.id) < (e.occurred_at, e.id)
      ),
      'location_code', l.code,
      'qty', coalesce((
        select bc.qty
        from public.bin_contents bc
        where bc.cycle_id = e.cycle_id
          and bc.item_id = e.item_id
      ), e.qty),
      'received_on', e.received_on
    )
    into v_receipt
    from public.stock_events e
    join public.bins b on b.id = e.bin_id
    left join public.locations l on l.id = e.to_location_id
    where e.id = v_existing_id;
    return v_receipt;
end;
$$;

comment on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text) is
  'Receives a known SKU into an existing bin. A repeated client request id returns the receipt already written and does not add another line.';

revoke all on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text) from public, anon, authenticated;
grant execute on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text) to service_role;

notify pgrst, 'reload schema';
