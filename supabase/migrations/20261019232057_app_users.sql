-- Google sign-in profiles. First sign-in creates a pending row.
-- jan@deepdiscountservers.com is seeded as an approved admin. The id is a
-- placeholder until that Google account signs in; ensure_app_user moves the
-- row onto auth.uid().
-- created_by / updated_by record the signed-in user when the request carries
-- a session. The deployed app uses the anon key, so auth.uid() is null and
-- those columns stay empty.
-- RLS stays off. Authenticated users can read app_users and cannot write
-- the table. ensure_app_user and set_app_user are security definer.
-- Phase 2 (not in this migration) enables policies and revokes anon writes
-- on the existing app tables after this release is deployed.
-- Applied on fxsbpreasbdalwthyzvk as version 20261019232057.

create table public.app_users (
  id uuid primary key,
  email text not null,
  name text,
  role text not null default 'read_only',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  approved_by uuid,
  constraint app_users_email_present check (char_length(btrim(email)) > 0),
  constraint app_users_role_known check (role in ('admin', 'staff', 'read_only')),
  constraint app_users_status_known check (status in ('pending', 'approved', 'disabled')),
  constraint app_users_approved_by_fk
    foreign key (approved_by) references public.app_users (id) on update cascade on delete set null
);

create unique index app_users_email_lower_uidx on public.app_users (lower(email));

comment on table public.app_users is
  'People who may use ITS. id matches auth.uid() after the first Google sign-in. Pending and disabled accounts cannot use the app.';

comment on column public.app_users.approved_by is
  'Approved admin who approved this account. Null for the seeded admin.';

insert into public.app_users (id, email, name, role, status)
values (
  '00000000-0000-4000-8000-000000000001',
  'jan@deepdiscountservers.com',
  'Jan',
  'admin',
  'approved'
);

alter table public.app_users disable row level security;
revoke all on table public.app_users from public, anon, authenticated;
grant select on table public.app_users to authenticated;
grant all on table public.app_users to service_role;

alter table public.items
  add column created_by uuid,
  add column updated_by uuid;

comment on column public.items.created_by is
  'auth.uid() of the signed-in user who created the item. Null when the anon app writes the row. No foreign key.';

comment on column public.items.updated_by is
  'auth.uid() of the signed-in user who last edited the item. Null when the anon app writes the row. No foreign key.';

alter table public.item_taxonomy_changes
  add column created_by uuid;

comment on column public.item_taxonomy_changes.created_by is
  'auth.uid() of the signed-in user who changed the taxonomy. Null for the anon app. No foreign key.';

alter table public.price_quotes
  add column created_by uuid;

comment on column public.price_quotes.created_by is
  'auth.uid() of the signed-in user who saved the quote. captured_by stays the free-text label. No foreign key.';

alter table public.item_transactions
  add column created_by uuid;

comment on column public.item_transactions.created_by is
  'auth.uid() of the signed-in user who recorded the transaction. Null for the anon app. No foreign key.';

create or replace function public.stamp_created_by()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := v_uid;
  end if;

  if tg_table_name = 'items' and (tg_op = 'INSERT' or tg_op = 'UPDATE') then
    new.updated_by := v_uid;
  end if;

  return new;
end;
$$;

comment on function public.stamp_created_by() is
  'Fills created_by, and updated_by on items, from the signed-in user. A request with no session leaves the columns unchanged.';

create or replace function public.stamp_bin_actor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
begin
  if v_email is not null and (new.actor is null or btrim(new.actor) = '') then
    new.actor := v_email;
  end if;
  return new;
end;
$$;

comment on function public.stamp_bin_actor() is
  'Fills bin_events.actor with the signed-in email when the row does not name one.';

revoke all on function public.stamp_created_by() from public;
revoke all on function public.stamp_bin_actor() from public;
grant execute on function public.stamp_created_by() to anon, authenticated, service_role;
grant execute on function public.stamp_bin_actor() to anon, authenticated, service_role;

drop trigger if exists items_stamp_created_by on public.items;
create trigger items_stamp_created_by
  before insert or update on public.items
  for each row
  execute function public.stamp_created_by();

drop trigger if exists item_taxonomy_changes_stamp_created_by on public.item_taxonomy_changes;
create trigger item_taxonomy_changes_stamp_created_by
  before insert on public.item_taxonomy_changes
  for each row
  execute function public.stamp_created_by();

drop trigger if exists price_quotes_stamp_created_by on public.price_quotes;
create trigger price_quotes_stamp_created_by
  before insert on public.price_quotes
  for each row
  execute function public.stamp_created_by();

drop trigger if exists item_transactions_stamp_created_by on public.item_transactions;
create trigger item_transactions_stamp_created_by
  before insert on public.item_transactions
  for each row
  execute function public.stamp_created_by();

do $$
begin
  if to_regclass('public.bins') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'bins'
         and column_name = 'created_by'
     ) then
    execute 'drop trigger if exists bins_stamp_created_by on public.bins';
    execute 'create trigger bins_stamp_created_by before insert on public.bins for each row execute function public.stamp_created_by()';
  end if;

  if to_regclass('public.bin_events') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'bin_events'
         and column_name = 'actor'
     ) then
    execute 'drop trigger if exists bin_events_stamp_actor on public.bin_events';
    execute 'create trigger bin_events_stamp_actor before insert on public.bin_events for each row execute function public.stamp_bin_actor()';
  end if;
end;
$$;

create or replace function public.ensure_app_user(p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_row public.app_users%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  if v_email !~ '^[^@[:space:]]+@deepdiscountservers\.com$' then
    raise exception 'Sign-in is limited to @deepdiscountservers.com' using errcode = '42501';
  end if;

  select * into v_row from public.app_users where id = v_uid;
  if not found then
    select * into v_row from public.app_users where lower(email) = v_email;
    if found and v_row.id is distinct from v_uid then
      update public.app_users set id = v_uid where id = v_row.id;
      select * into v_row from public.app_users where id = v_uid;
      if not found then
        select * into v_row from public.app_users where lower(email) = v_email;
      end if;
    end if;
  end if;

  if not found then
    insert into public.app_users (id, email, name, role, status)
    values (v_uid, v_email, v_name, 'read_only', 'pending')
    returning * into v_row;
  elsif v_name is not null and (v_row.name is null or btrim(v_row.name) = '') then
    update public.app_users set name = v_name where id = v_row.id
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'email', v_row.email,
    'name', v_row.name,
    'role', v_row.role,
    'status', v_row.status
  );
end;
$$;

comment on function public.ensure_app_user(text) is
  'Links the signed-in Google account to app_users. A seeded email keeps its role and status. A new email starts pending.';

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

  if p_role not in ('admin', 'staff', 'read_only') then
    raise exception 'Role must be admin, staff, or read_only' using errcode = '22023';
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

comment on function public.set_app_user(uuid, text, text) is
  'An approved admin approves a user, changes a role, or disables an account.';

revoke all on function public.ensure_app_user(text) from public, anon;
revoke all on function public.set_app_user(uuid, text, text) from public, anon;
grant execute on function public.ensure_app_user(text) to authenticated, service_role;
grant execute on function public.set_app_user(uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
