-- Purchase-order numbers match the sales-order shape: PO6304, with no hyphen.
-- Not applied here. Review and apply by hand. Do not run this against production
-- until it has been reviewed.
--
-- This file does not move po_counter. Applying it leaves the next number where
-- it is, so test orders keep using the current series. At go-live, run
-- supabase/go-live/po_counter_seed.sql by hand. That script is not a migration.

create or replace function public.reserve_purchase_order_number()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  issued bigint;
begin
  select next_number
    into issued
  from public.po_counter
  where id = 1
  for update;

  update public.po_counter
  set next_number = issued + 1
  where id = 1;

  return 'PO' || issued::text;
end;
$$;

comment on function public.reserve_purchase_order_number() is
  'Locks the purchase-order counter and returns the next number as PO plus the integer, for example PO6304. No hyphen.';

comment on table public.po_counter is
  'Next purchase-order number. Display is PO plus the integer, with no hyphen. Locked with SELECT FOR UPDATE when a number is reserved.';
