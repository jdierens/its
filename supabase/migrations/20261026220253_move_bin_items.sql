-- Move the full on-hand quantity of each selected item from one bin into another.
-- One request id moves the whole set once. The source bin stays where it is.
-- Not applied here. Review and apply by hand after 20261024064500_move_inventory.sql.

create or replace function public.move_bin_items(
  p_from_bin_ref text,
  p_to_bin_ref text,
  p_item_ids uuid[],
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
  v_item uuid;
  v_qty integer;
  v_problem text;
  v_done jsonb;
  v_reverse jsonb := '[]'::jsonb;
  v_summaries text[] := '{}';
  v_ids uuid[] := '{}';
  v_result jsonb;
begin
  v_prior := public.begin_move_request(p_client_request_id);
  if v_prior is not null then
    return v_prior;
  end if;

  if p_item_ids is null or cardinality(p_item_ids) < 1 then
    raise exception 'Choose an item.'
      using errcode = '22023';
  end if;
  if cardinality(p_item_ids) > 200 then
    raise exception 'Move at most 200 items at once.'
      using errcode = '22023';
  end if;

  foreach v_item in array p_item_ids loop
    if v_item is null then
      raise exception 'Choose an item.'
        using errcode = '22023';
    end if;
    if v_item = any (v_ids) then
      raise exception 'Choose each item once.'
        using errcode = '22023';
    end if;
    v_ids := v_ids || v_item;
  end loop;

  v_from := public.resolve_bin_ref(p_from_bin_ref);
  v_to := public.resolve_bin_ref(p_to_bin_ref);
  perform public.lock_bins(array[v_from, v_to]);

  for v_item in
    select listed.id
    from unnest(v_ids) as listed(id)
    order by listed.id
  loop
    select contents.qty into v_qty
    from public.bin_contents contents
    join public.bin_cycles cycle on cycle.id = contents.cycle_id and cycle.status = 'open'
    where contents.bin_id = v_from
      and contents.item_id = v_item;

    if v_qty is null then
      raise exception 'That bin does not hold this item.'
        using errcode = '22023';
    end if;

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

comment on function public.move_bin_items(text, text, uuid[], text, text) is
  'Moves the full on-hand quantity of each selected item from one bin into another. One request id moves the set once and can be undone. The source bin stays where it is. Does not change items.quantity.';

revoke all on function public.move_bin_items(text, text, uuid[], text, text) from public, anon, authenticated;
grant execute on function public.move_bin_items(text, text, uuid[], text, text) to service_role;

notify pgrst, 'reload schema';
