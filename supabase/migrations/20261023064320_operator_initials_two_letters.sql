-- New writes require exactly two letters. Rows already stored in
-- bins.created_by_initials, bin_cycles.opened_by_initials, stock_events.operator_initials,
-- and the other initials columns are left as they are.
-- Not applied here. Review and apply by hand.

create or replace function public.operator_initials(p_initials text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_initials text := upper(btrim(coalesce(p_initials, '')));
begin
  if v_initials !~ '^[A-Z]{2}$' then
    raise exception 'Operator initials must be 2 letters.'
      using errcode = '22023';
  end if;
  return v_initials;
end;
$$;

comment on function public.operator_initials(text) is
  'Uppercases and trims operator initials. Requires exactly two letters A-Z.';

revoke all on function public.operator_initials(text) from public, anon, authenticated;
grant execute on function public.operator_initials(text) to service_role;

notify pgrst, 'reload schema';
