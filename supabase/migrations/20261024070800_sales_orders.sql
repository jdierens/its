-- Sales orders, kept apart from purchase orders.
-- Own tables, own counter, own terms, ship methods, and channels. Does not read
-- po_counter or the purchase-order terms and carrier checks.
-- Not applied here. Review and apply by hand. Do not run this against production
-- until it has been reviewed.

alter table public.customers
  add column merged_into_customer_id uuid references public.customers (id);

alter table public.customers
  add constraint customers_not_merged_into_self check (
    merged_into_customer_id is null or merged_into_customer_id <> id
  );

comment on column public.customers.merged_into_customer_id is
  'Set when this customer has been merged into another. No rows are changed by this migration.';

create table public.so_counter (
  id smallint primary key,
  next_number bigint not null,
  constraint so_counter_singleton check (id = 1),
  constraint so_counter_next_positive check (next_number >= 1)
);

insert into public.so_counter (id, next_number) values (1, 27766);

comment on table public.so_counter is
  'Next sales-order number. Seeded at 27766, the next number at go-live. Display is SO plus the integer. Never shared with po_counter, and never moved backwards.';

create table public.so_payment_terms (
  code text primary key,
  label text not null,
  qbo_term_name text not null,
  sort_order integer not null,
  constraint so_payment_terms_label_check check (char_length(btrim(label)) > 0),
  constraint so_payment_terms_qbo_check check (char_length(btrim(qbo_term_name)) > 0),
  constraint so_payment_terms_sort_check check (sort_order > 0)
);

comment on table public.so_payment_terms is
  'Sales-order payment terms. code Net7 is stored and sent to QuickBooks as "Net 7". Not the purchase-order terms list.';

insert into public.so_payment_terms (code, label, qbo_term_name, sort_order) values
  ('Net7', 'Net 7', 'Net 7', 1),
  ('Net15', 'Net 15', 'Net 15', 2),
  ('Net30', 'Net 30', 'Net 30', 3),
  ('Due', 'Due on receipt', 'Due on receipt', 4);

create table public.so_ship_methods (
  code text primary key,
  carrier text not null,
  method text not null,
  sort_order integer not null,
  constraint so_ship_methods_carrier_check check (char_length(btrim(carrier)) > 0),
  constraint so_ship_methods_method_check check (char_length(btrim(method)) > 0),
  constraint so_ship_methods_sort_check check (sort_order > 0)
);

comment on table public.so_ship_methods is
  'Sales-order ship methods, such as DHL WPX. Not the purchase-order carrier check.';

insert into public.so_ship_methods (code, carrier, method, sort_order) values
  ('DHL WPX', 'DHL', 'WPX', 1),
  ('FedEx IP', 'FedEx', 'IP', 2),
  ('UPS Saver', 'UPS', 'Saver', 3),
  ('UPS Ground', 'UPS', 'Ground', 4),
  ('Will call', 'Will call', 'Will call', 5);

create table public.so_channels (
  code text primary key,
  label text not null,
  sort_order integer not null,
  constraint so_channels_label_check check (char_length(btrim(label)) > 0),
  constraint so_channels_sort_check check (sort_order > 0)
);

comment on table public.so_channels is
  'Who the sale is for. Separate from sales_orders.source, which is how the order arrived.';

insert into public.so_channels (code, label, sort_order) values
  ('ebay', 'eBay', 1),
  ('broker_reseller', 'Broker / reseller', 2),
  ('direct', 'Direct', 3),
  ('supermicro_ff', 'Supermicro FF', 4),
  ('oem_end_user', 'OEM end user', 5),
  ('take_out', 'Take out', 6),
  ('project_buy', 'Project buy', 7),
  ('other', 'Other', 8);

create table public.so_payment_methods (
  code text primary key,
  label text not null,
  sort_order integer not null,
  constraint so_payment_methods_label_check check (char_length(btrim(label)) > 0),
  constraint so_payment_methods_sort_check check (sort_order > 0)
);

comment on table public.so_payment_methods is
  'How the customer paid. Separate from payment terms and from payment status.';

insert into public.so_payment_methods (code, label, sort_order) values
  ('wire_ach', 'Wire / ACH', 1),
  ('ebay', 'eBay', 2),
  ('credit_card', 'Credit card', 3),
  ('check', 'Check', 4),
  ('paypal', 'PayPal', 5),
  ('other', 'Other', 6);

