-- Go-live only. Do not put this in supabase/migrations.
-- Run it by hand when new purchase orders should continue the legacy series.
-- Applying 20261024080000_po_number_format.sql does not run this statement.
--
-- A counter already at or above 6304 is left where it is, so this cannot move
-- the counter backwards. purchase_orders rows are not updated. A test row such
-- as PO-1 keeps the number it has.

update public.po_counter
set next_number = 6304
where id = 1
  and next_number < 6304;
