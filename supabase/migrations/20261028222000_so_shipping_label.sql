-- A customer shipping label is a sales-order PDF, stored the same way as a customer PO.
-- so_attachments.kind gains shipping_label. The other kinds stay.
-- Row level security and grants are unchanged.
-- Deploying this repository does not run this file.
-- Apply it by hand on project fxsbpreasbdalwthyzvk after 20261024070800_sales_orders.sql.

alter table public.so_attachments drop constraint so_attachments_kind_check;

alter table public.so_attachments
  add constraint so_attachments_kind_check check (
    kind in ('customer_po', 'shipping_label', 'proforma', 'packing_list', 'commercial_invoice', 'invoice', 'other')
  );

comment on constraint so_attachments_kind_check on public.so_attachments is
  'customer_po, shipping_label, proforma, packing_list, commercial_invoice, invoice, or other.';