create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  so_number bigint,
  status text not null default 'draft',
  customer_id uuid references public.customers (id),
  customer_po text,
  reference text,
  order_date date,
  ship_date date,
  bill_to jsonb,
  ship_to jsonb,
  terms text references public.so_payment_terms (code),
  incoterms text,
  ship_method text references public.so_ship_methods (code),
  carrier_account text,
  currency text not null default 'USD',
  sales_rep text,
  export_notes text,
  internal_notes text,
  source text not null default 'manual',
  channel text references public.so_channels (code),
  source_ref text,
  source_message_id text,
  ebay_order_id text,
  ebay_sales_record_ref text,
  buyer jsonb,
  field_confidence jsonb,
  sheet_ref text,
  legacy_journal_ref text,
  approved_at timestamptz,
  approved_by uuid references public.app_users (id),
  payment_requirement text not null default 'terms',
  payment_status text not null default 'unpaid',
  payment_method text references public.so_payment_methods (code),
  payment_date date,
  payment_ref text,
  ebay_transaction_fee numeric(14, 2),
  ebay_label_fee numeric(14, 2),
  ebay_ad_fee numeric(14, 2),
  ebay_order_earnings numeric(14, 2),
  staging_bin_id uuid references public.bins (id),
  operator_id uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_orders_number_positive check (so_number is null or so_number >= 1),
  constraint sales_orders_number_unique unique (so_number),
  constraint sales_orders_status_check check (status in (
    'draft', 'approved', 'proforma_sent', 'awaiting_payment', 'released',
    'picking', 'packed', 'partially_shipped', 'shipped', 'invoiced', 'closed', 'cancelled'
  )),
  constraint sales_orders_incoterms_check check (
    incoterms is null or incoterms in ('EXW', 'FCA', 'FOB', 'CIF', 'DAP', 'DDP')
  ),
  constraint sales_orders_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint sales_orders_rep_check check (sales_rep is null or sales_rep ~ '^[A-Z]{2}$'),
  constraint sales_orders_source_check check (source in ('manual', 'email', 'whatsapp', 'ebay')),
  constraint sales_orders_payment_requirement_check check (payment_requirement in ('prepay', 'terms')),
  constraint sales_orders_payment_status_check check (payment_status in ('unpaid', 'partial', 'paid'))
);

comment on table public.sales_orders is
  'Customer sales orders. so_number stays empty until approval, then it is an integer from so_counter. Display it as SO plus so_number. Not a purchase order.';

comment on column public.sales_orders.so_number is
  'Integer sales-order number. Null on a draft. Shown as SO || so_number, for example SO27766.';

comment on column public.sales_orders.reference is
  'Internal reference typed with the order, such as a sheet column. Separate from the SO number.';

comment on column public.sales_orders.ebay_order_id is
  'eBay order id. Unique when set. An eBay order still takes its SO number from so_counter.';

comment on column public.sales_orders.source is
  'How the order arrived: manual, email, whatsapp, or ebay. Separate from channel.';

comment on column public.sales_orders.channel is
  'Sales channel. Foreign key to so_channels. Null until chosen. Not the same fact as source.';

comment on column public.sales_orders.ebay_sales_record_ref is
  'eBay sales record reference. Not unique; ebay_order_id is the unique eBay key.';

comment on column public.sales_orders.sheet_ref is
  'Transactions sheet row or reference. Indexed, and not unique.';

comment on column public.sales_orders.legacy_journal_ref is
  'Legacy journal reference. Nullable and not unique.';

comment on column public.sales_orders.payment_method is
  'How this order was paid. Foreign key to so_payment_methods. Null until recorded.';

comment on column public.sales_orders.payment_ref is
  'Payment reference, such as a wire confirmation. Not an amount.';

comment on column public.sales_orders.ebay_transaction_fee is
  'eBay transaction fee. Nullable money. Hidden from a role that cannot view financials.';

comment on column public.sales_orders.ebay_label_fee is
  'eBay label fee. Nullable money. Hidden from a role that cannot view financials.';

comment on column public.sales_orders.ebay_ad_fee is
  'eBay ad fee. Nullable money. Hidden from a role that cannot view financials.';

comment on column public.sales_orders.ebay_order_earnings is
  'eBay order earnings. Nullable money. Hidden from a role that cannot view financials.';

comment on column public.sales_orders.bill_to is
  'Postal address copied from the customer and editable: line1, line2, city, countrySubDivisionCode, postalCode, country.';

comment on column public.sales_orders.ship_to is
  'Ship-to address, plus attention and phone. Copied from the customer and editable.';

create unique index sales_orders_ebay_order_id_key
  on public.sales_orders (ebay_order_id)
  where ebay_order_id is not null;

create index sales_orders_sheet_ref_idx
  on public.sales_orders (sheet_ref)
  where sheet_ref is not null;

create unique index sales_orders_source_ref_key
  on public.sales_orders (source, source_ref)
  where source_ref is not null;

create index sales_orders_customer_idx on public.sales_orders (customer_id, created_at desc);
create index sales_orders_status_idx on public.sales_orders (status, created_at desc);

create table public.so_lines (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders (id) on delete cascade,
  line_no integer not null,
  line_kind text not null default 'product',
  customer_part_number text,
  customer_description text,
  qty numeric(14, 2) not null,
  unit_price numeric(14, 4),
  ext_price numeric(14, 2),
  condition text,
  suggested_item_ids uuid[],
  eccn text,
  hts_code text,
  country_of_origin text,
  constraint so_lines_order_line_unique unique (sales_order_id, line_no),
  constraint so_lines_line_no_positive check (line_no > 0),
  constraint so_lines_kind_check check (
    line_kind in ('product', 'kit', 'freight', 'fee', 'service', 'discount', 'other')
  ),
  constraint so_lines_qty_positive check (qty > 0),
  constraint so_lines_price_nonnegative check (unit_price is null or unit_price >= 0),
  constraint so_lines_ext_check check (
    ext_price is null or unit_price is null or ext_price = round(qty * unit_price, 2)
  ),
  constraint so_lines_condition_check check (condition is null or condition in ('New', 'Used')),
  constraint so_lines_text_check check (
    nullif(btrim(coalesce(customer_part_number, '')), '') is not null
    or nullif(btrim(coalesce(customer_description, '')), '') is not null
  )
);

comment on table public.so_lines is
  'Customer lines. The part number and description stay as the customer wrote them.';

