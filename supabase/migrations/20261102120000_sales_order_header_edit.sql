-- Shipped and other post-pick sales orders can save document fields without rewriting lines.
-- Cancelled and closed stay rejected. Draft, approved, and picking still replace lines.
-- An email order with no default contact fills a blank contact from the From header.
-- customers.primary_email, phone, given_name, and family_name are the QuickBooks profile,
-- not a default contact. customer_has_default_contact stays false until one is assigned.
-- Net10, Net14, Net45, and Net90 are inserted when missing. A code already stored is left as it is.
-- Apply by hand on project fxsbpreasbdalwthyzvk.
-- Deploying does not run this file.

insert into public.so_payment_terms (code, label, qbo_term_name, sort_order) values
  ('Net10', 'Net 10', 'Net 10', 5),
  ('Net14', 'Net 14', 'Net 14', 6),
  ('Net45', 'Net 45', 'Net 45', 9),
  ('Net90', 'Net 90', 'Net 90', 10)
on conflict (code) do nothing;

-- Day order: Net 7, Net 10, Net 14, Net 15, Net 30, Net 45, Net 90.
-- Only move Net 15 and Net 30 when they still have the previous sort and Net 10 was placed at 5.
update public.so_payment_terms
set sort_order = 8
where code = 'Net30'
  and sort_order = 6
  and exists (select 1 from public.so_payment_terms where code = 'Net10' and sort_order = 5);

update public.so_payment_terms
set sort_order = 7
where code = 'Net15'
  and sort_order = 5
  and exists (select 1 from public.so_payment_terms where code = 'Net10' and sort_order = 5);

comment on column public.sales_orders.bill_to is
  'Postal address copied from the customer and editable: company, line1, line2, city, countrySubDivisionCode, postalCode, country. Company is this bill-to name.';

comment on column public.sales_orders.ship_to is
  'Ship-to address, plus company, attention, and phone. Company is independent of the bill-to company.';

create or replace function public.customer_has_default_contact(p_customer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

comment on function public.customer_has_default_contact(uuid) is
  'True when the customer has a default contact assigned. There is no customer-contacts table. primary_email, phone, given_name, and family_name are the QuickBooks customer profile, not a default contact, so this returns false. Replace this function when a default contact exists. Called from write_sales_order.';

revoke all on function public.customer_has_default_contact(uuid) from public, anon, authenticated;
grant execute on function public.customer_has_default_contact(uuid) to service_role;

create or replace function public.so_sender_contact(p_from text)
returns table (person text, email text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_from, ''));
  v_name text;
  v_email text;
begin
  person := null;
  email := null;
  if v_text = '' then
    return next;
    return;
  end if;
  v_text := regexp_replace(v_text, '\s+', ' ', 'g');
  if v_text ~ '<[^<>]+>' then
    v_name := btrim(btrim(split_part(v_text, '<', 1)), '"');
    v_email := btrim(split_part(split_part(v_text, '<', 2), '>', 1));
  elsif position('@' in v_text) > 0 then
    v_email := v_text;
    v_name := split_part(v_text, '@', 1);
  end if;
  if v_email is null or v_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then
    v_email := null;
  end if;
  if v_name is null or v_name = '' or v_name !~ '[A-Za-z]' or char_length(v_name) > 120 then
    v_name := null;
  end if;
  person := v_name;
  email := v_email;
  return next;
end;
$$;

comment on function public.so_sender_contact(text) is
  'Display name and email from a From header. A bare address uses the mailbox local-part as the name. Phone is not in the header.';

