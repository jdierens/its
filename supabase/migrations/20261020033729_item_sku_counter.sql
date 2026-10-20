-- Next SKU for a new item. One counter, separate from bin_counter.
-- The next number is chosen when it is reserved: one past the higher of
-- the counter and the highest all-digit SKU already stored. An import of
-- older SKUs cannot collide with a number handed out after it, and a
-- number typed by hand moves the counter past that number.
-- RLS stays off, matching items. This does not change bin numbers.
-- Applied on fxsbpreasbdalwthyzvk as version 20261020033729.

create table public.sku_counter (
  id smallint primary key,
  next_number bigint not null,
  constraint sku_counter_singleton check (id = 1),
  constraint sku_counter_next_positive check (next_number >= 1)
);

alter table public.sku_counter disable row level security;
grant all on table public.sku_counter to anon, authenticated, service_role;

comment on table public.sku_counter is
  'Single next SKU. Not the bin counter. Advanced when a number is reserved or a higher numeric SKU is saved.';

create or replace function public.reserve_item_sku()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  issued bigint;
  floor_value bigint;
begin
  insert into public.sku_counter (id, next_number)
  values (1, 1)
  on conflict (id) do nothing;

  select next_number
    into issued
  from public.sku_counter
  where id = 1
  for update;

  select coalesce(max(sku::bigint), 0)
    into floor_value
  from public.items
  where sku ~ '^[0-9]{1,18}$';

  if issued <= floor_value then
    issued := floor_value + 1;
  end if;

  update public.sku_counter
  set next_number = issued + 1
  where id = 1;

  return issued::text;
end;
$$;

comment on function public.reserve_item_sku() is
  'Locks the SKU counter and returns the next number. Safe for two people creating items at once.';

create or replace function public.advance_sku_counter()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  numeric_sku bigint;
begin
  if new.sku is not null and new.sku ~ '^[0-9]{1,18}$' then
    numeric_sku := new.sku::bigint;
    insert into public.sku_counter (id, next_number)
    values (1, numeric_sku + 1)
    on conflict (id) do update
      set next_number = greatest(public.sku_counter.next_number, excluded.next_number);
  end if;
  return new;
end;
$$;

comment on function public.advance_sku_counter() is
  'Keeps the SKU counter above any numeric SKU that is inserted or edited, including an import.';

create trigger items_advance_sku_counter
before insert or update of sku on public.items
for each row
execute function public.advance_sku_counter();

revoke all on function public.reserve_item_sku() from public;
revoke all on function public.advance_sku_counter() from public;
grant execute on function public.reserve_item_sku() to anon, authenticated, service_role;
grant execute on function public.advance_sku_counter() to anon, authenticated, service_role;
