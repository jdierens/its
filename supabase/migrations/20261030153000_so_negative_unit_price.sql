-- Negative unit prices on discount, fee, service, freight, and other sales-order lines.
-- The extension stays the cent rounding of quantity times unit price, so a negative
-- price reduces the order total. Product and kit lines, and any line that maps a
-- product or kit SKU, stay at zero or above.
-- SKU 5619 Sales Discount and SKU 6117 Bank Charge_WireFee are this kind of line.
-- Apply by hand on project fxsbpreasbdalwthyzvk after
-- supabase/migrations/20261029010000_sales_order_paypal_fee.sql.
-- Deploying does not run this file. Deploying this repository does not run this file.

alter table public.so_lines drop constraint if exists so_lines_price_nonnegative;
alter table public.so_lines drop constraint if exists so_lines_unit_price_sign;

alter table public.so_lines
  add constraint so_lines_unit_price_sign check (
    unit_price is null
    or unit_price >= 0
    or line_kind in ('freight', 'fee', 'service', 'discount', 'other')
  );

comment on constraint so_lines_unit_price_sign on public.so_lines is
  'Product and kit unit prices stay at zero or above. Freight, fee, service, discount, and other lines may be negative. The extension check still requires ext_price = round(qty * unit_price, 2).';

alter table public.so_line_allocations drop constraint if exists so_line_allocations_price_nonnegative;

create or replace function public.so_line_allocations_unit_price_sign()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
  v_type text;
begin
  if new.unit_price is null or new.unit_price >= 0 then
    return new;
  end if;
  select item_type into v_type
  from public.items
  where id = new.item_id;
  if v_type in ('Product', 'Kit/Package') then
    raise exception 'A product line cannot have a negative unit price.'
      using errcode = '22023';
  end if;
  select line_kind into v_kind
  from public.so_lines
  where id = new.so_line_id;
  if v_kind in ('freight', 'fee', 'service', 'discount', 'other') then
    return new;
  end if;
  raise exception 'A product line cannot have a negative unit price.'
    using errcode = '22023';
end;
$$;

drop trigger if exists so_line_allocations_unit_price_sign_trg on public.so_line_allocations;

create trigger so_line_allocations_unit_price_sign_trg
  before insert or update of unit_price, so_line_id on public.so_line_allocations
  for each row
  execute function public.so_line_allocations_unit_price_sign();

comment on function public.so_line_allocations_unit_price_sign() is
  'A mapped SKU may store a negative unit price when its line is freight, fee, service, discount, or other, and the SKU is not a product or a kit.';

revoke all on function public.so_line_allocations_unit_price_sign() from public, anon, authenticated;
grant execute on function public.so_line_allocations_unit_price_sign() to service_role;

-- Classifies a line before insert. A negative price on a product or kit line becomes
-- discount, fee, or service when the part, description, or mapped SKU says so, or when
-- every mapped item is Service or Non-inventory. A product or kit SKU is rejected.
create or replace function public.so_price_line_kind(
  p_kind text,
  p_price numeric,
  p_part text,
  p_description text,
  p_allocations jsonb
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := coalesce(public.blank_to_null(p_kind), 'product');
  v_negative boolean := p_price is not null and p_price < 0;
  v_alloc jsonb;
  v_raw text;
  v_type text;
  v_name text;
  v_sku text;
  v_text text := lower(btrim(coalesce(p_part, '') || ' ' || coalesce(p_description, '')));
  v_stock boolean := false;
  v_seen boolean := false;
  v_service_only boolean := true;
begin
  if not v_negative and p_allocations is not null then
    for v_alloc in
      select value from jsonb_array_elements(p_allocations)
    loop
      v_raw := btrim(coalesce(v_alloc ->> 'unit_price', ''));
      if v_raw ~ '^-' then
        v_negative := true;
        exit;
      end if;
    end loop;
  end if;

  if not v_negative then
    return v_kind;
  end if;

  if p_allocations is not null then
    for v_alloc in
      select value from jsonb_array_elements(p_allocations)
    loop
      if nullif(v_alloc ->> 'item_id', '') is null then
        continue;
      end if;
      select i.item_type, i.name, i.sku
      into v_type, v_name, v_sku
      from public.items as i
      where i.id = (v_alloc ->> 'item_id')::uuid;
      v_seen := true;
      v_text := v_text || ' ' || lower(btrim(coalesce(v_sku, '') || ' ' || coalesce(v_name, '')));
      if v_type in ('Product', 'Kit/Package') then
        v_stock := true;
        v_service_only := false;
      elsif v_type is distinct from 'Service' then
        v_service_only := false;
      end if;
    end loop;
  end if;

  if v_stock then
    raise exception 'A product line cannot have a negative unit price.'
      using errcode = '22023';
  end if;

  if v_kind in ('freight', 'fee', 'service', 'discount', 'other') then
    return v_kind;
  end if;

  if v_text ~ 'discount' then
    return 'discount';
  end if;
  if v_text ~ '(^|[^a-z0-9])fee([^a-z0-9]|$)' or v_text ~ 'wirefee' or v_text ~ 'charge' then
    return 'fee';
  end if;
  if v_text ~ '(^|[^a-z0-9])service([^a-z0-9]|$)' then
    return 'service';
  end if;
  if v_seen then
    if v_service_only then
      return 'service';
    end if;
    return 'fee';
  end if;

  raise exception 'A product line cannot have a negative unit price.'
    using errcode = '22023';
end;
$$;

comment on function public.so_price_line_kind(text, numeric, text, text, jsonb) is
  'Line kind to store for a unit price. Negative prices are discount, fee, service, freight, or other. A product or kit SKU cannot carry one. Called from write_sales_order.';

revoke all on function public.so_price_line_kind(text, numeric, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.so_price_line_kind(text, numeric, text, text, jsonb) to service_role;

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
    v_kind := public.so_price_line_kind(
      v_kind,
      v_price,
      line ->> 'customer_part_number',
      line ->> 'customer_description',
      coalesce(line -> 'allocations', '[]'::jsonb)
    );
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

comment on function public.write_sales_order(jsonb, text, uuid) is
  'Inserts a draft, or replaces a draft, an approved order, or an order that is being picked. An approved order stays approved. A picking order stays picking. Both keep so_number. Cancelled, closed, and every other status are rejected. Replaces lines, allocations, and customer notes, then relinks picks onto the fulfilled SKU. Stores a replacement on the allocation when actual_item_id differs from item_id. An eBay order stores payment method ebay. so_lines.managed_fee marks the PayPal fee line. Contact name, email, and phone are stored for every other order. A negative unit price is stored on a freight, fee, service, discount, or other line, and the extension is the cent rounding of quantity times that price. A product or kit line, including one that maps a product or kit SKU, cannot have a negative unit price. Does not assign so_number.';

notify pgrst, 'reload schema';
