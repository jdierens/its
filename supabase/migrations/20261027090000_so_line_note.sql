-- Optional note on each sales-order line. Printed under the description.
-- write_sales_order stays the approved-edit version and also stores line_note.
-- promote_mapped_sales_lines copies that note onto each mapped SKU line.
-- Apply by hand. Deploying does not run this file.

alter table public.so_lines
  add column if not exists line_note text;

comment on column public.so_lines.line_note is
  'Optional note for this sales-order line. Printed under the description on the order confirmation and the invoice.';

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
      v_payment,
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
    select status, so_number into v_status, v_number
    from public.sales_orders where id = v_id for update;
    if v_status is null then
      raise exception 'Sales order not found.'
        using errcode = 'P0002';
    end if;
    if v_status not in ('draft', 'approved') then
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
      qty, unit_price, ext_price, condition, eccn, hts_code, country_of_origin, line_note
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
      public.blank_to_null(line ->> 'line_note')
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
      insert into public.so_line_allocations (
        so_line_id, item_id, qty, unit_price, ext_price, alloc_no, operator_id
      ) values (
        v_line,
        (alloc ->> 'item_id')::uuid,
        v_alloc_qty,
        v_alloc_price,
        case when v_alloc_price is null then null else round(v_alloc_qty * v_alloc_price, 2) end,
        coalesce(nullif(alloc ->> 'alloc_no', '')::integer, v_alloc_n),
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

  perform public.log_so_event(v_id, v_event, v_from, v_status, null, v_operator, v_label);

  return jsonb_build_object('id', v_id, 'status', v_status, 'so_number', v_number);
end;
$$;

comment on function public.write_sales_order(jsonb, text, uuid) is
  'Inserts a draft, or replaces a draft or an approved sales order. An approved order stays approved and keeps so_number. Cancelled, closed, and every other status are rejected. Replaces lines, allocations, and customer notes. Each allocation stores the mapped SKU quantity, unit price, and extension. Mapped quantity does not have to equal the customer quantity. Stores so_lines.line_note. Does not assign so_number.';

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
        qty, unit_price, ext_price, condition, suggested_item_ids, eccn, hts_code, country_of_origin, line_note
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
        v_line.line_note
      )
      returning id into v_new;

      insert into public.so_line_allocations (
        so_line_id, item_id, qty, unit_price, ext_price, alloc_no, operator_id
      ) values (
        v_new,
        v_alloc.item_id,
        v_alloc.qty,
        v_price,
        case when v_price is null then null else round(v_alloc.qty * v_price, 2) end,
        1,
        v_alloc.operator_id
      );
    end loop;

    delete from public.so_lines where id = v_id;
  end loop;
end;
$$;

comment on function public.promote_mapped_sales_lines(uuid) is
  'Draft only. Replaces each customer line that has mapped SKUs with one sales-order line per SKU. Quantity, unit price, and extension come from the allocation. The line note is copied onto each of those lines. A line with no mapping is kept. Does not compare those amounts to the customer PO.';

revoke all on function public.promote_mapped_sales_lines(uuid) from public, anon, authenticated;
grant execute on function public.promote_mapped_sales_lines(uuid) to service_role;

notify pgrst, 'reload schema';
