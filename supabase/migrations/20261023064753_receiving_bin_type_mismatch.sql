-- A typed code whose suffix does not match the selected type gets its own error.
-- The signature is unchanged. Not applied here. Review and apply by hand.

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
  v_suffix text;
  v_suffix_word text;
  v_selected_word text;
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
    if v_code !~ '^\d{5}-[BCP]$' then
      raise exception 'A bin code is five digits, a hyphen, and B, C, or P.'
        using errcode = '22023';
    end if;
    v_number := split_part(v_code, '-', 1)::integer;
    if v_number::text <> split_part(v_code, '-', 1) then
      raise exception 'A bin code is five digits, a hyphen, and B, C, or P.'
        using errcode = '22023';
    end if;
    v_suffix := right(v_code, 1);
    if v_suffix <> v_type then
      v_suffix_word := case v_suffix
        when 'C' then 'crate'
        when 'P' then 'pallet'
        else 'box'
      end;
      v_selected_word := case v_type
        when 'C' then 'Crate'
        when 'P' then 'Pallet'
        else 'Box'
      end;
      raise exception 'Code % is a %, but % is selected.', v_code, v_suffix_word, v_selected_word
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
  'Creates one bin from the next free code, or from a typed five-digit code, and counts one label print. A typed suffix that does not match the selected type is rejected with its own message. The insert trigger places the bin at the current default for its suffix.';

revoke all on function public.create_receiving_bin(text, text, text) from public, anon, authenticated;
grant execute on function public.create_receiving_bin(text, text, text) to service_role;

notify pgrst, 'reload schema';
