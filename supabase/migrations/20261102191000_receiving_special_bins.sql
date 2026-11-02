-- Two receiving locations that are not a numbered box, crate, or pallet:
-- 00000-X and RCV. Normal bin codes stay five digits, a hyphen, and B, C, or P.
-- Apply by hand after supabase/migrations/20261031060000_damaged_inventory.sql.
-- Not applied here.

alter table public.bins drop constraint if exists bins_number_positive;

alter table public.bins
  add constraint bins_number_positive check (
    number > 0
    or reference in ('00000-X', 'RCV')
  );

alter table public.bins drop constraint if exists bins_reference_format;

alter table public.bins
  add constraint bins_reference_format check (
    reference in ('00000-X', 'RCV')
    or reference = (number::text || '-' || type)
    or (
      char_length(split_part(reference, '-', 1)) = 5
      and reference = (lpad(number::text, 5, '0') || '-' || type)
    )
  );

insert into public.bins (number, type, reference, printed_count, notes)
select 0, 'B', '00000-X', 0, 'Temporary receiving location.'
where not exists (select 1 from public.bins where reference = '00000-X');

insert into public.bins (number, type, reference, printed_count, notes)
select -1, 'B', 'RCV', 0, 'Temporary receiving location.'
where not exists (select 1 from public.bins where reference = 'RCV');

-- Receiving putaway and import checks reject anything that is not five digits
-- plus B, C, or P. These two codes are the only extra references those checks allow.
do $patch$
declare
  r record;
  v_def text;
  v_next text;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('edit_receipt', 'import_receiving_rows')
  loop
    v_def := pg_get_functiondef(r.signature);
    v_next := replace(
      v_def,
      'v_requested !~ ''^[0-9]{5}-[BCP]$''',
      'v_requested !~ ''^[0-9]{5}-[BCP]$'' and v_requested not in (''00000-X'', ''RCV'')'
    );
    v_next := replace(
      v_next,
      'v_bin_ref !~ ''^\d{5}-[BCP]$''',
      'v_bin_ref !~ ''^\d{5}-[BCP]$'' and v_bin_ref not in (''00000-X'', ''RCV'')'
    );
    v_next := replace(
      v_next,
      'v_serial ~ ''^\d{1,5}-[A-Za-z]$''',
      '(v_serial ~ ''^\d{1,5}-[A-Za-z]$'' or upper(btrim(v_serial)) in (''00000-X'', ''RCV''))'
    );
    if v_next is distinct from v_def then
      execute v_next;
    end if;
  end loop;
end;
$patch$;