comment on column public.so_lines.line_kind is
  'product, kit, freight, fee, service, discount, or other. Default product. Kit is stored only. There is no column linking a sales-order line to a purchase-order line.';

create index so_lines_order_idx on public.so_lines (sales_order_id, line_no);

create table public.so_line_allocations (
  id uuid primary key default gen_random_uuid(),
  so_line_id uuid not null references public.so_lines (id) on delete cascade,
  item_id uuid not null references public.items (id),
  qty numeric(14, 2) not null,
  operator_id uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  constraint so_line_allocations_qty_positive check (qty > 0)
);

comment on table public.so_line_allocations is
  'SKUs that fill one customer line. Several rows are allowed. This is the only item link, matching po_lines.item_id, except a product line can be more than one SKU.';

comment on column public.so_line_allocations.item_id is
  'Required when the line kind is product: approval checks that those quantities add up to the line. Other kinds may have no item. A partial allocation on any kind must still add up.';

create index so_line_allocations_line_idx on public.so_line_allocations (so_line_id);

create table public.so_customer_notes (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders (id) on delete cascade,
  customer_id uuid references public.customers (id),
  kind text not null,
  customer_text text not null,
  response text,
  counter_text text,
  operator_id uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  constraint so_customer_notes_kind_check check (
    kind in ('warranty', 'shipping_instruction', 'accounting_contact', 'payment', 'packing', 'other')
  ),
  constraint so_customer_notes_text_check check (char_length(btrim(customer_text)) > 0),
  constraint so_customer_notes_response_check check (
    response is null or response in ('accepted', 'countered', 'ignored')
  ),
  constraint so_customer_notes_counter_check check (
    response is distinct from 'countered' or nullif(btrim(coalesce(counter_text, '')), '') is not null
  )
);

comment on table public.so_customer_notes is
  'Structured notes from the customer, each with a response: accepted, countered, or ignored.';

create index so_customer_notes_order_idx on public.so_customer_notes (sales_order_id, created_at);

create table public.so_events (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders (id) on delete cascade,
  event text not null,
  from_status text,
  to_status text,
  related_table text,
  related_id uuid,
  note text,
  operator_id uuid references public.app_users (id),
  operator_label text not null,
  occurred_at timestamptz not null default now(),
  constraint so_events_event_check check (char_length(btrim(event)) > 0),
  constraint so_events_label_check check (char_length(btrim(operator_label)) > 0)
);

comment on table public.so_events is
  'Append-only log. Every sales-order change stores the operator and the server time.';

create index so_events_order_idx on public.so_events (sales_order_id, occurred_at desc);

create table public.so_attachments (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders (id) on delete cascade,
  kind text not null,
  file_name text not null,
  storage_path text not null,
  doc_number text,
  revision integer,
  byte_size integer,
  operator_id uuid references public.app_users (id),
  operator_label text,
  created_at timestamptz not null default now(),
  constraint so_attachments_kind_check check (
    kind in ('customer_po', 'proforma', 'packing_list', 'commercial_invoice', 'invoice', 'other')
  ),
  constraint so_attachments_name_check check (char_length(btrim(file_name)) > 0),
  constraint so_attachments_path_check check (char_length(btrim(storage_path)) > 0),
  constraint so_attachments_revision_check check (revision is null or revision > 0)
);

comment on table public.so_attachments is
  'Files for a sales order. PDFs live in the private so-documents bucket at {order}/{id}.pdf.';

create index so_attachments_order_idx on public.so_attachments (sales_order_id, created_at);

create table public.so_pick_lists (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders (id) on delete cascade,
  status text not null default 'open',
  staging_bin_id uuid references public.bins (id),
  picker_label text,
  started_at timestamptz,
  finished_at timestamptz,
  operator_id uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  constraint so_pick_lists_status_check check (status in ('open', 'picked', 'short', 'cancelled'))
);

create index so_pick_lists_order_idx on public.so_pick_lists (sales_order_id, created_at desc);

create table public.so_picks (
  id uuid primary key default gen_random_uuid(),
  pick_list_id uuid not null references public.so_pick_lists (id) on delete cascade,
  allocation_id uuid references public.so_line_allocations (id),
  item_id uuid references public.items (id),
  from_bin_id uuid references public.bins (id),
  qty_asked numeric(14, 2) not null,
  qty_picked numeric(14, 2) not null default 0,
  short boolean not null default false,
  bin_scan text,
  item_scan text,
  transfer_id uuid,
  operator_id uuid references public.app_users (id),
  operator_label text,
  picked_at timestamptz,
  constraint so_picks_qty_asked_check check (qty_asked > 0),
  constraint so_picks_qty_picked_check check (qty_picked >= 0)
);

create index so_picks_list_idx on public.so_picks (pick_list_id);

create table public.so_units (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references public.so_picks (id) on delete cascade,
  item_id uuid not null references public.items (id),
  serial_number text not null,
  package_id uuid,
  operator_id uuid references public.app_users (id),
  operator_label text,
  scanned_at timestamptz not null default now(),
  constraint so_units_serial_check check (char_length(btrim(serial_number)) > 0),
  constraint so_units_item_serial_unique unique (item_id, serial_number)
);

create index so_units_pick_idx on public.so_units (pick_id);

