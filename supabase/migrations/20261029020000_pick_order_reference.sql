-- The picking list and pick ticket show the sales order list's order reference.
-- That choice stays in salesOrderListReference: ebay_order_id when set, otherwise
-- customer_po. This adds ebay_order_id to the two pick payloads. Apply by hand.
-- Deploying does not run it.

do $patch$
declare
  v_def text;
  v_next text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'sales_order_pick_sheet'
    and pg_get_function_identity_arguments(p.oid) = 'uuid';

  if v_def is null then
    raise exception 'sales_order_pick_sheet is missing.';
  end if;
  if v_def like '%ebay_order_id%' then
    raise exception 'sales_order_pick_sheet already returns ebay_order_id.';
  end if;

  v_next := replace(
    v_def,
    '''customer_po'', v_order.customer_po,',
    '''customer_po'', v_order.customer_po,' || chr(10) || '    ''ebay_order_id'', v_order.ebay_order_id,'
  );
  if v_next = v_def then
    raise exception 'sales_order_pick_sheet customer_po was not found.';
  end if;
  execute v_next;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'list_pick_queue'
    and pg_get_function_identity_arguments(p.oid) = '';

  if v_def is null then
    raise exception 'list_pick_queue is missing.';
  end if;
  if v_def like '%ebay_order_id%' then
    raise exception 'list_pick_queue already returns ebay_order_id.';
  end if;

  v_next := replace(
    v_def,
    '''customer_po'', o.customer_po,',
    '''customer_po'', o.customer_po,' || chr(10) || '        ''ebay_order_id'', o.ebay_order_id,'
  );
  if v_next = v_def then
    raise exception 'list_pick_queue customer_po was not found.';
  end if;
  execute v_next;
end
$patch$;
