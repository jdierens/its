-- PayPal fee line on a sales order, payment methods for that fee, and a
-- contact on orders that are not from eBay.
-- so_lines.managed_fee is paypal on the one line the app adds and updates.
-- A line a person entered, including the same SKU, stays blank.
-- Payment method choices for a new order are ach, wire, paypal, zelle, and ebay.
-- Older codes stay so an existing payment_method still references a row.
-- Fee SKUs live in app_settings. The defaults are 102475 and 102476.
-- contact_name, contact_email, and contact_phone are optional.
-- Apply by hand on project fxsbpreasbdalwthyzvk after
-- supabase/migrations/20261028233000_sales_order_packing.sql.
-- Deploying does not run this file. Deploying this repository does not run this file.

insert into public.so_payment_methods (code, label, sort_order) values
  ('ach', 'ACH', 1),
  ('wire', 'Wire', 2),
  ('zelle', 'Zelle', 4)
on conflict (code) do update
  set label = excluded.label,
      sort_order = excluded.sort_order;

update public.so_payment_methods set label = 'PayPal', sort_order = 3 where code = 'paypal';
update public.so_payment_methods set label = 'eBay', sort_order = 5 where code = 'ebay';
update public.so_payment_methods set sort_order = 11 where code = 'wire_ach';
update public.so_payment_methods set sort_order = 12 where code = 'credit_card';
update public.so_payment_methods set sort_order = 13 where code = 'check';
update public.so_payment_methods set sort_order = 14 where code = 'other';

comment on column public.sales_orders.payment_method is
  'How this order was paid. ach, wire, paypal, or zelle on an order that is not eBay. ebay on an eBay order. Older codes remain valid.';

alter table public.sales_orders
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text;

comment on column public.sales_orders.contact_name is
  'Person to reach about an order that is not from eBay. Blank on an eBay order.';

comment on column public.sales_orders.contact_email is
  'Email for that contact. Blank when it was not on the PO or the email.';

comment on column public.sales_orders.contact_phone is
  'Phone for that contact. Blank when it was not on the PO or the email.';

alter table public.so_lines
  add column if not exists managed_fee text;

alter table public.so_lines
  drop constraint if exists so_lines_managed_fee_check;

alter table public.so_lines
  add constraint so_lines_managed_fee_check
  check (managed_fee is null or managed_fee = 'paypal');

comment on column public.so_lines.managed_fee is
  'paypal on the fee line the app adds and reprices. Null on a line a person entered.';

insert into public.app_settings (key, value)
values
  ('paypal_fee_domestic_sku', '102475'),
  ('paypal_fee_international_sku', '102476')
on conflict (key) do nothing;

