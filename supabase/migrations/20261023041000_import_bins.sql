-- Data management: register existing bin codes without opening a cycle or printing.
-- Existing codes are left unchanged. A blank location uses the current put-away default.
-- A zero-padded five-digit code such as 01234-B is stored as written. The number stays 1234.
-- Not applied here. Review and apply by hand before merge.

alter table public.bins drop constraint bins_reference_format;

alter table public.bins
  add constraint bins_reference_format check (
    reference = (number::text || '-' || type)
    or (
      char_length(split_part(reference, '-', 1)) = 5
      and reference = (lpad(number::text, 5, '0') || '-' || type)
    )
  );

alter table public.stock_events
  add column source text;

comment on column public.stock_events.source is
  'import when Data management registers a bin. Null for receiving and moves.';

alter table public.stock_events drop constraint stock_events_type_check;

alter table public.stock_events
  add constraint stock_events_type_check
  check (event_type in ('receive_into_bin', 'move_bin_location', 'bin_imported'));

alter table public.stock_events
  add constraint stock_events_import_check check (
    event_type <> 'bin_imported'
    or (
      source = 'import'
      and cycle_id is null
      and item_id is null
      and qty is null
    )
  );

comment on table public.stock_events is
  'Append-only log. receive_into_bin points at the bin cycle. move_bin_location points at the open cycle when there is one. bin_imported records a bin registered from Data management: source is import, and there is no cycle and no quantity. items.quantity is not updated from these rows.';

