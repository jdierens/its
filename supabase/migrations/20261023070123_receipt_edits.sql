-- Correct a receipt without updating the ledger row.
-- Header fields are stored as an append-only edit. Qty and SKU post a receipt_adjustment
-- that moves bin_contents through adjust_bin_cycle_qty. The bin cannot go below 0.
-- Not applied here. Review and apply by hand after the initials migrations.

alter table public.stock_events
  add column corrects_event_id uuid references public.stock_events (id);

comment on column public.stock_events.corrects_event_id is
  'The receipt a receipt_adjustment corrects. Null on receipts, moves, and imports.';

alter table public.stock_events drop constraint stock_events_type_check;

alter table public.stock_events
  add constraint stock_events_type_check
  check (event_type in (
    'receive_into_bin',
    'move_bin_location',
    'bin_imported',
    'receipt_adjustment'
  ));

alter table public.stock_events
  add constraint stock_events_adjustment_check check (
    event_type <> 'receipt_adjustment'
    or (
      item_id is not null
      and cycle_id is not null
      and qty is not null
      and qty <> 0
      and corrects_event_id is not null
    )
  );

create table public.stock_event_edits (
  id uuid primary key default gen_random_uuid(),
  stock_event_id uuid not null references public.stock_events (id),
  edited_at timestamptz not null default now(),
  editor_initials text not null,
  old_values jsonb not null,
  new_values jsonb not null,
  constraint stock_event_edits_initials_check check (editor_initials ~ '^[A-Z]{2}$')
);

comment on table public.stock_event_edits is
  'Append-only corrections for a receipt. The ledger row is not updated. The latest new_values are what Recent entries shows.';

create index stock_event_edits_event_idx
  on public.stock_event_edits (stock_event_id, edited_at desc, id desc);

create or replace function public.reject_receipt_edit_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Receipt edits cannot be changed.'
    using errcode = '55000';
end;
$$;

create trigger stock_event_edits_append_only
before update or delete on public.stock_event_edits
for each row execute function public.reject_receipt_edit_change();