create table public.so_shipments (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders (id) on delete cascade,
  carrier text,
  method text,
  carrier_account text,
  awb text,
  ship_date date,
  cost numeric(14, 2),
  ebay_tracking_pushed_at timestamptz,
  notification_drafted_at timestamptz,
  operator_id uuid references public.app_users (id),
  operator_label text,
  created_at timestamptz not null default now(),
  constraint so_shipments_cost_check check (cost is null or cost >= 0)
);

create index so_shipments_order_idx on public.so_shipments (sales_order_id, created_at desc);

create table public.so_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.so_shipments (id) on delete cascade,
  allocation_id uuid references public.so_line_allocations (id),
  qty_shipped numeric(14, 2) not null,
  constraint so_shipment_lines_qty_check check (qty_shipped > 0)
);

create index so_shipment_lines_shipment_idx on public.so_shipment_lines (shipment_id);

create table public.so_packages (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders (id) on delete cascade,
  shipment_id uuid references public.so_shipments (id),
  box_number integer not null,
  weight_lb numeric(10, 2),
  length_in numeric(10, 2),
  width_in numeric(10, 2),
  height_in numeric(10, 2),
  constraint so_packages_box_positive check (box_number > 0),
  constraint so_packages_order_box_unique unique (sales_order_id, box_number),
  constraint so_packages_measure_check check (
    (weight_lb is null or weight_lb >= 0)
    and (length_in is null or length_in >= 0)
    and (width_in is null or width_in >= 0)
    and (height_in is null or height_in >= 0)
  )
);

create index so_packages_order_idx on public.so_packages (sales_order_id, box_number);

alter table public.so_units
  add constraint so_units_package_fkey foreign key (package_id) references public.so_packages (id);

create table public.so_package_contents (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.so_packages (id) on delete cascade,
  allocation_id uuid references public.so_line_allocations (id),
  qty numeric(14, 2) not null,
  constraint so_package_contents_qty_check check (qty > 0)
);

create index so_package_contents_package_idx on public.so_package_contents (package_id);

create table public.so_invoices (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders (id) on delete cascade,
  order_number bigint,
  seq integer,
  number text generated always as (
    case
      when seq = 1 then 'INV' || order_number::text
      else 'INV' || order_number::text || '-' || seq::text
    end
  ) stored,
  invoice_date date,
  due_date date,
  status text not null default 'draft',
  qbo_invoice_id text,
  qbo_doc_number text,
  qbo_synced_at timestamptz,
  payment_status text,
  balance numeric(14, 2),
  operator_id uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  constraint so_invoices_seq_positive check (seq >= 1),
  constraint so_invoices_order_number_positive check (order_number >= 1),
  constraint so_invoices_order_seq_unique unique (sales_order_id, seq),
  constraint so_invoices_number_unique unique (number),
  constraint so_invoices_status_check check (status in ('draft', 'pushed')),
  constraint so_invoices_payment_check check (
    payment_status is null or payment_status in ('unpaid', 'partial', 'paid')
  )
);

comment on table public.so_invoices is
  'ITS invoice for the customer. seq 1 displays as INV plus the sales-order number. Later invoices on the same order display as INV27766-2, INV27766-3, and so on. QuickBooks upload is later.';

comment on column public.so_invoices.seq is
  '1 for the first invoice on the sales order, then 2, 3, and so on.';

comment on column public.so_invoices.number is
  'Generated display number. seq 1 is INV || order_number. Later seq values append -seq.';

comment on column public.so_invoices.qbo_invoice_id is
  'QuickBooks invoice id, filled when the invoice is uploaded. Phase 4.';

comment on column public.so_invoices.qbo_doc_number is
  'QuickBooks document number, filled when the invoice is uploaded.';

comment on column public.so_invoices.qbo_synced_at is
  'When this invoice was last uploaded to or refreshed from QuickBooks.';

create index so_invoices_order_idx on public.so_invoices (sales_order_id, created_at desc);

create or replace function public.so_invoices_set_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number bigint;
begin
  select so_number into v_number
  from public.sales_orders
  where id = new.sales_order_id;

  if v_number is null then
    raise exception 'Approve the sales order before creating an invoice.'
      using errcode = '22023';
  end if;
  if new.order_number is not null and new.order_number <> v_number then
    raise exception 'An invoice uses the sales order number.'
      using errcode = '22023';
  end if;

  new.order_number := v_number;
  if new.seq is null then
    select coalesce(max(seq), 0) + 1 into new.seq
    from public.so_invoices
    where sales_order_id = new.sales_order_id;
  end if;
  return new;
end;
$$;

create trigger so_invoices_set_order_number
before insert or update of sales_order_id, order_number, seq on public.so_invoices
for each row execute function public.so_invoices_set_order_number();

create table public.so_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.so_invoices (id) on delete cascade,
  so_line_id uuid references public.so_lines (id),
  shipment_line_id uuid references public.so_shipment_lines (id),
  qty numeric(14, 2) not null,
  unit_price numeric(14, 4),
  constraint so_invoice_lines_qty_check check (qty > 0)
);

create index so_invoice_lines_invoice_idx on public.so_invoice_lines (invoice_id);

