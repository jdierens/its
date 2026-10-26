-- Move several chosen quantities from one bin into another in one request.
-- Each line carries its own quantity. A repeat of the request id does not move twice.
-- The source bin stays where it is. A location still cannot take a loose quantity.
-- Not applied here. Review and apply by hand after 20261024064500_move_inventory.sql.
-- This is an extra signature of move_bin_items. The full-quantity uuid[] form can stay.

create or replace function public.move_bin_items(
  p_from_bin_ref text,
  p_to_bin_ref text,
  p_lines jsonb,
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
  v_line jsonb;
  v_item uuid;
  v_item_text text;
  v_qty_text text;
  v_qty integer;
  v_problem text;
  v_done jsonb;
  v_reverse jsonb := '[]'::jsonb;
  v_summaries text[] := '{}';
  v_seen uuid[] := '{}';
  v_count integer;
  v_result jsonb;
begin
  v_prior := public.begin_move_request(p_client_request_id);
  if v_prior is not null then
    return v_prior;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 then
    raise exception 'Choose an item.'
      using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count > 200 then
    raise exception 'Move at most 200 items at once.'
      using errcode = '22023';
  end if;

  for v_line in
    select value
    from jsonb_array_elements(p_lines)
  loop
    v_item_text := nullif(btrim(v_line ->> 'item_id'), '');
    v_qty_text := nullif(btrim(v_line ->> 'qty'), '');
    if v_item_text is null or v_item_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Choose an item.'
        using errcode = '22023';
    end if;
    if v_qty_text is null or v_qty_text !~ '^[0-9]+$' or char_length(v_qty_text) > 7 then
      raise exception 'Enter a whole number of at least 1.'
        using errcode = '22023';
    end if;
    v_item := v_item_text::uuid;
    if v_item = any (v_seen) then
      raise exception 'Choose each item once.'
        using errcode = '22023';
    end if;
    v_seen := v_seen || v_item;
  end loop;

  v_from := public.resolve_bin_ref(p_from_bin_ref);
  v_to := public.resolve_bin_ref(p_to_bin_ref);
  perform public.lock_bins(array[v_from, v_to]);

  for v_item, v_qty in
    select (line.value ->> 'item_id')::uuid, (line.value ->> 'qty')::integer
    from jsonb_array_elements(p_lines) as line(value)
    order by 1
  loop
    v_problem := public.item_move_problem(v_from, v_to, v_item, v_qty);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
    v_done := public.perform_item_move(v_from, v_to, v_item, v_qty, v_initials, null);
    v_reverse := v_reverse || jsonb_build_array(v_done -> 'reverse_op');
    v_summaries := v_summaries || coalesce(v_done ->> 'summary', '');
  end loop;

  v_result := jsonb_build_object(
    'summary', array_to_string(v_summaries, ' '),
    'reverse', v_reverse,
    'initials', v_initials
  );
  perform public.finish_move_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

comment on function public.move_bin_items(text, text, jsonb, text, text) is
  'Moves each listed quantity from one bin into another. One request id moves the set once and can be undone. The source bin stays where it is. Does not change items.quantity.';

revoke all on function public.move_bin_items(text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.move_bin_items(text, text, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