create or replace function public.post_receipt_adjustment(
  p_event_id uuid,
  p_cycle_id uuid,
  p_bin_id uuid,
  p_item_id uuid,
  p_delta integer,
  p_initials text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_on integer;
begin
  if p_delta is null or p_delta = 0 then
    return;
  end if;

  select qty into v_on
  from public.bin_contents
  where cycle_id = p_cycle_id
    and item_id = p_item_id
  for update;

  if coalesce(v_on, 0) + p_delta < 0 then
    raise exception 'That would take the bin below 0.'
      using errcode = '22023';
  end if;

  perform public.adjust_bin_cycle_qty(p_cycle_id, p_bin_id, p_item_id, p_delta);

  insert into public.stock_events (
    event_type,
    bin_id,
    cycle_id,
    item_id,
    qty,
    operator_initials,
    comment,
    corrects_event_id
  ) values (
    'receipt_adjustment',
    p_bin_id,
    p_cycle_id,
    p_item_id,
    p_delta,
    p_initials,
    'Corrects a receipt',
    p_event_id
  );
end;
$$;

comment on function public.post_receipt_adjustment(uuid, uuid, uuid, uuid, integer, text) is
  'Posts one receipt_adjustment and moves bin_contents by that delta. A result below 0 is rejected before the move.';

create or replace function public.edit_receipt(
  p_event_id uuid,
  p_initials text,
  p_received_on date,
  p_project text,
  p_incoming_tag text,
  p_origin text,
  p_origin_qty integer,
  p_comment text,
  p_qty integer,
  p_item_id uuid,
  p_confirmed boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_initials text := public.operator_initials(p_initials);
  v_event public.stock_events;
  v_latest jsonb;
  v_old_received date;
  v_old_project text;
  v_old_tag text;
  v_old_origin text;
  v_old_origin_qty integer;
  v_old_comment text;
  v_old_qty integer;
  v_old_item uuid;
  v_old_sku text;
  v_old_name text;
  v_project text := public.blank_to_null(p_project);
  v_tag text := public.blank_to_null(p_incoming_tag);
  v_origin text := public.blank_to_null(p_origin);
  v_comment text := public.blank_to_null(p_comment);
  v_sku text;
  v_name text;
  v_old jsonb;
  v_new jsonb;
  v_inventory boolean;
begin
  if v_initials !~ '^[A-Z]{2}$' then
    raise exception 'Operator initials must be 2 letters.'
      using errcode = '22023';
  end if;
  if p_received_on is null
    or extract(year from p_received_on) < 2000
    or extract(year from p_received_on) > 2100 then
    raise exception 'Enter a receiving date.'
      using errcode = '22023';
  end if;
  if p_origin_qty is not null and (p_origin_qty < 0 or p_origin_qty > 1000000) then
    raise exception 'Originating system qty is a whole number from 0 to 1000000.'
      using errcode = '22023';
  end if;
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then
    raise exception 'Enter a whole number from 0 to 1000000.'
      using errcode = '22023';
  end if;
  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'Comment must be 500 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_origin is not null and char_length(v_origin) > 500 then
    raise exception 'Originating system must be 500 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_project is not null and char_length(v_project) > 120 then
    raise exception 'Project must be 120 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_tag is not null and char_length(v_tag) > 120 then
    raise exception 'Incoming bin must be 120 characters or fewer.'
      using errcode = '22023';
  end if;
  if p_item_id is null or not exists (select 1 from public.items where id = p_item_id) then
    raise exception 'Choose an item.'
      using errcode = '22023';
  end if;

  select * into v_event
  from public.stock_events
  where id = p_event_id
    and event_type = 'receive_into_bin'
  for update;

  if not found then
    raise exception 'That receipt is not in the ledger.'
      using errcode = 'P0002';
  end if;

  if v_event.cycle_id is null or v_event.bin_id is null then
    raise exception 'That receipt has no cycle.'
      using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_event.cycle_id::text, 0));

  select new_values into v_latest
  from public.stock_event_edits
  where stock_event_id = p_event_id
  order by edited_at desc, id desc
  limit 1;

  if v_latest is null then
    v_old_received := v_event.received_on;
    v_old_project := v_event.project;
    v_old_tag := v_event.incoming_tag;
    v_old_origin := v_event.origin_description;
    v_old_origin_qty := v_event.origin_qty;
    v_old_comment := v_event.comment;
    v_old_qty := v_event.qty;
    v_old_item := v_event.item_id;
  else
    v_old_received := (v_latest->>'received_on')::date;
    v_old_project := nullif(btrim(v_latest->>'project'), '');
    v_old_tag := nullif(btrim(v_latest->>'incoming_tag'), '');
    v_old_origin := nullif(btrim(v_latest->>'origin_description'), '');
    v_old_origin_qty := (v_latest->>'origin_qty')::integer;
    v_old_comment := nullif(btrim(v_latest->>'comment'), '');
    v_old_qty := (v_latest->>'qty')::integer;
    v_old_item := (v_latest->>'item_id')::uuid;
  end if;

  select nullif(btrim(sku), ''), nullif(btrim(name), '')
  into v_old_sku, v_old_name
  from public.items
  where id = v_old_item;

  select nullif(btrim(sku), ''), nullif(btrim(name), '')
  into v_sku, v_name
  from public.items
  where id = p_item_id;

  v_old := jsonb_build_object(
    'received_on', to_char(v_old_received, 'YYYY-MM-DD'),
    'project', v_old_project,
    'incoming_tag', v_old_tag,
    'origin_description', v_old_origin,
    'origin_qty', v_old_origin_qty,
    'comment', v_old_comment,
    'qty', v_old_qty,
    'item_id', v_old_item,
    'sku', v_old_sku,
    'item_name', v_old_name
  );
  v_new := jsonb_build_object(
    'received_on', to_char(p_received_on, 'YYYY-MM-DD'),
    'project', v_project,
    'incoming_tag', v_tag,
    'origin_description', v_origin,
    'origin_qty', p_origin_qty,
    'comment', v_comment,
    'qty', p_qty,
    'item_id', p_item_id,
    'sku', v_sku,
    'item_name', v_name
  );

  if v_old = v_new then
    return jsonb_build_object('edited', v_latest is not null, 'values', v_new);
  end if;

  v_inventory := p_qty is distinct from v_old_qty or p_item_id is distinct from v_old_item;
  if v_inventory and p_confirmed is not true then
    raise exception 'Confirm the quantity or SKU change.'
      using errcode = '22023';
  end if;

  if v_inventory then
    if p_item_id is distinct from v_old_item then
      perform public.post_receipt_adjustment(
        p_event_id, v_event.cycle_id, v_event.bin_id, v_old_item, -v_old_qty, v_initials
      );
      perform public.post_receipt_adjustment(
        p_event_id, v_event.cycle_id, v_event.bin_id, p_item_id, p_qty, v_initials
      );
    else
      perform public.post_receipt_adjustment(
        p_event_id, v_event.cycle_id, v_event.bin_id, p_item_id, p_qty - v_old_qty, v_initials
      );
    end if;

    if exists (
      select 1 from public.bin_contents where cycle_id = v_event.cycle_id
    ) then
      update public.bin_cycles
      set status = 'open',
          closed_at = null
      where id = v_event.cycle_id
        and status <> 'open';
    end if;
  end if;

  insert into public.stock_event_edits (
    stock_event_id,
    editor_initials,
    old_values,
    new_values
  ) values (
    p_event_id,
    v_initials,
    v_old,
    v_new
  );

  return jsonb_build_object('edited', true, 'values', v_new);