create or replace function public.promote_mapped_sales_lines(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_ids uuid[];
  v_id uuid;
  v_line public.so_lines;
  v_alloc public.so_line_allocations;
  v_new uuid;
  v_no integer := 0;
  v_price numeric;
begin
  select status into v_status from public.sales_orders where id = p_order for update;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft can be approved.'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(id order by line_no), array[]::uuid[])
  into v_ids
  from public.so_lines
  where sales_order_id = p_order;

  -- Park the draft line numbers so the new SKU lines can take 1, 2, 3.
  update public.so_lines
  set line_no = line_no + 3000000
  where sales_order_id = p_order;

  foreach v_id in array v_ids
  loop
    select * into v_line from public.so_lines where id = v_id;
    if not exists (select 1 from public.so_line_allocations where so_line_id = v_id) then
      v_no := v_no + 1;
      update public.so_lines set line_no = v_no where id = v_id;
      continue;
    end if;

    for v_alloc in
      select *
      from public.so_line_allocations
      where so_line_id = v_id
      order by alloc_no, created_at, id
    loop
      v_no := v_no + 1;
      v_price := coalesce(v_alloc.unit_price, v_line.unit_price);
      insert into public.so_lines (
        sales_order_id, line_no, line_kind, customer_part_number, customer_description,
        qty, unit_price, ext_price, condition, suggested_item_ids, eccn, hts_code, country_of_origin, line_note, managed_fee
      ) values (
        p_order,
        v_no,
        v_line.line_kind,
        v_line.customer_part_number,
        v_line.customer_description,
        v_alloc.qty,
        v_price,
        case when v_price is null then null else round(v_alloc.qty * v_price, 2) end,
        v_line.condition,
        v_line.suggested_item_ids,
        v_line.eccn,
        v_line.hts_code,
        v_line.country_of_origin,
        v_line.line_note,
        v_line.managed_fee
      )
      returning id into v_new;

      insert into public.so_line_allocations (
        so_line_id, item_id, qty, unit_price, ext_price, alloc_no, operator_id,
        actual_item_id, swap_reason, swapped_at, swapped_by
      ) values (
        v_new,
        v_alloc.item_id,
        v_alloc.qty,
        v_price,
        case when v_price is null then null else round(v_alloc.qty * v_price, 2) end,
        1,
        v_alloc.operator_id,
        v_alloc.actual_item_id,
        v_alloc.swap_reason,
        v_alloc.swapped_at,
        v_alloc.swapped_by
      );
    end loop;

    delete from public.so_lines where id = v_id;
  end loop;
end;
$$;

create or replace function public.relink_sales_order_picks(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pick record;
  v_alloc uuid;
begin
  for v_pick in
    select p.id, p.item_id, p.qty_picked
    from public.so_picks p
    join public.so_pick_lists pl on pl.id = p.pick_list_id
    where pl.sales_order_id = p_order
      and p.allocation_id is null
      and p.item_id is not null
    order by p.picked_at nulls last, p.id
  loop
    select a.id into v_alloc
    from public.so_line_allocations a
    join public.so_lines l on l.id = a.so_line_id
    where l.sales_order_id = p_order
      and coalesce(a.actual_item_id, a.item_id) = v_pick.item_id
      and (
        select coalesce(sum(linked.qty_picked), 0)
        from public.so_picks linked
        where linked.allocation_id = a.id
      ) + v_pick.qty_picked <= a.qty
    order by l.line_no, a.alloc_no
    limit 1;
    if v_alloc is not null then
      update public.so_picks set allocation_id = v_alloc where id = v_pick.id;
    end if;
  end loop;
end;
$$;

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
  v_number bigint;
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
  v_alloc_n integer;
  v_alloc_qty numeric;
  v_alloc_price numeric;
  v_channel text := public.blank_to_null(p_payload ->> 'channel');
  v_method text := public.blank_to_null(p_payload ->> 'payment_method');
  v_paid date;
  v_txn numeric;
  v_label_fee numeric;
  v_ad numeric;
  v_earnings numeric;
  v_payment numeric;
  v_actual uuid;
  v_swap_reason text;
  v_planned_type text;
  v_managed text;
  v_ebay boolean := false;
  v_contact_name text;
  v_contact_email text;
  v_contact_phone text;
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
  if v_id is not null then
    select (
      channel = 'ebay'
      or source = 'ebay'
      or nullif(btrim(coalesce(ebay_order_id, '')), '') is not null
      or nullif(btrim(coalesce(ebay_sales_record_ref, '')), '') is not null
    )
    into v_ebay
    from public.sales_orders
    where id = v_id;
  end if;
  if v_channel = 'ebay' or public.blank_to_null(p_payload ->> 'source') = 'ebay' then
    v_ebay := true;
  end if;
  if coalesce(v_ebay, false) then
    v_method := 'ebay';
  elsif v_method = 'ebay' then
    raise exception 'eBay is only for an eBay order.'
      using errcode = '22023';
  end if;
  v_contact_name := case when coalesce(v_ebay, false) then null else public.blank_to_null(p_payload ->> 'contact_name') end;
  v_contact_email := case when coalesce(v_ebay, false) then null else public.blank_to_null(p_payload ->> 'contact_email') end;
  v_contact_phone := case when coalesce(v_ebay, false) then null else public.blank_to_null(p_payload ->> 'contact_phone') end;
  begin
    v_paid := nullif(p_payload ->> 'payment_date', '')::date;
    v_txn := public.so_optional_money(p_payload ->> 'ebay_transaction_fee');
    v_label_fee := public.so_optional_money(p_payload ->> 'ebay_label_fee');
    v_ad := public.so_optional_money(p_payload ->> 'ebay_ad_fee');
    v_earnings := public.so_optional_money(p_payload ->> 'ebay_order_earnings');
    v_payment := public.so_optional_money(p_payload ->> 'payment_amount');
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Enter a payment date.'
        using errcode = '22023';
  end;
  if v_payment is not null and v_payment < 0 then
    raise exception 'Enter a payment amount.'
      using errcode = '22023';
  end if;
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
      legacy_journal_ref, sheet_ref, payment_requirement, payment_method, payment_date, payment_ref, payment_amount,
      ebay_transaction_fee, ebay_label_fee, ebay_ad_fee, ebay_order_earnings,
      contact_name, contact_email, contact_phone, operator_id
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
      v_payment,
      v_txn,
      v_label_fee,
      v_ad,
      v_earnings,
      v_contact_name,
      v_contact_email,
      v_contact_phone,
      v_operator
    )
    returning id, status into v_id, v_status;
    v_event := 'created';
    v_from := null;
  else
    select status, so_number into v_status, v_number
    from public.sales_orders where id = v_id for update;
    if v_status is null then
      raise exception 'Sales order not found.'
        using errcode = 'P0002';
    end if;
    if v_status not in ('draft', 'approved', 'picking') then
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
      payment_amount = v_payment,
      ebay_transaction_fee = v_txn,
      ebay_label_fee = v_label_fee,
      ebay_ad_fee = v_ad,
      ebay_order_earnings = v_earnings,
      contact_name = v_contact_name,
      contact_email = v_contact_email,
      contact_phone = v_contact_phone,
      operator_id = v_operator,
      updated_at = now()
    where id = v_id;
    delete from public.so_lines where sales_order_id = v_id;
    delete from public.so_customer_notes where sales_order_id = v_id;
    v_event := 'updated';
    v_from := v_status;
  end if;

  for line in
    select value from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb))
  loop
    v_managed := public.blank_to_null(line ->> 'managed_fee');
    if v_managed is not null and v_managed <> 'paypal' then
      raise exception 'That fee line is not recognized.'
        using errcode = '22023';
    end if;
    if v_method is distinct from 'paypal' then
      if v_managed = 'paypal' then
        continue;
      end if;
      v_managed := null;
    end if;
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
      qty, unit_price, ext_price, condition, eccn, hts_code, country_of_origin, line_note, managed_fee
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
      public.blank_to_null(line ->> 'country_of_origin'),
      public.blank_to_null(line ->> 'line_note'),
      v_managed
    )
    returning id into v_line;

    v_alloc_n := 0;
    for alloc in
      select value from jsonb_array_elements(coalesce(line -> 'allocations', '[]'::jsonb))
    loop
      if nullif(alloc ->> 'item_id', '') is null then
        continue;
      end if;
      v_alloc_n := v_alloc_n + 1;
      v_alloc_qty := nullif(alloc ->> 'qty', '')::numeric;
      v_alloc_price := nullif(alloc ->> 'unit_price', '')::numeric;
      if v_alloc_qty is null or v_alloc_qty <= 0 then
        raise exception 'Enter a quantity above 0.'
          using errcode = '22023';
      end if;
      if v_alloc_price is not null and v_alloc_price < 0 then
        raise exception 'Enter a unit price.'
          using errcode = '22023';
      end if;
      v_actual := nullif(alloc ->> 'actual_item_id', '')::uuid;
      v_swap_reason := public.blank_to_null(alloc ->> 'swap_reason');
      if v_actual is not distinct from (alloc ->> 'item_id')::uuid then
        v_actual := null;
        v_swap_reason := null;
      end if;
      if v_actual is not null then
        select item_type into v_planned_type from public.items where id = (alloc ->> 'item_id')::uuid;
        if public.so_pick_sheet_place(v_kind, v_planned_type) is distinct from 'pick' then
          raise exception 'That line is not picked.'
            using errcode = '22023';
        end if;
        perform public.so_check_replacement_item((alloc ->> 'item_id')::uuid, v_actual);
        if v_swap_reason is null then
          raise exception 'Enter a reason for the replacement.'
            using errcode = '22023';
        end if;
      end if;
      insert into public.so_line_allocations (
        so_line_id, item_id, qty, unit_price, ext_price, alloc_no, operator_id,
        actual_item_id, swap_reason, swapped_at, swapped_by
      ) values (
        v_line,
        (alloc ->> 'item_id')::uuid,
        v_alloc_qty,
        v_alloc_price,
        case when v_alloc_price is null then null else round(v_alloc_qty * v_alloc_price, 2) end,
        coalesce(nullif(alloc ->> 'alloc_no', '')::integer, v_alloc_n),
        v_operator,
        v_actual,
        case when v_actual is null then null else v_swap_reason end,
        case when v_actual is null then null else now() end,
        case when v_actual is null then null else v_operator end
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

  perform public.relink_sales_order_picks(v_id);

  perform public.log_so_event(v_id, v_event, v_from, v_status, null, v_operator, v_label);

  return jsonb_build_object('id', v_id, 'status', v_status, 'so_number', v_number);
end;
$$;

comment on function public.promote_mapped_sales_lines(uuid) is
  'Draft only. Replaces each customer line that has mapped SKUs with one sales-order line per SKU. Quantity, unit price, extension, a fulfilled SKU, the line note, and managed_fee are copied. The planned item_id is unchanged.';

comment on function public.write_sales_order(jsonb, text, uuid) is
  'Inserts a draft, or replaces a draft, an approved order, or an order that is being picked. An approved order stays approved. A picking order stays picking. Both keep so_number. Cancelled, closed, and every other status are rejected. Replaces lines, allocations, and customer notes, then relinks picks onto the fulfilled SKU. Stores a replacement on the allocation when actual_item_id differs from item_id. An eBay order stores payment method ebay. so_lines.managed_fee marks the PayPal fee line. Contact name, email, and phone are stored for every other order. Does not assign so_number.';

notify pgrst, 'reload schema';
