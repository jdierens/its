-- Stores two-letter initials on each person.
-- Snapshot of app_users before this column existed (2026-10-23):
--   jan@deepdiscountservers.com | name Jan | initials were not stored; the app derived J
--   mayuko.tanaka@deepdiscountservers.com | name Mayuko Tanaka | the app derived MT
-- Proposed values written below: Jan JD, Mayuko Tanaka MT.
-- Historical stock and bin rows are not rewritten.
-- Rollback: alter table public.app_users drop column initials;
-- Not applied here. Review and apply by hand after 20261023064320_operator_initials_two_letters.sql.

create or replace function public.derive_operator_initials(p_name text, p_email text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_words text[];
  v_first text;
  v_last text;
  v_letters text;
begin
  if v_email = 'jan@deepdiscountservers.com' then
    return 'JD';
  end if;
  if v_name <> '' then
    v_words := regexp_split_to_array(v_name, '\s+');
    if coalesce(array_length(v_words, 1), 0) >= 2 then
      v_first := upper(substring(v_words[1] from '([A-Za-z])'));
      v_last := upper(substring(v_words[array_length(v_words, 1)] from '([A-Za-z])'));
      if v_first is not null and v_last is not null and v_first <> '' and v_last <> '' then
        return v_first || v_last;
      end if;
    end if;
  end if;
  v_letters := upper(regexp_replace(split_part(v_email, '@', 1), '[^A-Za-z]', '', 'g'));
  if char_length(v_letters) >= 2 then
    return substring(v_letters from 1 for 2);
  end if;
  return 'OP';
end;
$$;

comment on function public.derive_operator_initials(text, text) is
  'Two letters for a person. Jan is JD. A first and last name use those initials. Otherwise the first two letters of the email.';

revoke all on function public.derive_operator_initials(text, text) from public, anon, authenticated;
grant execute on function public.derive_operator_initials(text, text) to service_role;

alter table public.app_users
  add column initials text;

comment on column public.app_users.initials is
  'Two letters stored for this person. New stock rows copy this value. Older rows are not changed.';

update public.app_users
set initials = public.derive_operator_initials(name, email)
where initials is null;

alter table public.app_users
  alter column initials set not null;

alter table public.app_users
  add constraint app_users_initials_check
  check (initials ~ '^[A-Z]{2}$');

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
    insert into public.app_users (id, email, name, role, status, initials)
    values (
      v_uid,
      v_email,
      v_name,
      'read_only',
      'pending',
      public.derive_operator_initials(v_name, v_email)
    )
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
    'status', v_row.status,
    'initials', v_row.initials
  );
end;
$$;

comment on function public.ensure_app_user(text) is
  'Links the signed-in Google account to app_users. A seeded email keeps its role, status, and initials. A new email starts pending with two-letter initials.';

notify pgrst, 'reload schema';