end;
$$;

comment on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean) is
  'Records a receipt correction. Header fields stay off the ledger row. A qty or SKU change posts a receipt_adjustment after confirmation and will not take the bin below 0. Initials must be two letters.';

create view public.receipt_lines
with (security_invoker = true) as
select
  e.id,
  e.occurred_at,
  e.operator_initials,
  case
    when ed.new_values is null then e.received_on
    else (ed.new_values->>'received_on')::date
  end as received_on,
  case
    when ed.new_values is null then e.project
    else nullif(btrim(ed.new_values->>'project'), '')
  end as project,
  case
    when ed.new_values is null then e.incoming_tag
    else nullif(btrim(ed.new_values->>'incoming_tag'), '')
  end as incoming_tag,
  case
    when ed.new_values is null then e.origin_description
    else nullif(btrim(ed.new_values->>'origin_description'), '')
  end as origin_description,
  case
    when ed.new_values is null then e.origin_qty
    else (ed.new_values->>'origin_qty')::integer
  end as origin_qty,
  case
    when ed.new_values is null then e.comment
    else nullif(btrim(ed.new_values->>'comment'), '')
  end as comment,
  case
    when ed.new_values is null then e.qty
    else (ed.new_values->>'qty')::integer
  end as qty,
  case
    when ed.new_values is null then e.item_id
    else (ed.new_values->>'item_id')::uuid
  end as item_id,
  coalesce(nullif(btrim(ed.new_values->>'sku'), ''), i.sku) as sku,
  coalesce(nullif(btrim(ed.new_values->>'item_name'), ''), i.name, '') as item_name,
  (ed.id is not null) as edited,
  ed.editor_initials
from public.stock_events e
left join lateral (
  select id, new_values, editor_initials
  from public.stock_event_edits
  where stock_event_id = e.id
  order by edited_at desc, id desc
  limit 1
) ed on true
left join public.items i
  on i.id = case
    when ed.new_values is null then e.item_id
    else (ed.new_values->>'item_id')::uuid
  end
where e.event_type = 'receive_into_bin';

comment on view public.receipt_lines is
  'Recent receipts with the latest correction applied. The ledger row is unchanged.';

alter table public.stock_event_edits enable row level security;

revoke all on table public.stock_event_edits from public, anon, authenticated;
grant select, insert on table public.stock_event_edits to service_role;

revoke all on table public.receipt_lines from public, anon, authenticated;
grant select on table public.receipt_lines to service_role;

revoke all on function public.reject_receipt_edit_change() from public, anon, authenticated;
revoke all on function public.post_receipt_adjustment(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean) from public, anon, authenticated;

grant execute on function public.reject_receipt_edit_change() to service_role;
grant execute on function public.post_receipt_adjustment(uuid, uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.edit_receipt(uuid, text, date, text, text, text, integer, text, integer, uuid, boolean) to service_role;

notify pgrst, 'reload schema';
