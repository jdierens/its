-- QuickBooks invoice columns on so_invoices.
-- source is its for an invoice created here, and qbo_import for a historic
-- QuickBooks pull. qbo_sale_amount is the QuickBooks total minus negative fee
-- lines. qbo_total_amt is the raw QuickBooks total. The sales-order stage
-- strip compares the sum of qbo_sale_amount to the sum of so_lines.ext_price,
-- and treats a $0 qbo_total_amt against a non-zero sales order as voided.
-- Those invoice rows are already loaded. This file does not backfill them.
-- Apply by hand on project fxsbpreasbdalwthyzvk.
-- Deploying does not run this file.

alter table public.so_invoices
  add column if not exists source text not null default 'its',
  add column if not exists qbo_txn_date date,
  add column if not exists qbo_total_amt numeric(14,2),
  add column if not exists qbo_fee_amount numeric(14,2),
  add column if not exists qbo_sale_amount numeric(14,2),
  add column if not exists qbo_customer_id text,
  add column if not exists qbo_sync_token text,
  add column if not exists qbo_last_updated timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'so_invoices_source_check'
      and conrelid = 'public.so_invoices'::regclass
  ) then
    alter table public.so_invoices
      add constraint so_invoices_source_check check (source in ('its', 'qbo_import'));
  end if;
end $$;

create unique index if not exists so_invoices_qbo_invoice_id_unique
  on public.so_invoices (qbo_invoice_id) where qbo_invoice_id is not null;

comment on column public.so_invoices.source is
  'its for an invoice created in this app. qbo_import for a QuickBooks invoice linked to the sales order.';

comment on column public.so_invoices.qbo_sale_amount is
  'QuickBooks total minus negative fee lines. The invoiced icon sums this, not qbo_total_amt.';

comment on column public.so_invoices.qbo_total_amt is
  'Raw QuickBooks invoice total. A sum of $0 against a non-zero sales order is a voided invoice.';

notify pgrst, 'reload schema';