-- Add conversion beside whatever ref types are already allowed, including a
-- later bin_transfer, without borrowing the purchase-order list.
do $migration$
declare
  v_def text;
  v_values text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.inventory_movements'::regclass
    and conname = 'inventory_movements_ref_type_check';

  if v_def is null then
    raise exception 'inventory_movements_ref_type_check is missing.';
  end if;
  if v_def ilike '%''conversion''%' then
    return;
  end if;

  select string_agg(quote_literal(token), ', ' order by token)
  into v_values
  from (
    select (regexp_matches(v_def, '''([a-z_]+)''', 'g'))[1] as token
    union
    select 'conversion'
  ) listed;

  execute 'alter table public.inventory_movements drop constraint inventory_movements_ref_type_check';
  execute format(
    'alter table public.inventory_movements add constraint inventory_movements_ref_type_check check (ref_type in (%s))',
    v_values
  );
end
$migration$;

comment on constraint inventory_movements_ref_type_check on public.inventory_movements is
  'Ledger reference. conversion is a warehouse move between SKUs. sales_order is a shipment out of staging.';

create or replace function public.so_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Sales-order events cannot be changed.'
    using errcode = '55000';
end;
$$;

create trigger so_events_append_only
before update or delete on public.so_events
for each row execute function public.so_events_append_only();

