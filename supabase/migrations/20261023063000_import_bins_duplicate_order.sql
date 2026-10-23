-- Look up an existing bin before the in-file duplicate check.
-- 20000-P is "20000 is already used by 20000-B." when 20000-B is already stored,
-- even if 20000-B also appears earlier in the file.
-- An exact repeat of a code is still "Duplicate in file."
-- A different suffix on a number first seen in this file is "<n> is used by <code> in row X".
-- Not applied here. Review and apply by hand before merge.

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
  v_file jsonb := '{}'::jsonb;
  v_prior jsonb;
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
    v_prior := null;
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
      elsif char_length(v_note) > 2000 then
        v_status := 'error';
        v_reason := 'Note is too long.';
      else
        select reference into v_existing
        from public.bins
        where number = v_number;

        if v_existing is not null then
          if v_existing <> v_code then
            v_status := 'error';
            v_reason := format('%s is already used by %s.', v_number, v_existing);
          elsif v_code = any (v_seen) then
            v_status := 'error';
            v_reason := 'Duplicate in file.';
          else
            v_status := 'exists';
            v_reason := 'Already exists.';
          end if;
        else
          v_prior := v_file -> v_number::text;
          if v_code = any (v_seen) then
            v_status := 'error';
            v_reason := 'Duplicate in file.';
          elsif v_prior is not null then
            v_status := 'error';
            v_reason := format(
              '%s is used by %s in row %s.',
              v_number,
              v_prior ->> 'code',
              v_prior ->> 'row'
            );
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
    end if;

    if v_status = 'exists' then
      v_seen := v_seen || v_code;
    elsif v_status = 'new' then
      v_seen := v_seen || v_code;
      v_file := jsonb_set(
        v_file,
        array[v_number::text],
        jsonb_build_object('code', v_code, 'row', v_index)
      );
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
  'Registers existing bin codes. The database is checked before in-file duplicates. An existing number with another suffix is an error. An exact repeat in the file is a duplicate. Existing numbers are skipped and never updated. No cycle is opened and nothing is printed. A dry run returns the same statuses without writing. When any row is an error, nothing is written.';

revoke all on function public.import_bins(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.import_bins(jsonb, text, boolean) to service_role;

notify pgrst, 'reload schema';
