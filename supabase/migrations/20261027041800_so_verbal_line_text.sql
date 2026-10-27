-- A verbal sales order has no customer PO text. The mapped SKU is the line.
-- The same internal SKU may be mapped more than once, at different unit prices.
-- There is no unique constraint on (so_line_id, item_id). This file does not add one.
-- Apply by hand after 20261027013000_so_mapped_sku_lines.sql.
-- Deploying does not run this file.

alter table public.so_lines drop constraint if exists so_lines_text_check;

comment on table public.so_lines is
  'On a draft, customer PO lines. Customer part number and description may both be blank when a mapped SKU is the line, as on a verbal order. After approval, one row per mapped internal SKU. Two rows may share an item when the unit prices differ.';
