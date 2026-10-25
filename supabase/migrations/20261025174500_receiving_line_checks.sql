-- Cleaned (CPU) and Wiped (SSD/HDD) on a receipt, and the putaway location on recent lines.
-- stock_events is append-only, so the flags are written on the insert.
-- A later correction stores them on stock_event_edits, which receipt_lines already prefers.
-- Not applied here. Review and apply by hand after 20261023070124_receipt_scan_raw.sql.

alter table public.stock_events
  add column cleaned boolean,
  add column wiped boolean;

comment on column public.stock_events.cleaned is
  'CPU receipt. True when Cleaned was checked. False when the box was left unchecked. Null when the item is not a CPU.';

comment on column public.stock_events.wiped is
  'SSD or HDD receipt. True when Wiped was checked. False when the box was left unchecked. Null when the item is not an SSD or HDD.';

create or replace function public.item_receive_check(p_item_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when t.id is null then null
    when upper(t.short_code) = 'CPU'
      or upper(coalesce(t.long_code, '')) = 'CPU'
      or upper(coalesce(t.long_code, '')) like 'CPU/%'
      or lower(t.name) in ('cpu', 'processor', 'processors')
      then 'cleaned'
    when upper(t.short_code) in ('HDD', 'SSD')
      or upper(coalesce(t.long_code, '')) in ('HDD', 'SSD', 'DSK/HDD', 'DSK/SSD')
      or upper(coalesce(t.long_code, '')) like '%/HDD'
      or upper(coalesce(t.long_code, '')) like '%/SSD'
      or lower(t.name) in ('hdd', 'ssd')
      then 'wiped'
    else null
  end
  from public.items as i
  left join public.taxonomies as t on t.id = i.taxonomy_id
  where i.id = p_item_id
$$;

comment on function public.item_receive_check(uuid) is
  'cleaned for a CPU taxonomy, wiped for SSD or HDD, otherwise null. Short code, long code, and taxonomy name are all read.';

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
  p_wiped boolean
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
  if v_comment is null then
    v_comment := v_scan;
  end if;
  if p_item_id is null or not exists (select 1 from public.items where id = p_item_id) then
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
    client_request_id,
    scan_raw,
    cleaned,
    wiped
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
    v_wiped
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

comment on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean) is
  'Receives a known SKU into an existing bin. A CPU stores Cleaned and a drive stores Wiped. An unchecked box is false. A repeated client request id returns the receipt already written.';

revoke all on function public.item_receive_check(uuid) from public, anon, authenticated;
revoke all on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.item_receive_check(uuid) to service_role;
grant execute on function public.receive_into_bin(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean) to service_role;

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
  p_wiped boolean
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
  v_project text := public.blank_to_null(p_project);
  v_tag text := public.blank_to_null(p_incoming_tag);
  v_origin text := public.blank_to_null(p_origin);
  v_comment text := public.blank_to_null(p_comment);
  v_sku text;
  v_name text;
  v_check text;
  v_cleaned boolean;
  v_wiped boolean;
  v_old jsonb;
  v_new jsonb;
  v_inventory boolean;
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
  if p_item_id is null or not exists (select 1 from public.items where id = p_item_id) then
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

  if v_event.cycle_id is null or v_event.bin_id is null then
    raise exception 'That receipt has no cycle.'
      using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_event.cycle_id::text, 0));

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
    v_old_item := (v_latest->>'item_id')::uuid;
  end if;

  v_old_cleaned := case
    when v_latest is not null and v_latest ? 'cleaned' then (v_latest->>'cleaned')::boolean
    else v_event.cleaned
  end;
  v_old_wiped := case
    when v_latest is not null and v_latest ? 'wiped' then (v_latest->>'wiped')::boolean
    else v_event.wiped
  end;

  select nullif(btrim(sku), ''), nullif(btrim(name), '')
  into v_old_sku, v_old_name
  from public.items
  where id = v_old_item;

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
    'wiped', v_old_wiped
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
    'wiped', v_wiped
  );

  if v_old = v_new then
    return jsonb_build_object('edited', v_latest is not null, 'values', v_new);
  end if;

  v_inventory := p_qty is distinct from v_old_qty or p_item_id is distinct from v_old_item;
  if v_inventory and p_confirmed is not true then
    raise exception 'Confirm the quantity or SKU change.'
      using errcode = '22023';
  end if;

  if v_inventory then
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

comment on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean) is
  'Records a receipt correction, including Cleaned and Wiped. Header fields stay off the ledger row. A qty or SKU change posts a receipt_adjustment after confirmation and will not take the bin below 0.';

revoke all on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean) to service_role;

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
  bin.reference as bin_reference,
  loc.code as location_code
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
  'Recent receipts with the latest correction applied, including Cleaned, Wiped, and the putaway location. The ledger row is unchanged.';

revoke all on table public.receipt_lines from public, anon, authenticated;
grant select on table public.receipt_lines to service_role;

notify pgrst, 'reload schema';
