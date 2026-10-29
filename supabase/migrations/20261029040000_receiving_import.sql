-- Import a filled receiving sheet through receive_into_bin.
-- One transaction. A row error, or a failure while posting, leaves the batch unposted.
-- Not applied here. Apply by hand after supabase/migrations/20261027233000_consigned_receive.sql.

create or replace function public.import_receiving_rows(
  p_rows jsonb,
  p_initials text,
  p_dry_run boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_count integer;
  v_results jsonb := '[]'::jsonb;
  v_ready jsonb := '[]'::jsonb;
  v_has_error boolean := false;
  v_seen text[] := '{}';
  v_row jsonb;
  v_unit jsonb;
  v_write jsonb;
  v_sheet_row integer;
  v_sku_text text;
  v_search text;
  v_qty integer;
  v_bin_ref text;
  v_vendor_name text;
  v_vendor_id_text text;
  v_po_text text;
  v_po_id_text text;
  v_project text;
  v_received text;
  v_received_on date;
  v_tag text;
  v_origin text;
  v_origin_qty integer;
  v_comment text;
  v_cleaned boolean;
  v_wiped boolean;
  v_request text;
  v_status text;
  v_reason text;
  v_message text;
  v_item uuid;
  v_hits integer;
  v_inactive integer;
  v_bin public.bins;
  v_on_hand integer;
  v_vendor uuid;
  v_vendor_label text;
  v_po uuid;
  v_po_label text;
  v_po_vendor uuid;
  v_po_status text;
  v_serial text;
  v_coo_text text;
  v_coo text;
  v_units jsonb;
  v_unit_count integer;
  v_row_seen text[];
  v_seen_key text;
  v_check text;
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import rows must be a list.'
      using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_rows);
  if v_count = 0 then
    raise exception 'That file has no data rows.'
      using errcode = '22023';
  end if;
  if v_count > 5000 then
    raise exception 'Import at most 5000 rows at a time.'
      using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_status := 'ok';
    v_reason := '';
    v_message := '';
    v_item := null;
    v_vendor := null;
    v_vendor_label := '';
    v_po := null;
    v_po_label := '';
    v_po_vendor := null;
    v_qty := null;
    v_origin_qty := null;
    v_received_on := null;
    v_cleaned := false;
    v_wiped := false;
    v_units := '[]'::jsonb;
    v_unit_count := 0;
    v_row_seen := '{}';
    v_check := null;
    v_sheet_row := null;

    if jsonb_typeof(v_row) <> 'object' then
      v_status := 'error';
      v_reason := 'Import rows must be a list.';
    end if;

    if v_status = 'ok' then
      if coalesce(v_row ->> 'row', '') !~ '^\d+$' then
        v_status := 'error';
        v_reason := 'That row could not be checked.';
      else
        v_sheet_row := (v_row ->> 'row')::integer;
      end if;
    end if;

    v_sku_text := btrim(coalesce(v_row ->> 'sku', ''));
    v_search := nullif(btrim(coalesce(v_row ->> 'search', '')), '');
    v_bin_ref := upper(btrim(coalesce(v_row ->> 'bin', '')));
    v_vendor_name := btrim(coalesce(v_row ->> 'vendor_name', ''));
    v_vendor_id_text := btrim(coalesce(v_row ->> 'vendor_id', ''));
    v_po_text := btrim(coalesce(v_row ->> 'purchase_order', ''));
    v_po_id_text := btrim(coalesce(v_row ->> 'purchase_order_id', ''));
    v_project := nullif(btrim(coalesce(v_row ->> 'project', '')), '');
    v_received := btrim(coalesce(v_row ->> 'received_on', ''));
    v_tag := nullif(btrim(coalesce(v_row ->> 'incoming_bin', '')), '');
    v_origin := nullif(btrim(coalesce(v_row ->> 'origin', '')), '');
    v_comment := nullif(btrim(coalesce(v_row ->> 'comment', '')), '');
    v_request := nullif(btrim(coalesce(v_row ->> 'client_request_id', '')), '');

    if v_status = 'ok' and coalesce(v_row ->> 'qty', '') !~ '^\d+$' then
      v_status := 'error';
      v_reason := 'Enter a whole number of at least 1.';
    elsif v_status = 'ok' then
      v_qty := (v_row ->> 'qty')::integer;
      if v_qty < 1 or v_qty > 1000000 then
        v_status := 'error';
        v_reason := 'Enter a whole number of at least 1.';
      end if;
    end if;

    if v_status = 'ok' and v_bin_ref !~ '^\d{5}-[BCP]$' then
      v_status := 'error';
      v_reason := 'A bin code is five digits, a hyphen, and B, C, or P.';
    end if;

    if v_status = 'ok' and v_received !~ '^\d{4}-\d{2}-\d{2}$' then
      v_status := 'error';
      v_reason := 'Enter a receiving date.';
    elsif v_status = 'ok' then
      begin
        v_received_on := v_received::date;
        if to_char(v_received_on, 'YYYY-MM-DD') is distinct from v_received
          or extract(year from v_received_on) < 2000
          or extract(year from v_received_on) > 2100 then
          v_status := 'error';
          v_reason := 'Enter a receiving date.';
        end if;
      exception
        when others then
          v_status := 'error';
          v_reason := 'Enter a receiving date.';
      end;
    end if;

    if v_status = 'ok' and nullif(v_row ->> 'origin_qty', '') is not null then
      if (v_row ->> 'origin_qty') !~ '^\d+$' then
        v_status := 'error';
        v_reason := 'Originating system qty is a whole number from 0 to 1000000.';
      else
        v_origin_qty := (v_row ->> 'origin_qty')::integer;
        if v_origin_qty > 1000000 then
          v_status := 'error';
          v_reason := 'Originating system qty is a whole number from 0 to 1000000.';
        end if;
      end if;
    end if;

    if v_status = 'ok' and v_row ? 'cleaned' and jsonb_typeof(v_row -> 'cleaned') is distinct from 'boolean' and jsonb_typeof(v_row -> 'cleaned') is distinct from 'null' then
      v_status := 'error';
      v_reason := 'Cleaned is yes or no.';
    elsif v_status = 'ok' and jsonb_typeof(v_row -> 'cleaned') = 'boolean' then
      v_cleaned := (v_row ->> 'cleaned')::boolean;
    end if;

    if v_status = 'ok' and v_row ? 'wiped' and jsonb_typeof(v_row -> 'wiped') is distinct from 'boolean' and jsonb_typeof(v_row -> 'wiped') is distinct from 'null' then
      v_status := 'error';
      v_reason := 'Wiped is yes or no.';
    elsif v_status = 'ok' and jsonb_typeof(v_row -> 'wiped') = 'boolean' then
      v_wiped := (v_row ->> 'wiped')::boolean;
    end if;

    if v_status = 'ok' and v_comment is not null and char_length(v_comment) > 500 then
      v_status := 'error';
      v_reason := 'Comment must be 500 characters or fewer.';
    end if;
    if v_status = 'ok' and v_origin is not null and char_length(v_origin) > 500 then
      v_status := 'error';
      v_reason := 'Originating system must be 500 characters or fewer.';
    end if;
    if v_status = 'ok' and v_project is not null and char_length(v_project) > 120 then
      v_status := 'error';
      v_reason := 'Project must be 120 characters or fewer.';
    end if;
    if v_status = 'ok' and v_tag is not null and char_length(v_tag) > 120 then
      v_status := 'error';
      v_reason := 'Incoming bin must be 120 characters or fewer.';
    end if;
    if v_status = 'ok' and v_search is not null and char_length(v_search) > 500 then
      v_status := 'error';
      v_reason := 'The search must be 500 characters or fewer.';
    end if;
    if v_status = 'ok' and v_request is not null and char_length(v_request) > 80 then
      v_status := 'error';
      v_reason := 'Request id must be 80 characters or fewer.';
    end if;
    if v_status = 'ok' and v_sku_text = '' and v_search is null then
      v_status := 'error';
      v_reason := 'Enter a SKU or a search.';
    end if;

    if v_status = 'ok' and v_sku_text <> '' then
      select count(*)::integer into v_hits
      from public.items
      where lower(btrim(sku)) = lower(v_sku_text);
      if v_hits = 0 then
        v_status := 'error';
        v_reason := format('No item with SKU %s.', v_sku_text);
      elsif v_hits > 1 then
        v_status := 'error';
        v_reason := format('More than one item uses SKU %s.', v_sku_text);
      else
        select id into v_item
        from public.items
        where lower(btrim(sku)) = lower(v_sku_text);
      end if;
    end if;

    if v_status = 'ok' and v_po_id_text <> '' then
      if v_po_id_text !~* v_uuid_pattern then
        v_status := 'error';
        v_reason := 'Choose a purchase order.';
      else
        select id, number, vendor_id, status
          into v_po, v_po_label, v_po_vendor, v_po_status
        from public.purchase_orders
        where id = v_po_id_text::uuid;
        if not found then
          v_status := 'error';
          v_reason := 'Choose a purchase order.';
        end if;
      end if;
    elsif v_status = 'ok' and v_po_text <> '' then
      select id, number, vendor_id, status
        into v_po, v_po_label, v_po_vendor, v_po_status
      from public.purchase_orders
      where number = v_po_text;
      if not found then
        select count(*)::integer into v_hits
        from public.purchase_orders
        where lower(number) = lower(v_po_text);
        if v_hits = 1 then
          select id, number, vendor_id, status
            into v_po, v_po_label, v_po_vendor, v_po_status
          from public.purchase_orders
          where lower(number) = lower(v_po_text);
        else
          v_status := 'error';
          if v_hits = 0 then
            v_reason := format('No purchase order is numbered %s.', v_po_text);
          else
            v_reason := format('More than one purchase order is numbered %s.', v_po_text);
          end if;
        end if;
      end if;
    end if;

    if v_status = 'ok' and v_po is not null and v_po_status = 'cancelled' then
      v_status := 'error';
      v_reason := 'That purchase order is cancelled.';
    end if;

    if v_status = 'ok' and v_po is not null and v_vendor_name <> '' then
      select count(*)::integer into v_hits
      from public.vendors
      where lower(btrim(display_name)) = lower(v_vendor_name)
        and id = v_po_vendor;
      if v_hits = 0 then
        v_status := 'error';
        v_reason := 'That vendor is not on this purchase order.';
      end if;
    end if;

    if v_status = 'ok' and v_po is not null then
      v_vendor := v_po_vendor;
      select display_name into v_vendor_label
      from public.vendors
      where id = v_po_vendor;
    elsif v_status = 'ok' and v_vendor_id_text <> '' then
      if v_vendor_id_text !~* v_uuid_pattern then
        v_status := 'error';
        v_reason := 'Choose a vendor.';
      else
        select id, display_name into v_vendor, v_vendor_label
        from public.vendors
        where id = v_vendor_id_text::uuid;
        if not found then
          v_status := 'error';
          v_reason := 'Choose a vendor.';
        end if;
      end if;
    elsif v_status = 'ok' and v_vendor_name <> '' then
      select count(*)::integer into v_hits
      from public.vendors
      where active
        and lower(btrim(display_name)) = lower(v_vendor_name);
      if v_hits = 1 then
        select id, display_name into v_vendor, v_vendor_label
        from public.vendors
        where active
          and lower(btrim(display_name)) = lower(v_vendor_name);
      elsif v_hits > 1 then
        v_status := 'error';
        v_reason := format('More than one vendor is named %s.', v_vendor_name);
      else
        select count(*)::integer into v_inactive
        from public.vendors
        where not active
          and lower(btrim(display_name)) = lower(v_vendor_name);
        v_status := 'error';
        if v_inactive > 0 then
          v_reason := 'That vendor is not active.';
        else
          v_reason := format('No vendor is named %s.', v_vendor_name);
        end if;
      end if;
    elsif v_status = 'ok' then
      v_status := 'error';
      v_reason := 'Choose a vendor. A receipt without a purchase order is consigned.';
    end if;

    if v_status = 'ok' then
      select * into v_bin
      from public.bins
      where reference = v_bin_ref;
      if not found then
        v_status := 'error';
        v_reason := 'No bin with that code.';
      else
        select coalesce(sum(qty), 0) into v_on_hand
        from public.bin_contents
        where bin_id = v_bin.id;
        if v_on_hand > 0 and not exists (
          select 1
          from public.bin_cycles
          where bin_id = v_bin.id
            and status = 'open'
        ) then
          v_status := 'error';
          v_reason := 'This bin has quantity and no open cycle.';
        end if;
      end if;
    end if;

    if v_status = 'ok' and v_row -> 'units' is not null and jsonb_typeof(v_row -> 'units') = 'array' then
      for v_unit in select value from jsonb_array_elements(v_row -> 'units')
      loop
        exit when v_status = 'error';
        if jsonb_typeof(v_unit) <> 'object' then
          v_status := 'error';
          v_reason := 'Serials must be a list.';
          exit;
        end if;
        v_serial := btrim(coalesce(v_unit ->> 'serial', ''));
        v_coo_text := btrim(coalesce(v_unit ->> 'coo', ''));
        if v_serial = '' and v_coo_text = '' then
          continue;
        end if;
        if v_item is null then
          v_status := 'error';
          v_reason := 'Choose an item before entering serials.';
          exit;
        end if;
        if v_serial <> '' then
          if char_length(v_serial) > 80 then
            v_status := 'error';
            v_reason := 'A serial is at most 80 characters.';
            exit;
          end if;
          if upper(v_serial) = upper(v_sku_text) then
            v_status := 'error';
            v_reason := 'That scan is the SKU, not a serial.';
            exit;
          end if;
          if v_serial ~ '^\d{1,5}-[A-Za-z]$' then
            v_status := 'error';
            v_reason := 'That scan is a bin code, not a serial.';
            exit;
          end if;
          if lower(v_serial) = any (v_row_seen) then
            v_status := 'error';
            v_reason := 'That serial is already in this receipt.';
            exit;
          end if;
          v_seen_key := v_item::text || chr(31) || lower(v_serial);
          if v_seen_key = any (v_seen) then
            v_status := 'error';
            v_reason := 'That serial is already in this import.';
            exit;
          end if;
          if exists (
            select 1
            from public.stock_units
            where item_id = v_item
              and serial_number is not null
              and lower(btrim(serial_number)) = lower(v_serial)
          ) or exists (
            select 1
            from public.so_units
            where item_id = v_item
              and lower(btrim(serial_number)) = lower(v_serial)
          ) then
            v_status := 'error';
            v_reason := 'That serial is already recorded for this item.';
            exit;
          end if;
        end if;
        v_coo := null;
        if v_coo_text <> '' then
          if v_coo_text !~ '^[A-Za-z]{2,3}$' then
            v_status := 'error';
            v_reason := 'Use a 2- or 3-letter country code.';
            exit;
          end if;
          begin
            v_coo := public.normalize_country(v_coo_text);
          exception
            when others then
              v_status := 'error';
              v_reason := 'Choose a country of origin.';
          end;
        end if;
        if v_status = 'error' then
          exit;
        end if;
        if v_serial <> '' then
          v_row_seen := v_row_seen || lower(v_serial);
          v_seen := v_seen || v_seen_key;
        end if;
        v_units := v_units || jsonb_build_array(jsonb_build_object(
          'serial', nullif(v_serial, ''),
          'coo', v_coo
        ));
        v_unit_count := v_unit_count + 1;
      end loop;
    end if;

    if v_status = 'ok' and v_unit_count > v_qty then
      v_status := 'error';
      v_reason := 'Enter at most one serial for each piece.';
    end if;
    if v_status = 'ok' and v_unit_count > 2000 then
      v_status := 'error';
      v_reason := 'Enter at most 2000 serials on one receipt.';
    end if;

    if v_status = 'ok' then
      if v_po is null then
        v_message := format('Consigned to %s.', coalesce(v_vendor_label, v_vendor_name));
      else
        v_message := format('PO %s. Vendor %s.', v_po_label, coalesce(v_vendor_label, ''));
      end if;
      if v_item is null then
        v_message := v_message || ' Pending item. Stock is not posted until an item is linked.';
      else
        v_check := public.item_receive_check(v_item);
        if v_check = 'cleaned' then
          v_message := v_message || case when v_cleaned then ' Cleaned.' else ' Cleaned left unchecked.' end;
        elsif v_check = 'wiped' then
          v_message := v_message || case when v_wiped then ' Wiped.' else ' Wiped left unchecked.' end;
        else
          if v_cleaned then
            v_message := v_message || ' Cleaned is not stored. This item is not a CPU.';
          end if;
          if v_wiped then
            v_message := v_message || ' Wiped is not stored. This item is not an SSD or HDD.';
          end if;
        end if;
      end if;
      if v_unit_count > 0 then
        v_message := v_message || format(' %s stock %s.', v_unit_count, case when v_unit_count = 1 then 'unit' else 'units' end);
      end if;
      if v_request is null then
        v_request := 'recv-import-' || gen_random_uuid()::text;
      end if;
      v_ready := v_ready || jsonb_build_array(jsonb_build_object(
        'reference', v_bin_ref,
        'item_id', v_item,
        'qty', v_qty,
        'comment', v_comment,
        'project', v_project,
        'origin', v_origin,
        'incoming_bin', v_tag,
        'received_on', to_char(v_received_on, 'YYYY-MM-DD'),
        'origin_qty', v_origin_qty,
        'search', v_search,
        'cleaned', case when v_item is null then null else v_cleaned end,
        'wiped', case when v_item is null then null else v_wiped end,
        'units', case when v_unit_count = 0 then null else v_units end,
        'vendor_id', v_vendor,
        'purchase_order_id', v_po,
        'client_request_id', v_request
      ));
    end if;

    if v_status = 'error' then
      v_has_error := true;
      v_message := v_reason;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'row', v_sheet_row,
      'sku', nullif(v_sku_text, ''),
      'search', v_search,
      'qty', v_qty,
      'bin', nullif(v_bin_ref, ''),
      'vendor', nullif(coalesce(nullif(v_vendor_label, ''), v_vendor_name), ''),
      'purchase_order', nullif(coalesce(nullif(v_po_label, ''), v_po_text), ''),
      'status', v_status,
      'message', nullif(btrim(v_message), '')
    ));
  end loop;

  if coalesce(p_dry_run, false) or v_has_error then
    return jsonb_build_object('committed', false, 'rows', v_results);
  end if;

  -- A raise from receive_into_bin aborts this transaction, so an earlier row in the batch is not kept.
  for v_write in select value from jsonb_array_elements(v_ready)
  loop
    perform public.receive_into_bin(
      p_reference => v_write ->> 'reference',
      p_item_id => nullif(v_write ->> 'item_id', '')::uuid,
      p_qty => (v_write ->> 'qty')::integer,
      p_initials => v_initials,
      p_comment => v_write ->> 'comment',
      p_project => v_write ->> 'project',
      p_origin => v_write ->> 'origin',
      p_incoming_tag => v_write ->> 'incoming_bin',
      p_received_on => (v_write ->> 'received_on')::date,
      p_origin_qty => nullif(v_write ->> 'origin_qty', '')::integer,
      p_client_request_id => v_write ->> 'client_request_id',
      p_scan_raw => null,
      p_cleaned => case when jsonb_typeof(v_write -> 'cleaned') = 'boolean' then (v_write ->> 'cleaned')::boolean else null end,
      p_wiped => case when jsonb_typeof(v_write -> 'wiped') = 'boolean' then (v_write ->> 'wiped')::boolean else null end,
      p_search_query => v_write ->> 'search',
      p_units => case when jsonb_typeof(v_write -> 'units') = 'array' then v_write -> 'units' else null end,
      p_vendor_id => nullif(v_write ->> 'vendor_id', '')::uuid,
      p_purchase_order_id => nullif(v_write ->> 'purchase_order_id', '')::uuid
    );
  end loop;

  return jsonb_build_object('committed', true, 'rows', v_results);
end;
$$;

comment on function public.import_receiving_rows(jsonb, text, boolean) is
  'Previews or posts a receiving sheet. Each OK row calls receive_into_bin. A receipt with no purchase order is consigned to its vendor. Dry run and any row error write nothing. A failure while posting rolls the batch back.';

revoke all on function public.import_receiving_rows(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.import_receiving_rows(jsonb, text, boolean) to service_role;

notify pgrst, 'reload schema';