create or replace function public.log_so_event(
  p_order uuid,
  p_event text,
  p_from text,
  p_to text,
  p_note text,
  p_operator uuid,
  p_label text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.so_events (
    sales_order_id, event, from_status, to_status, note, operator_id, operator_label
  ) values (
    p_order, p_event, p_from, p_to, public.blank_to_null(p_note), p_operator, p_label
  );
end;
$$;

create or replace function public.suggest_sales_order_number()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  issued bigint;
begin
  select next_number into issued
  from public.so_counter
  where id = 1
  for update;

  if issued is null then
    raise exception 'Sales-order counter is missing.'
      using errcode = '55000';
  end if;

  loop
    exit when not exists (
      select 1 from public.sales_orders where so_number = issued
    );
    issued := issued + 1;
  end loop;

  return issued;
end;
$$;

comment on function public.suggest_sales_order_number() is
  'Locks so_counter and returns the lowest unused sales-order number at or above it. Does not move the counter.';

create or replace function public.reserve_sales_order_number()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  issued bigint;
begin
  issued := public.suggest_sales_order_number();

  update public.so_counter
  set next_number = greatest(next_number, issued + 1)
  where id = 1;

  return issued;
end;
$$;

comment on function public.reserve_sales_order_number() is
  'Locks so_counter and claims the lowest unused number at or above it. The counter never moves backwards. Does not touch po_counter.';

create or replace function public.so_known_operator(p_operator uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select id from public.app_users where id = p_operator;
$$;

create or replace function public.so_optional_money(p_value text)
returns numeric
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_text text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v_text is null then
    return null;
  end if;
  if v_text !~ '^-?[0-9]+(\.[0-9]+)?$' then
    raise exception 'Enter a valid amount.'
      using errcode = '22023';
  end if;
  return round(v_text::numeric, 2);
end;
$$;

comment on function public.so_optional_money(text) is
  'Parses a nullable money amount for a sales order. Blank is null. Called only from write_sales_order.';

create or replace function public.write_sales_order(
  p_payload jsonb,
  p_initials text,
  p_operator_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator_id);
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_status text;
  v_customer uuid := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_event text;
  v_from text;
  line jsonb;
  alloc jsonb;
  note jsonb;
  n integer := 0;
  v_line uuid;
  v_qty numeric;
  v_price numeric;
  v_kind text;
  v_channel text := public.blank_to_null(p_payload ->> 'channel');
  v_method text := public.blank_to_null(p_payload ->> 'payment_method');
  v_paid date;
  v_txn numeric;
  v_label_fee numeric;
  v_ad numeric;
  v_earnings numeric;
begin
  if v_customer is null or not exists (select 1 from public.customers where id = v_customer) then
    raise exception 'Choose a customer.'
      using errcode = '22023';
  end if;
  if v_channel is not null and not exists (select 1 from public.so_channels where code = v_channel) then
    raise exception 'Choose a channel.'
      using errcode = '22023';
  end if;
  if v_method is not null and not exists (select 1 from public.so_payment_methods where code = v_method) then
    raise exception 'Choose a payment method.'
      using errcode = '22023';
  end if;
  begin
    v_paid := nullif(p_payload ->> 'payment_date', '')::date;
    v_txn := public.so_optional_money(p_payload ->> 'ebay_transaction_fee');
    v_label_fee := public.so_optional_money(p_payload ->> 'ebay_label_fee');
    v_ad := public.so_optional_money(p_payload ->> 'ebay_ad_fee');
    v_earnings := public.so_optional_money(p_payload ->> 'ebay_order_earnings');
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Enter a payment date.'
        using errcode = '22023';
  end;
  if public.blank_to_null(upper(btrim(coalesce(p_payload ->> 'sales_rep', '')))) is not null
    and upper(btrim(p_payload ->> 'sales_rep')) !~ '^[A-Z]{2}$'
  then
    raise exception 'Sales rep initials are 2 letters.'
      using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.sales_orders (
      status, customer_id, customer_po, reference, order_date, ship_date,
      bill_to, ship_to, terms, incoterms, ship_method, carrier_account,
      currency, sales_rep, export_notes, internal_notes, source, channel,
      legacy_journal_ref, sheet_ref, payment_requirement, payment_method, payment_date, payment_ref,
      ebay_transaction_fee, ebay_label_fee, ebay_ad_fee, ebay_order_earnings, operator_id
    ) values (
      'draft',
      v_customer,
      public.blank_to_null(p_payload ->> 'customer_po'),
      public.blank_to_null(p_payload ->> 'reference'),
      nullif(p_payload ->> 'order_date', '')::date,
      nullif(p_payload ->> 'ship_date', '')::date,
      p_payload -> 'bill_to',
      p_payload -> 'ship_to',
      public.blank_to_null(p_payload ->> 'terms'),
      public.blank_to_null(p_payload ->> 'incoterms'),
      public.blank_to_null(p_payload ->> 'ship_method'),
      public.blank_to_null(p_payload ->> 'carrier_account'),
      coalesce(nullif(upper(btrim(coalesce(p_payload ->> 'currency', ''))), ''), 'USD'),
      public.blank_to_null(upper(btrim(coalesce(p_payload ->> 'sales_rep', '')))),
      public.blank_to_null(p_payload ->> 'export_notes'),
      public.blank_to_null(p_payload ->> 'internal_notes'),
      coalesce(public.blank_to_null(p_payload ->> 'source'), 'manual'),
      v_channel,
      case when p_payload ? 'legacy_journal_ref' then public.blank_to_null(p_payload ->> 'legacy_journal_ref') else null end,
      case when p_payload ? 'sheet_ref' then public.blank_to_null(p_payload ->> 'sheet_ref') else null end,
      coalesce(public.blank_to_null(p_payload ->> 'payment_requirement'), 'terms'),
      v_method,
      v_paid,
      public.blank_to_null(p_payload ->> 'payment_ref'),
      v_txn,
      v_label_fee,
      v_ad,
      v_earnings,
      v_operator
    )
    returning id, status into v_id, v_status;
    v_event := 'created';
    v_from := null;
  else
    select status into v_status from public.sales_orders where id = v_id for update;
    if v_status is null then
      raise exception 'Sales order not found.'
        using errcode = 'P0002';
    end if;
    if v_status <> 'draft' then
      raise exception 'That sales order can no longer be edited.'
        using errcode = '22023';
    end if;
    update public.sales_orders set
      customer_id = v_customer,
      customer_po = public.blank_to_null(p_payload ->> 'customer_po'),
      reference = public.blank_to_null(p_payload ->> 'reference'),
      order_date = nullif(p_payload ->> 'order_date', '')::date,
      ship_date = nullif(p_payload ->> 'ship_date', '')::date,
      bill_to = p_payload -> 'bill_to',
      ship_to = p_payload -> 'ship_to',
      terms = public.blank_to_null(p_payload ->> 'terms'),
      incoterms = public.blank_to_null(p_payload ->> 'incoterms'),
      ship_method = public.blank_to_null(p_payload ->> 'ship_method'),
      carrier_account = public.blank_to_null(p_payload ->> 'carrier_account'),
      currency = coalesce(nullif(upper(btrim(coalesce(p_payload ->> 'currency', ''))), ''), 'USD'),
      sales_rep = public.blank_to_null(upper(btrim(coalesce(p_payload ->> 'sales_rep', '')))),
      export_notes = public.blank_to_null(p_payload ->> 'export_notes'),
      internal_notes = public.blank_to_null(p_payload ->> 'internal_notes'),
      channel = v_channel,
      legacy_journal_ref = case
        when p_payload ? 'legacy_journal_ref' then public.blank_to_null(p_payload ->> 'legacy_journal_ref')
        else legacy_journal_ref
      end,
      sheet_ref = case
        when p_payload ? 'sheet_ref' then public.blank_to_null(p_payload ->> 'sheet_ref')
        else sheet_ref
      end,
      payment_requirement = coalesce(public.blank_to_null(p_payload ->> 'payment_requirement'), 'terms'),
      payment_method = v_method,
      payment_date = v_paid,
      payment_ref = public.blank_to_null(p_payload ->> 'payment_ref'),
      ebay_transaction_fee = v_txn,
      ebay_label_fee = v_label_fee,
      ebay_ad_fee = v_ad,
      ebay_order_earnings = v_earnings,
      operator_id = v_operator,
      updated_at = now()
    where id = v_id;
    delete from public.so_lines where sales_order_id = v_id;
    delete from public.so_customer_notes where sales_order_id = v_id;
    v_event := 'updated';
    v_from := 'draft';
  end if;

  for line in
    select value from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb))
  loop
    n := n + 1;
    v_qty := nullif(line ->> 'qty', '')::numeric;
    v_price := nullif(line ->> 'unit_price', '')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Enter a quantity above 0.'
        using errcode = '22023';
    end if;
    v_kind := coalesce(public.blank_to_null(line ->> 'line_kind'), 'product');
    if v_kind not in ('product', 'kit', 'freight', 'fee', 'service', 'discount', 'other') then
      raise exception 'Choose a line kind.'
        using errcode = '22023';
    end if;
    insert into public.so_lines (
      sales_order_id, line_no, line_kind, customer_part_number, customer_description,
      qty, unit_price, ext_price, condition, eccn, hts_code, country_of_origin
    ) values (
      v_id,
      n,
      v_kind,
      public.blank_to_null(line ->> 'customer_part_number'),
      public.blank_to_null(line ->> 'customer_description'),
      v_qty,
      v_price,
      case when v_price is null then null else round(v_qty * v_price, 2) end,
      public.blank_to_null(line ->> 'condition'),
      public.blank_to_null(line ->> 'eccn'),
      public.blank_to_null(line ->> 'hts_code'),
      public.blank_to_null(line ->> 'country_of_origin')
    )
    returning id into v_line;

    for alloc in
      select value from jsonb_array_elements(coalesce(line -> 'allocations', '[]'::jsonb))
    loop
      if nullif(alloc ->> 'item_id', '') is null then
        continue;
      end if;
      insert into public.so_line_allocations (so_line_id, item_id, qty, operator_id)
      values (
        v_line,
        (alloc ->> 'item_id')::uuid,
        nullif(alloc ->> 'qty', '')::numeric,
        v_operator
      );
    end loop;
  end loop;

  for note in
    select value from jsonb_array_elements(coalesce(p_payload -> 'notes', '[]'::jsonb))
  loop
    if public.blank_to_null(note ->> 'customer_text') is null then
      continue;
    end if;
    insert into public.so_customer_notes (
      sales_order_id, customer_id, kind, customer_text, response, counter_text, operator_id
    ) values (
      v_id,
      v_customer,
      coalesce(public.blank_to_null(note ->> 'kind'), 'other'),
      note ->> 'customer_text',
      public.blank_to_null(note ->> 'response'),
      public.blank_to_null(note ->> 'counter_text'),
      v_operator
    );
  end loop;

  perform public.log_so_event(v_id, v_event, v_from, 'draft', null, v_operator, v_label);

  return jsonb_build_object('id', v_id, 'status', 'draft', 'so_number', null);