create or replace function public.import_bins(
  p_rows jsonb,
  p_initials text,
  p_dry_run boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_count integer;
  v_next integer;
  v_max_imported integer;
  v_bumped boolean := false;
  v_results jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index integer := 0;
  v_code text;
  v_location_text text;
  v_note text;
  v_number integer;
  v_type text;
  v_existing text;
  v_location_id uuid;
  v_resolved text;
  v_status text;
  v_reason text;
  v_seen text[] := '{}';
  v_seen_numbers integer[] := '{}';
  v_bin_id uuid;
  v_has_error boolean := false;
  v_result jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import rows must be a list.'
      using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_rows);
  if v_count > 5000 then
    raise exception 'Import at most 5000 rows at a time.'
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

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;
    v_status := 'new';
    v_reason := '';
    v_resolved := null;
    v_location_id := null;
    v_number := null;
    v_type := null;
    v_existing := null;
    v_code := upper(btrim(coalesce(v_row ->> 'code', '')));
    v_location_text := upper(btrim(coalesce(v_row ->> 'location', '')));
    v_note := btrim(coalesce(v_row ->> 'note', ''));

    if v_code !~ '^\d{5}-[BCP]$' then
      v_status := 'error';
      v_reason := 'A bin code is five digits, a hyphen, and B, C, or P.';
    else
      v_number := split_part(v_code, '-', 1)::integer;
      v_type := right(v_code, 1);
      if v_number < 1 or v_number > 99999 then
        v_status := 'error';
        v_reason := 'A bin code is five digits, a hyphen, and B, C, or P.';
      elsif v_code = any (v_seen) or v_number = any (v_seen_numbers) then
        v_status := 'error';
        v_reason := 'Duplicate in file.';
      elsif char_length(v_note) > 2000 then
        v_status := 'error';
        v_reason := 'Note is too long.';
      else
        select reference into v_existing
        from public.bins
        where number = v_number;

        if v_existing is not null then
          if v_existing = v_code then
            v_status := 'exists';
            v_reason := 'Already exists.';
          else
            v_status := 'error';
            v_reason := format('%s is already used by %s.', v_number, v_existing);
          end if;
        elsif v_location_text = '' then
          select l.code, d.location_id
          into v_resolved, v_location_id
          from public.bin_default_locations d
          join public.locations l on l.id = d.location_id
          where d.bin_type = v_type;

          if v_location_id is null then
            v_status := 'error';
            v_reason := 'No default location for this bin type.';
          end if;
        else
          select id, code
          into v_location_id, v_resolved
          from public.locations
          where code = v_location_text;

          if v_location_id is null then
            v_status := 'error';
            v_reason := format('Unknown location %s.', v_location_text);
          end if;
        end if;
      end if;
    end if;

    if v_status <> 'error' then
      v_seen := v_seen || v_code;
      v_seen_numbers := v_seen_numbers || v_number;
    end if;

    if v_status = 'error' then
      v_has_error := true;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'row', v_index,
      'code', v_code,
      'location', coalesce(v_resolved, nullif(v_location_text, '')),
      'note', nullif(v_note, ''),
      'status', v_status,
      'reason', nullif(v_reason, '')
    ));
  end loop;

  if coalesce(p_dry_run, false) or v_has_error then
    return jsonb_build_object(
      'committed', false,
      'rows', v_results,
      'counter_before', v_next,
      'counter_after', v_next,
      'counter_bumped', false
    );
  end if;

  for v_result in select value from jsonb_array_elements(v_results)
  loop
    if v_result ->> 'status' <> 'new' then
      continue;
    end if;

    v_code := v_result ->> 'code';
    v_number := split_part(v_code, '-', 1)::integer;
    v_type := right(v_code, 1);
    v_note := v_result ->> 'note';

    select id into v_location_id
    from public.locations
    where code = v_result ->> 'location';

    if v_location_id is null then
      raise exception 'Unknown location %s.', coalesce(v_result ->> 'location', '')
        using errcode = '22023';
    end if;

    insert into public.bins (
      number,
      type,
      reference,
      notes,
      printed_count,
      created_by_initials,
      current_location_id
    ) values (
      v_number,
      v_type,
      v_code,
      nullif(v_note, ''),
      0,
      v_initials,
      v_location_id
    )
    returning id into v_bin_id;

    insert into public.bin_events (bin_id, event_type, actor, to_location_id)
    values (v_bin_id, 'created', v_initials, v_location_id);

    insert into public.stock_events (
      event_type,
      bin_id,
      operator_initials,
      to_location_id,
      source,
      comment
    ) values (
      'bin_imported',
      v_bin_id,
      v_initials,
      v_location_id,
      'import',
      nullif(v_note, '')
    );

    if v_max_imported is null or v_number > v_max_imported then
      v_max_imported := v_number;
    end if;
    if v_number >= v_next then
      v_bumped := true;
    end if;
  end loop;

  if v_bumped then
    update public.bin_counter
    set next_number = v_max_imported + 1
    where id;
  end if;

  return jsonb_build_object(
    'committed', true,
    'rows', v_results,
    'counter_before', v_next,
    'counter_after', case when v_bumped then v_max_imported + 1 else v_next end,
    'counter_bumped', v_bumped
  );
end;
$$;

comment on function public.import_bins(jsonb, text, boolean) is
  'Registers existing bin codes. Existing numbers are skipped and never updated. No cycle is opened and nothing is printed. A dry run returns the same statuses without writing. When any row is an error, nothing is written.';

-- Reprint must accept a zero-padded code such as 01234-B. Privileges stay as they are.
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
  v_digits text;
begin
  if p_copies is null or p_copies < 1 or p_copies > 50 then
    raise exception 'Copies must be a whole number from 1 to 50'
      using errcode = '22023';
  end if;
  if v_ref !~ '^[0-9]+-[PCB]$' then
    raise exception 'Enter a bin reference like 20000-P'
      using errcode = '22023';
  end if;

  v_digits := split_part(v_ref, '-', 1);
  v_number := v_digits::integer;
  v_type := split_part(v_ref, '-', 2);
  if v_number < 1
    or (
      v_number::text <> v_digits
      and lpad(v_number::text, 5, '0') <> v_digits
    )
  then
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

revoke all on function public.import_bins(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.import_bins(jsonb, text, boolean) to service_role;

notify pgrst, 'reload schema';
