-- One tracking number per sales order. The eBay pull matches on that number
-- with spaces removed and letter case ignored. Deploying does not run this file.
-- Apply it by hand after 20261024070800_sales_orders.sql.
-- If creation fails because two rows already share a tracking number, remove
-- the duplicate, then run this file again.

create unique index if not exists so_shipments_order_awb_key
  on public.so_shipments (sales_order_id, lower(regexp_replace(btrim(awb), '[[:space:]]+', '', 'g')))
  where nullif(btrim(awb), '') is not null;

comment on column public.so_shipments.ebay_tracking_pushed_at is
  'When this tracking number is already on eBay. The eBay pull sets it so a later push from ITS does not send the same number again. A future push sets it after eBay accepts a number that started in ITS.';