end;
$$;

comment on function public.write_sales_order(jsonb, text, uuid) is
  'Inserts or replaces a draft sales order, its lines, allocations, and notes. Does not assign so_number. The SO reference is created at approval.';

create or replace function public.approve_sales_order(
  p_order uuid,
  p_initials text,
  p_operator_id uuid,
  p_number bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator_id);
  v_order public.sales_orders;
  v_number bigint;
  v_line record;
  v_allocated numeric;
begin
  select * into v_order from public.sales_orders where id = p_order for update;
  if v_order.id is null then
    raise exception 'Sales order not found.'
      using errcode = 'P0002';
  end if;
  if v_order.status <> 'draft' then
    raise exception 'Only a draft can be approved.'
      using errcode = '22023';
  end if;
  if v_order.customer_id is null then
    raise exception 'Choose a customer.'
      using errcode = '22023';
  end if;
  if v_order.order_date is null then
    raise exception 'Enter the order date.'
      using errcode = '22023';
  end if;
  if coalesce(v_order.bill_to ->> 'line1', '') = '' then
    raise exception 'Enter a bill-to address.'
      using errcode = '22023';
  end if;
  if coalesce(v_order.ship_to ->> 'line1', '') = '' then
    raise exception 'Enter a ship-to address.'
      using errcode = '22023';
  end if;
  if v_order.terms is null then
    raise exception 'Choose terms.'
      using errcode = '22023';
  end if;
  if v_order.ship_method is null then
    raise exception 'Choose a ship method.'
      using errcode = '22023';
  end if;
  if v_order.sales_rep is null then
    raise exception 'Enter the sales rep initials.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.so_lines where sales_order_id = p_order) then
    raise exception 'Add a line before approving.'
      using errcode = '22023';
  end if;

  for v_line in
    select id, line_no, line_kind, qty from public.so_lines where sales_order_id = p_order order by line_no
  loop
    select coalesce(sum(qty), 0) into v_allocated
    from public.so_line_allocations
    where so_line_id = v_line.id;
    if v_line.line_kind <> 'product' and v_allocated = 0 then
      continue;
    end if;
    if v_allocated <> v_line.qty then
      raise exception 'Line % must be allocated to SKUs that add up to the quantity.', v_line.line_no
        using errcode = '22023';
    end if;
  end loop;

  perform 1 from public.so_counter where id = 1 for update;

  if p_number is null then
    v_number := public.reserve_sales_order_number();
  else
    if p_number < 1 then
      raise exception 'Enter a sales order number.'
        using errcode = '22023';
    end if;
    if exists (select 1 from public.sales_orders where so_number = p_number) then
      raise exception 'Sales order number SO% is already used.', p_number
        using errcode = '23505';
    end if;
    update public.so_counter
    set next_number = greatest(next_number, p_number + 1)
    where id = 1;
    v_number := p_number;
  end if;

  update public.sales_orders set
    status = 'approved',
    so_number = v_number,
    approved_at = now(),
    approved_by = v_operator,
    operator_id = v_operator,
    updated_at = now()
  where id = p_order;

  perform public.log_so_event(
    p_order, 'approved', 'draft', 'approved', 'SO' || v_number::text, v_operator, v_label
  );

  return jsonb_build_object('id', p_order, 'status', 'approved', 'so_number', v_number);
end;
$$;

comment on function public.approve_sales_order(uuid, text, uuid, bigint) is
  'Approves a draft. A product line must be allocated to SKUs that add up to its quantity. Other line kinds need no item, and any allocation they do have must still add up. Assigns so_number under a lock on so_counter. Null uses the lowest free number at or above the counter. A typed number must be unused. The counter never moves backwards, and a number above it moves the counter past that number.';

