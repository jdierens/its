-- A posted receipt can change its putaway bin.
-- The current quantity of the current item leaves the cycle it sits on and is
-- added to the destination bin. An empty destination opens a cycle the same way
-- receive_into_bin does. The original receive row is not rewritten. The correction
-- stores the destination cycle so a later qty or SKU change adjusts that bin.
-- A pending line still changes the bin without moving stock.
-- Not applied here. Review and apply by hand after 20261026021000_receipt_pending_item.sql.

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

comment on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text) is
  'Records a receipt correction. A pending line can change search, qty, comment, and bin without an item and without moving stock. The first item link posts that qty into the bin once. A later qty, SKU, or putaway change posts a receipt_adjustment and will not take a bin below 0. A putaway change takes the current quantity off the old bin and adds it to the new bin. The receive row stays where it was posted. The correction records the cycle the quantity now sits on.';

revoke all on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text) from public, anon, authenticated;
grant execute on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean, boolean, boolean, text, text) to service_role;

comment on view public.receipt_lines is
  'Recent receipts with the latest correction applied. A pending line has a blank SKU until an item is linked. The putaway bin follows the latest correction. On a posted line, that correction also records the cycle the quantity sits on.';
