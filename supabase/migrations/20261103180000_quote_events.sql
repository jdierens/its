-- Quote reviews: one event for a whole vendor or customer list.
-- Lines can name an item or an unmatched part number. Competing bids are
-- rows on the line. Relations are one row per unordered pair of events.
-- from_event_id is the side the relation_type is spoken from.
-- price_quotes.quote_event_line_id is optional and null for existing rows.
-- Row level security on, service_role only. No anon or authenticated grant.
-- Not applied here. Deploying does not run this file.

create table public.quote_events (
  id uuid primary key default gen_random_uuid(),
  received_on date not null default current_date,
  due_on date,
  vendor_id uuid references public.vendors (id) on delete set null,
  counterparty_name text,
  channel text not null default 'other',
  direction text not null default 'inbound_ask',
  status text not null default 'open',
  reference text,
  notes text,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_events_channel_known check (
    channel in ('whatsapp', 'email', 'sheet', 'other')
  ),
  constraint quote_events_direction_known check (
    direction in ('inbound_ask', 'outbound_ask', 'inbound_response', 'outbound_offer')
  ),
  constraint quote_events_status_known check (
    status in ('open', 'reviewing', 'bid_sent', 'won', 'lost', 'passed')
  ),
  constraint quote_events_currency_code check (currency ~ '^[A-Z]{3}$'),
  constraint quote_events_reference_len check (
    reference is null or char_length(reference) <= 200
  ),
  constraint quote_events_counterparty_len check (
    counterparty_name is null or char_length(counterparty_name) <= 200
  )
);

comment on table public.quote_events is
  'One quote list reviewed as a single event. Status is a label, not a lock. Sheet and photo import are not stored here.';

comment on column public.quote_events.received_on is
  'When we received or created the list.';

comment on column public.quote_events.due_on is
  'When a response is due. Null when there is no due date. Saving does not refuse a due date before received_on.';

comment on column public.quote_events.vendor_id is
  'Vendor, when the counterparty is one of ours. Null for a contact who is not a vendor.';

comment on column public.quote_events.counterparty_name is
  'Contact or company as written on the list. Shown with the vendor name when both are set.';

comment on column public.quote_events.channel is
  'How the list arrived: whatsapp, email, sheet, or other.';

comment on column public.quote_events.direction is
  'inbound_ask: they want our bid. outbound_ask: we sent a list for pricing. inbound_response: a priced reply came back. outbound_offer: we sent our offer.';

comment on column public.quote_events.status is
  'open, reviewing, bid_sent, won, lost, or passed. Any of these can be set again. Nothing is locked.';

comment on column public.quote_events.reference is
  'Short name for the list, such as the sender and the company. Not a generated number.';

comment on column public.quote_events.currency is
  'ISO currency for our prices and competing bids on this event. USD when omitted.';

create index quote_events_received_idx
  on public.quote_events (received_on desc, created_at desc);

create index quote_events_status_due_idx
  on public.quote_events (status, due_on);

create index quote_events_vendor_idx
  on public.quote_events (vendor_id);

create table public.quote_event_lines (
  id uuid primary key default gen_random_uuid(),
  quote_event_id uuid not null references public.quote_events (id) on delete cascade,
  sort_order integer not null default 0,
  item_id uuid references public.items (id) on delete set null,
  part_number text,
  part_number_norm text generated always as (
    nullif(regexp_replace(upper(coalesce(part_number, '')), '[[:space:]/-]', '', 'g'), '')
  ) stored,
  sku text,
  item_name text,
  condition text,
  qty numeric(12, 2),
  our_unit_price numeric(12, 2),
  our_ext numeric(12, 2) generated always as (
    case
      when qty is null or our_unit_price is null then null
      else round(qty * our_unit_price, 2)
    end
  ) stored,
  decision text,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_event_lines_sort_nonnegative check (sort_order >= 0),
  constraint quote_event_lines_qty_nonnegative check (qty is null or qty >= 0),
  constraint quote_event_lines_price_nonnegative check (
    our_unit_price is null or our_unit_price >= 0
  ),
  constraint quote_event_lines_decision_known check (
    decision is null or decision in ('bid', 'pass', 'counter')
  )
);

comment on table public.quote_event_lines is
  'One part on a quote event. item_id is null until the part is matched. part_number can stand alone. Our price, the decision, and competing bids are not copied when a related quote is created.';

comment on column public.quote_event_lines.part_number is
  'MPN or part number as written on the list. May be unmatched.';

comment on column public.quote_event_lines.part_number_norm is
  'Generated: part_number uppercased with whitespace, "-" and "/" removed. Same rule as price_quotes.part_number_norm.';

comment on column public.quote_event_lines.sku is
  'SKU as written on the list, or the matched item SKU. Not a foreign key.';

