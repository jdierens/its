-- Quote response alternatives, line awards, and the draft order those awards create.
-- Alternatives hang off the quote line (the DDS response), not a second quote.
-- An award is the lines that won. Buy creates a draft purchase order. Sell creates
-- a draft sales order. quote_event_id on the order is the link back.
-- A cancelled order releases the quote so another draft can be created.
-- Row level security on the new table, service_role only.
-- Not applied here. Deploying does not run this file.

alter table public.quote_event_lines
  add column award_winner text,
  add column award_qty numeric(12, 2),
  add constraint quote_event_lines_award_pair check (
    (
      award_winner is null
      and award_qty is null
    )
    or (
      award_winner is not null
      and char_length(btrim(award_winner)) > 0
      and char_length(award_winner) <= 120
      and award_qty is not null
      and award_qty > 0
    )
  );

comment on column public.quote_event_lines.award_winner is
  'Who won this line. dds, or the competing bidder name. Null when the line is not awarded.';

comment on column public.quote_event_lines.award_qty is
  'Quantity on the award. May be less than the request. Null when the line is not awarded.';

create table public.quote_event_line_alts (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.quote_event_lines (id) on delete cascade,
  sort_order integer not null default 0,
  item_id uuid references public.items (id) on delete set null,
  part_number text,
  sku text,
  item_name text,
  unit_price numeric(12, 2),
  created_at timestamptz not null default now(),
  constraint quote_event_line_alts_sort_nonnegative check (sort_order >= 0),
  constraint quote_event_line_alts_price_nonnegative check (unit_price is null or unit_price >= 0),
  constraint quote_event_line_alts_part_len check (part_number is null or char_length(part_number) <= 120),
  constraint quote_event_line_alts_sku_len check (sku is null or char_length(sku) <= 80),
  constraint quote_event_line_alts_name_len check (item_name is null or char_length(item_name) <= 300),
  constraint quote_event_line_alts_present check (
    item_id is not null
    or nullif(btrim(coalesce(part_number, '')), '') is not null
    or nullif(btrim(coalesce(sku, '')), '') is not null
    or nullif(btrim(coalesce(item_name, '')), '') is not null
  )
);

comment on table public.quote_event_line_alts is
  'Optional substitute SKUs for one quote line. The line SKU and item stay the primary response. These rows are not copied onto a related quote.';

comment on column public.quote_event_line_alts.item_id is
  'Matched item for this alternative. Null when the alternative is only a part number or SKU.';

comment on column public.quote_event_line_alts.unit_price is
  'Optional unit price for this alternative, in the event currency. Null when the alternative has no price of its own.';

create index quote_event_line_alts_line_idx
  on public.quote_event_line_alts (line_id, sort_order);

alter table public.purchase_orders
  add column quote_event_id uuid references public.quote_events (id) on delete set null;

alter table public.sales_orders
  add column quote_event_id uuid references public.quote_events (id) on delete set null;

comment on column public.purchase_orders.quote_event_id is
  'Quote review this draft was created from. Null on every other purchase order. One non-cancelled order per quote.';

comment on column public.sales_orders.quote_event_id is
  'Quote review this draft was created from. Null on every other sales order. One non-cancelled order per quote.';

create unique index purchase_orders_quote_event_open_uidx
  on public.purchase_orders (quote_event_id)
  where quote_event_id is not null and status <> 'cancelled';

create unique index sales_orders_quote_event_open_uidx
  on public.sales_orders (quote_event_id)
  where quote_event_id is not null and status <> 'cancelled';

alter table public.quote_event_line_alts enable row level security;

revoke all on table public.quote_event_line_alts from public, anon, authenticated;
grant all on table public.quote_event_line_alts to service_role;

notify pgrst, 'reload schema';
