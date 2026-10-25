-- Pre-ITS eBay order ids and the SO numbers they already used.
-- Deploying does not apply this file.

create table public.ebay_legacy_order_map (
  ebay_order_id text primary key,
  so_number bigint not null,
  sales_record_ref text,
  constraint ebay_legacy_order_map_order_id_check check (ebay_order_id ~ '^[0-9]{2}-[0-9]{4,6}-[0-9]{4,6}$'),
  constraint ebay_legacy_order_map_so_positive check (so_number >= 1),
  constraint ebay_legacy_order_map_record_check check (
    sales_record_ref is null or sales_record_ref ~ '^[0-9]{1,12}$'
  )
);

comment on table public.ebay_legacy_order_map is
  'One eBay order id and the sales-order number from the pre-ITS log map. Uploaded from Admin > Integrations. Not a sales order.';

alter table public.ebay_legacy_order_map enable row level security;

revoke all on table public.ebay_legacy_order_map from public, anon, authenticated;
grant select, insert, update, delete on table public.ebay_legacy_order_map to service_role;

alter table public.ebay_order_seed
  add column assigned integer not null default 0;

alter table public.ebay_order_seed drop constraint ebay_order_seed_counts_check;
alter table public.ebay_order_seed add constraint ebay_order_seed_counts_check check (
  linked >= 0 and skipped >= 0 and conflicts >= 0 and missing >= 0 and assigned >= 0
);

comment on column public.ebay_order_seed.assigned is
  'Open eBay drafts given the SO number from the stored log map. A number already on another sales order is not counted.';

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
    if exists (
      select 1 from public.sales_orders
      where so_number = p_number and id is distinct from p_order
    ) then
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
  'Approves a draft. A product line must be allocated to SKUs that add up to its quantity. Other line kinds need no item, and any allocation they do have must still add up. Assigns so_number under a lock on so_counter. Null uses the lowest free number at or above the counter. A typed number must be unused on a different sales order, so a draft that already holds a legacy number can be approved as that number. The counter never moves backwards, and a number above it moves the counter past that number.';

notify pgrst, 'reload schema';