comment on column public.quote_event_lines.item_name is
  'Name as written on the list, or the matched item name.';

comment on column public.quote_event_lines.qty is
  'Quantity on this list. Null when the list did not give one.';

comment on column public.quote_event_lines.our_unit_price is
  'Our unit price in the event currency. Null until we price the line.';

comment on column public.quote_event_lines.our_ext is
  'qty times our_unit_price, rounded to cents. Null when either input is null. Generated by the database.';

comment on column public.quote_event_lines.decision is
  'bid, pass, or counter. Null when the line is not decided.';

create index quote_event_lines_event_idx
  on public.quote_event_lines (quote_event_id, sort_order);

create index quote_event_lines_item_idx
  on public.quote_event_lines (item_id);

create index quote_event_lines_part_idx
  on public.quote_event_lines (part_number_norm);

create table public.quote_event_bids (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.quote_event_lines (id) on delete cascade,
  sort_order integer not null default 0,
  bidder_name text not null,
  unit_price numeric(12, 2),
  note text,
  created_at timestamptz not null default now(),
  constraint quote_event_bids_sort_nonnegative check (sort_order >= 0),
  constraint quote_event_bids_bidder_present check (char_length(btrim(bidder_name)) > 0),
  constraint quote_event_bids_price_nonnegative check (unit_price is null or unit_price >= 0),
  constraint quote_event_bids_bidder_len check (char_length(bidder_name) <= 120)
);

comment on table public.quote_event_bids is
  'A competing unit price on one quote line. The lowest unit price is the best competing price. These rows are not copied onto a related quote.';

comment on column public.quote_event_bids.unit_price is
  'Competing unit price in the event currency. Null when the bidder is known and the price is not.';

create index quote_event_bids_line_idx
  on public.quote_event_bids (line_id, sort_order);

create table public.quote_event_relations (
  id uuid primary key default gen_random_uuid(),
  from_event_id uuid not null references public.quote_events (id) on delete cascade,
  to_event_id uuid not null references public.quote_events (id) on delete cascade,
  relation_type text not null default 'other',
  note text,
  created_at timestamptz not null default now(),
  constraint quote_event_relations_not_self check (from_event_id <> to_event_id),
  constraint quote_event_relations_type_known check (
    relation_type in ('same_list', 'forwarded_for_pricing', 'response_to', 'other')
  ),
  constraint quote_event_relations_note_len check (note is null or char_length(note) <= 500)
);

comment on table public.quote_event_relations is
  'One link for an unordered pair of quote events. from_event_id is the event the relation_type is spoken from: that event is response_to, forwarded_for_pricing, same_list, or other relative to to_event_id. A second row for the same two events, in either direction, is rejected.';

comment on column public.quote_event_relations.from_event_id is
  'The event that is a response to, was forwarded for pricing from, or is the same list as to_event_id.';

comment on column public.quote_event_relations.relation_type is
  'same_list, forwarded_for_pricing, response_to, or other. The type is a label on the pair, stored in the from-to direction the user chose.';

create unique index quote_event_relations_pair_uidx
  on public.quote_event_relations (least(from_event_id, to_event_id), greatest(from_event_id, to_event_id));

create index quote_event_relations_from_idx
  on public.quote_event_relations (from_event_id);

create index quote_event_relations_to_idx
  on public.quote_event_relations (to_event_id);

create or replace function public.quote_events_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

comment on function public.quote_events_touch() is
  'Sets quote_events.updated_at on update.';

create trigger quote_events_touch
  before update on public.quote_events
  for each row
  execute function public.quote_events_touch();

alter table public.price_quotes
  add column quote_event_line_id uuid references public.quote_event_lines (id) on delete set null;

comment on column public.price_quotes.quote_event_line_id is
  'Optional link to the quote-review line this observation came from. Null for market research and for quotes that are not on an event. Deleting the line clears the link and leaves the price quote. Item Pricing does not require it.';

create index price_quotes_quote_event_line_idx
  on public.price_quotes (quote_event_line_id)
  where quote_event_line_id is not null;

alter table public.quote_events enable row level security;
alter table public.quote_event_lines enable row level security;
alter table public.quote_event_bids enable row level security;
alter table public.quote_event_relations enable row level security;

revoke all on table public.quote_events from public, anon, authenticated;
revoke all on table public.quote_event_lines from public, anon, authenticated;
revoke all on table public.quote_event_bids from public, anon, authenticated;
revoke all on table public.quote_event_relations from public, anon, authenticated;

grant all on table public.quote_events to service_role;
grant all on table public.quote_event_lines to service_role;
grant all on table public.quote_event_bids to service_role;
grant all on table public.quote_event_relations to service_role;

revoke all on function public.quote_events_touch() from public, anon, authenticated;
grant execute on function public.quote_events_touch() to service_role;