revoke all on function public.so_sender_contact(text) from public, anon, authenticated;
grant execute on function public.so_sender_contact(text) to service_role;

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
  v_replace_lines boolean := false;
  v_message_id text;
  v_from_header text;
  v_source_text text;
  v_old_message text;
  v_kept_name text;
  v_kept_email text;
  v_kept_phone text;
  v_sender_name text;
  v_sender_email text;
  v_row_found boolean := false;
  v_linking boolean := false;
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


  v_from_header := public.blank_to_null(coalesce(p_payload ->> 'email_from', p_payload ->> 'from'));
  v_message_id := public.blank_to_null(p_payload ->> 'source_message_id');
  v_source_text := public.blank_to_null(p_payload ->> 'source');
  if v_id is not null then
    select source_message_id, contact_name, contact_email, contact_phone
      into v_old_message, v_kept_name, v_kept_email, v_kept_phone
    from public.sales_orders
    where id = v_id;
    v_row_found := found;
  end if;
  v_linking := v_row_found
    and v_message_id is not null
    and nullif(btrim(coalesce(v_old_message, '')), '') is null;
  if not coalesce(v_ebay, false) and (v_id is null or v_linking) then
    select person, email into v_sender_name, v_sender_email
    from public.so_sender_contact(v_from_header);
    if public.customer_has_default_contact(v_customer) then
      if v_linking then
        v_contact_name := coalesce(v_kept_name, v_contact_name);
        v_contact_email := coalesce(v_kept_email, v_contact_email);
        v_contact_phone := coalesce(v_kept_phone, v_contact_phone);
      end if;
    elsif v_id is null and (v_source_text = 'email' or v_message_id is not null or v_from_header is not null) then
      v_contact_name := coalesce(v_contact_name, v_sender_name);
      v_contact_email := coalesce(v_contact_email, v_sender_email);
    elsif v_linking then
      v_contact_name := coalesce(v_kept_name, v_contact_name, v_sender_name);
      v_contact_email := coalesce(v_kept_email, v_contact_email, v_sender_email);
      v_contact_phone := coalesce(v_kept_phone, v_contact_phone);
    end if;
  end if;

  if v_id is null then
    insert into public.sales_orders (
      status, customer_id, customer_po, reference, order_date, ship_date,
      bill_to, ship_to, terms, incoterms, ship_method, carrier_account,
      currency, sales_rep, export_notes, internal_notes, source, channel,
      legacy_journal_ref, sheet_ref, source_message_id, payment_requirement, payment_method, payment_date, payment_ref, payment_amount,
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
      v_message_id,
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
    v_replace_lines := true;
  else
    select status, so_number into v_status, v_number
    from public.sales_orders where id = v_id for update;
    if v_status is null then
      raise exception 'Sales order not found.'
        using errcode = 'P0002';
    end if;
    if v_status in ('cancelled', 'closed') then
      raise exception 'That sales order can no longer be edited.'
        using errcode = '22023';
    end if;
    if v_status in ('draft', 'approved', 'picking') then
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
      source_message_id = case
        when p_payload ? 'source_message_id' then v_message_id
        else source_message_id
      end,
      operator_id = v_operator,
      updated_at = now()
    where id = v_id;
    delete from public.so_lines where sales_order_id = v_id;
    delete from public.so_customer_notes where sales_order_id = v_id;
    v_replace_lines := true;
    else
    update public.sales_orders set
      customer_po = public.blank_to_null(p_payload ->> 'customer_po'),
      ship_date = nullif(p_payload ->> 'ship_date', '')::date,
      bill_to = p_payload -> 'bill_to',
      ship_to = p_payload -> 'ship_to',
      terms = public.blank_to_null(p_payload ->> 'terms'),
      incoterms = public.blank_to_null(p_payload ->> 'incoterms'),
      ship_method = public.blank_to_null(p_payload ->> 'ship_method'),
      carrier_account = public.blank_to_null(p_payload ->> 'carrier_account'),
      export_notes = public.blank_to_null(p_payload ->> 'export_notes'),
      internal_notes = public.blank_to_null(p_payload ->> 'internal_notes'),
      contact_name = v_contact_name,
      contact_email = v_contact_email,
      contact_phone = v_contact_phone,
      source_message_id = case
        when p_payload ? 'source_message_id' then v_message_id
        else source_message_id
      end,
      operator_id = v_operator,
      updated_at = now()
    where id = v_id;
    delete from public.so_customer_notes where sales_order_id = v_id;
    v_replace_lines := false;
    end if;
    v_event := 'updated';
    v_from := v_status;
  end if;

  if v_replace_lines then
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
  end if;

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

  if v_replace_lines then
    perform public.relink_sales_order_picks(v_id);
  end if;

  perform public.log_so_event(v_id, v_event, v_from, v_status, null, v_operator, v_label);

  return jsonb_build_object('id', v_id, 'status', v_status, 'so_number', v_number);
end;
$$;

comment on function public.write_sales_order(jsonb, text, uuid) is
  'Inserts a draft, or replaces a draft, an approved order, or an order that is being picked. Those three keep their status and so_number. Packing, packed, shipped, and every other status except cancelled and closed update document fields only: customer PO, ship date, bill-to, ship-to, terms, incoterms, ship method, carrier account, notes, and contact. Lines, allocations, prices, customer, and payment stay as they are, and picks are not relinked. Cancelled and closed are rejected. An email create, or the first source_message_id, fills a blank contact from email_from or from when the customer has no default contact. A default contact leaves the sales-order contact unchanged. An eBay order stores payment method ebay and a blank contact. so_lines.managed_fee marks the PayPal fee line. A negative unit price is stored on a freight, fee, service, discount, or other line. A product or kit line cannot have a negative unit price. Does not assign so_number.';

notify pgrst, 'reload schema';
