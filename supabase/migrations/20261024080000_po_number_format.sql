-- Purchase-order numbers match the sales-order shape: PO6304, with no hyphen.
-- Not applied here. Review and apply by hand. Do not run this against production
-- until it has been reviewed.
--
-- The update at the bottom is the go-live step. It sets the next number to 6304.
-- It does not renumber or delete existing test purchase orders.

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

-- Go-live step. Continues the legacy series at PO6304.
-- A counter already at or above 6304 is left where it is, so this cannot move
-- the counter backwards. purchase_orders rows are not updated.
update public.po_counter
set next_number = 6304
where id = 1
  and next_number < 6304;
