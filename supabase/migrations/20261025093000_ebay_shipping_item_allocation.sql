-- eBay buyer-shipping freight lines allocate to ITS item SKU 4343.
-- Apply this yourself. Deploying does not run it.
-- Rows that already have an allocation are left as they are.
-- If item 4343 is not in the catalog yet, this inserts nothing.

insert into public.so_line_allocations (so_line_id, item_id, qty, operator_id)
select line.id, ship.id, line.qty, null
from public.so_lines as line
join public.sales_orders as so on so.id = line.sales_order_id
cross join lateral (
  select id
  from public.items
  where lower(btrim(sku)) = '4343'
  order by id
  limit 1
) as ship
where line.line_kind = 'freight'
  and line.qty > 0
  and (so.ebay_order_id is not null or so.source = 'ebay')
  and not exists (
    select 1
    from public.so_line_allocations as alloc
    where alloc.so_line_id = line.id
  );
