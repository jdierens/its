-- Column codes and bid-level notes on a quote request.
-- DDS code and note live on the event. Each competing bidder has one row
-- for the whole quote, not one note per line.
-- A code is exactly 3 letters or digits, stored uppercase, or null.
-- An empty note is null. Shorter codes are not stored.
-- The same code on DDS and another bid, or on two bids, is refused when
-- the quote is saved. This file does not add a unique index on the code:
-- the save writes the event and the bidder rows as separate requests, and
-- a swapped pair would fail an index before both new codes were stored.
-- A one-off backfill is not in this file.
-- Not applied here. Deploying does not run this file.

alter table public.quote_events
  add column dds_column_code text,
  add column dds_bid_note text,
  add constraint quote_events_dds_column_code check (
    dds_column_code is null or dds_column_code ~ '^[A-Z0-9]{3}$'
  ),
  add constraint quote_events_dds_bid_note_len check (
    dds_bid_note is null or char_length(dds_bid_note) <= 500
  );

comment on column public.quote_events.dds_column_code is
  'Three-character column heading for the DDS bid. Uppercase letters and digits. Null until one is entered.';

comment on column public.quote_events.dds_bid_note is
  'Note for the DDS bid as a whole. Printed under the quote table. Null when empty. Not a line decision_note.';

create table public.quote_event_bidders (
  id uuid primary key default gen_random_uuid(),
  quote_event_id uuid not null references public.quote_events (id) on delete cascade,
  bidder_name text not null,
  column_code text,
  bid_note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint quote_event_bidders_name_present check (char_length(btrim(bidder_name)) > 0),
  constraint quote_event_bidders_name_len check (char_length(bidder_name) <= 120),
  constraint quote_event_bidders_code check (
    column_code is null or column_code ~ '^[A-Z0-9]{3}$'
  ),
  constraint quote_event_bidders_note_len check (
    bid_note is null or char_length(bid_note) <= 500
  ),
  constraint quote_event_bidders_sort_nonnegative check (sort_order >= 0)
);

comment on table public.quote_event_bidders is
  'One competing bidder on a quote request. The column code and the bid note belong to the bidder, not to a line. Line prices stay on quote_event_bids.';

comment on column public.quote_event_bidders.column_code is
  'Three-character column heading for this bidder. Uppercase letters and digits. Null until one is entered.';

comment on column public.quote_event_bidders.bid_note is
  'Note for this bidder as a whole. Printed under the quote table. Null when empty. Not the line note on quote_event_bids.';

create unique index quote_event_bidders_name_uidx
  on public.quote_event_bidders (quote_event_id, lower(btrim(bidder_name)));

create index quote_event_bidders_event_idx
  on public.quote_event_bidders (quote_event_id, sort_order);

alter table public.quote_event_bidders enable row level security;

revoke all on table public.quote_event_bidders from public, anon, authenticated;
grant all on table public.quote_event_bidders to service_role;

notify pgrst, 'reload schema';
