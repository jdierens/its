-- Warehouse roles and the pricing officer assignment.
-- Does not insert users. Live database is project fxsbpreasbdalwthyzvk;
-- apply this file by hand if it is not already on that project.
-- service_role stays the only grant. Do not grant anon or authenticated.

alter table public.app_users drop constraint app_users_role_known;

alter table public.app_users
  add constraint app_users_role_known
  check (role in ('admin', 'staff', 'read_only', 'warehouse_manager', 'warehouse_clerk'));

alter table public.app_users
  add column pricing_officer boolean not null default false;

comment on column public.app_users.pricing_officer is
  'Assignment, not a role. Grants can_allocate_cogs and can_view_financials. At least one approved user must hold it.';

update public.app_users
set pricing_officer = true
where role = 'admin'
  and status = 'approved';

-- The users screen writes through the server action. This function still
-- lists the allowed roles so a direct call matches the check constraint.
-- It keeps using auth.uid(), so the service role does not take this path.
create or replace function public.set_app_user(p_id uuid, p_role text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.app_users%rowtype;
  v_admins integer;
begin
  if v_actor is null or not exists (
    select 1
    from public.app_users
    where id = v_actor
      and role = 'admin'
      and status = 'approved'
  ) then
    raise exception 'Only an approved admin can change users' using errcode = '42501';
  end if;

  if p_role not in ('admin', 'staff', 'read_only', 'warehouse_manager', 'warehouse_clerk') then
    raise exception 'Role must be admin, staff, warehouse_manager, warehouse_clerk, or read_only' using errcode = '22023';
  end if;

  if p_status not in ('pending', 'approved', 'disabled') then
    raise exception 'Status must be pending, approved, or disabled' using errcode = '22023';
  end if;

  select * into v_row from public.app_users where id = p_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'P0002';
  end if;

  if p_id = v_actor and (p_role <> 'admin' or p_status <> 'approved') then
    raise exception 'You cannot remove your own admin access' using errcode = '22023';
  end if;

  select count(*) into v_admins
  from public.app_users
  where role = 'admin'
    and status = 'approved'
    and id <> p_id;

  if v_row.role = 'admin'
     and v_row.status = 'approved'
     and v_admins = 0
     and (p_role <> 'admin' or p_status <> 'approved') then
    raise exception 'Keep at least one approved admin' using errcode = '22023';
  end if;

  update public.app_users
  set role = p_role,
      status = p_status,
      approved_by = case
        when p_status = 'approved' and v_row.status is distinct from 'approved' then v_actor
        else approved_by
      end
  where id = p_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'email', v_row.email,
    'role', v_row.role,
    'status', v_row.status
  );
end;
$$;

revoke all on function public.set_app_user(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_app_user(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
