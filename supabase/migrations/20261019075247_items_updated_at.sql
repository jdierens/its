-- Additive. The deployed app does not select items.updated_at.
-- Existing rows start equal to created_at. Later updates stamp now().
-- Applied on fxsbpreasbdalwthyzvk as version 20261019075247.
alter table public.items add column if not exists updated_at timestamptz;

update public.items
   set updated_at = coalesce(created_at, now())
 where updated_at is null;

alter table public.items alter column updated_at set default now();
alter table public.items alter column updated_at set not null;

comment on column public.items.updated_at is
  'Set on each update. Existing rows start equal to created_at.';

create or replace function public.items_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

comment on function public.items_touch_updated_at() is
  'Sets items.updated_at on update. Not used for authorization.';

revoke all on function public.items_touch_updated_at() from public, anon, authenticated;

drop trigger if exists items_touch_updated_at on public.items;
create trigger items_touch_updated_at
before update on public.items
for each row
execute function public.items_touch_updated_at();

notify pgrst, 'reload schema';