create or replace function public.cancel_sales_order(
  p_order uuid,
  p_initials text,
  p_operator_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := public.operator_initials(p_initials);
  v_operator uuid := public.so_known_operator(p_operator_id);
  v_status text;
  v_number bigint;
begin
  select status, so_number into v_status, v_number
  from public.sales_orders
  where id = p_order
  for update;

  if v_status is null then
    raise exception 'Sales order not found.'
      using errcode = 'P0002';
  end if;
  if v_status in ('cancelled', 'closed') then
    raise exception 'That sales order is already %.', v_status
      using errcode = '22023';
  end if;

  update public.sales_orders set
    status = 'cancelled',
    operator_id = v_operator,
    updated_at = now()
  where id = p_order;

  perform public.log_so_event(p_order, 'cancelled', v_status, 'cancelled', null, v_operator, v_label);

  return jsonb_build_object('id', p_order, 'status', 'cancelled', 'so_number', v_number);
end;
$$;

comment on function public.cancel_sales_order(uuid, text, uuid) is
  'Cancels a sales order. A number that was already assigned stays used.';

alter table public.so_counter enable row level security;
alter table public.so_payment_terms enable row level security;
alter table public.so_ship_methods enable row level security;
alter table public.so_channels enable row level security;
alter table public.so_payment_methods enable row level security;
alter table public.sales_orders enable row level security;
alter table public.so_lines enable row level security;
alter table public.so_line_allocations enable row level security;
alter table public.so_customer_notes enable row level security;
alter table public.so_events enable row level security;
alter table public.so_attachments enable row level security;
alter table public.so_pick_lists enable row level security;
alter table public.so_picks enable row level security;
alter table public.so_units enable row level security;
alter table public.so_shipments enable row level security;
alter table public.so_shipment_lines enable row level security;
alter table public.so_packages enable row level security;
alter table public.so_package_contents enable row level security;
alter table public.so_invoices enable row level security;
alter table public.so_invoice_lines enable row level security;

revoke all on table public.so_counter from public, anon, authenticated;
revoke all on table public.so_payment_terms from public, anon, authenticated;
revoke all on table public.so_ship_methods from public, anon, authenticated;
revoke all on table public.so_channels from public, anon, authenticated;
revoke all on table public.so_payment_methods from public, anon, authenticated;
revoke all on table public.sales_orders from public, anon, authenticated;
revoke all on table public.so_lines from public, anon, authenticated;
revoke all on table public.so_line_allocations from public, anon, authenticated;
revoke all on table public.so_customer_notes from public, anon, authenticated;
revoke all on table public.so_events from public, anon, authenticated;
revoke all on table public.so_attachments from public, anon, authenticated;
revoke all on table public.so_pick_lists from public, anon, authenticated;
revoke all on table public.so_picks from public, anon, authenticated;
revoke all on table public.so_units from public, anon, authenticated;
revoke all on table public.so_shipments from public, anon, authenticated;
revoke all on table public.so_shipment_lines from public, anon, authenticated;
revoke all on table public.so_packages from public, anon, authenticated;
revoke all on table public.so_package_contents from public, anon, authenticated;
revoke all on table public.so_invoices from public, anon, authenticated;
revoke all on table public.so_invoice_lines from public, anon, authenticated;

grant select, insert, update, delete on table public.so_counter to service_role;
grant select, insert, update, delete on table public.so_payment_terms to service_role;
grant select, insert, update, delete on table public.so_ship_methods to service_role;
grant select, insert, update, delete on table public.so_channels to service_role;
grant select, insert, update, delete on table public.so_payment_methods to service_role;
grant select, insert, update, delete on table public.sales_orders to service_role;
grant select, insert, update, delete on table public.so_lines to service_role;
grant select, insert, update, delete on table public.so_line_allocations to service_role;
grant select, insert, update, delete on table public.so_customer_notes to service_role;
grant select, insert, update, delete on table public.so_events to service_role;
grant select, insert, update, delete on table public.so_attachments to service_role;
grant select, insert, update, delete on table public.so_pick_lists to service_role;
grant select, insert, update, delete on table public.so_picks to service_role;
grant select, insert, update, delete on table public.so_units to service_role;
grant select, insert, update, delete on table public.so_shipments to service_role;
grant select, insert, update, delete on table public.so_shipment_lines to service_role;
grant select, insert, update, delete on table public.so_packages to service_role;
grant select, insert, update, delete on table public.so_package_contents to service_role;
grant select, insert, update, delete on table public.so_invoices to service_role;
grant select, insert, update, delete on table public.so_invoice_lines to service_role;

revoke all on function public.so_events_append_only() from public, anon, authenticated;
grant execute on function public.so_events_append_only() to service_role;

revoke all on function public.log_so_event(uuid, text, text, text, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.so_known_operator(uuid) from public, anon, authenticated, service_role;
revoke all on function public.so_optional_money(text) from public, anon, authenticated, service_role;

revoke all on function public.so_invoices_set_order_number() from public, anon, authenticated;
grant execute on function public.so_invoices_set_order_number() to service_role;

revoke all on function public.suggest_sales_order_number() from public, anon, authenticated;
revoke all on function public.reserve_sales_order_number() from public, anon, authenticated;
revoke all on function public.write_sales_order(jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.approve_sales_order(uuid, text, uuid, bigint) from public, anon, authenticated;
revoke all on function public.cancel_sales_order(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.suggest_sales_order_number() to service_role;
grant execute on function public.reserve_sales_order_number() to service_role;
grant execute on function public.write_sales_order(jsonb, text, uuid) to service_role;
grant execute on function public.approve_sales_order(uuid, text, uuid, bigint) to service_role;
grant execute on function public.cancel_sales_order(uuid, text, uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'so-documents',
  'so-documents',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
