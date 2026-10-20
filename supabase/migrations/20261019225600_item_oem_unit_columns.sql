-- Additive. OEM name, OEM part number, and a unit pick list on every item.
-- Existing items become Piece via the column default.
-- Also renames taxonomy CBL to Cable and adds Motherboard, Heatsink, and Unsorted.
-- RLS stays off, matching items.
-- Applied on fxsbpreasbdalwthyzvk as version 20261019225600.

create table public.units (
  name text primary key,
  sort_order integer not null,
  constraint units_name_present check (char_length(btrim(name)) > 0),
  constraint units_sort_positive check (sort_order > 0)
);

comment on table public.units is
  'Pick list for items.unit. Seeded with Piece and Lbs. Add a row to offer another unit. The item stores the name, the same way condition stores New or Used.';

insert into public.units (name, sort_order) values
  ('Piece', 1),
  ('Lbs', 2);

alter table public.units disable row level security;
grant all on table public.units to anon, authenticated, service_role;

alter table public.items
  add column oem_name text,
  add column oem_part_number text,
  add column unit text not null default 'Piece' references public.units (name) on update cascade;

comment on column public.items.oem_name is
  'OEM name. Nullable text. Not a manufacturer foreign key.';

comment on column public.items.oem_part_number is
  'OEM part number. Nullable text.';

comment on column public.items.unit is
  'Unit of measure. Required. Defaults to Piece. References units.name so an admin can add values later.';

create or replace function public.normalize_unit(p_value text, p_required boolean)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text := nullif(btrim(coalesce(p_value, '')), '');
  v_name text;
begin
  if v_text is null then
    if p_required then
      return 'Piece';
    end if;
    return null;
  end if;

  select name into v_name
  from public.units
  where lower(name) = lower(v_text);

  if v_name is null then
    raise exception 'Unit must be one of the units list'
      using errcode = '22023';
  end if;

  return v_name;
end;
$$;

comment on function public.normalize_unit(text, boolean) is
  'Canonical unit name. Blank becomes Piece when required, otherwise null so an update can leave the stored unit alone. Unknown names raise.';

revoke all on function public.normalize_unit(text, boolean) from public;
grant execute on function public.normalize_unit(text, boolean) to anon, authenticated, service_role;

update public.taxonomies
set name = 'Cable'
where short_code = 'CBL';

insert into public.taxonomies (name, long_code, short_code, sort_order)
select seed.name, seed.long_code, seed.short_code,
       coalesce((select max(sort_order) from public.taxonomies), 0) + seed.n
from (
  values
    (1, 'Motherboard', 'MBD', 'MBD'),
    (2, 'Heatsink', 'SNK', 'SNK'),
    (3, 'Unsorted', 'UNS', 'UNS')
) as seed(n, name, long_code, short_code)
where not exists (
  select 1 from public.taxonomies existing where existing.short_code = seed.short_code
);
