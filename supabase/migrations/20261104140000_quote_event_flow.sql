-- Quote reviews: side and direction are separate, and the originator is a real party.
-- Apply by hand after 20261103180000_quote_events.sql. Deploying does not run this file.
--
-- direction was inbound_ask | outbound_ask | inbound_response | outbound_offer.
-- It is now who started the ask: inbound (they did) or outbound (DDS did).
-- side is the goods flow: buy wins as a purchase order, sell wins as a sales order.
-- legacy_direction keeps the previous token. New rows leave it null.
--
-- Fallback for any row that is not one of the three known events, using the old token:
--   inbound_ask       -> inbound sell  (they asked us to bid)
--   outbound_ask      -> outbound buy  (we sent a list for pricing)
--   inbound_response  -> inbound buy   (a priced reply came back)
--   outbound_offer    -> outbound sell (we sent our offer)
-- Outbound rows start as originator DDS. An inbound row with a vendor starts as that vendor.
-- The known events are then set to Jan's canonical types. That step wins over the fallback.
--
-- Canonical rows on fxsbpreasbdalwthyzvk:
--   6991edca BrightStar / Josh Robinson  -> Inbound Sell Request, customer BrightStar Systems LLC
--   4d580f66 Globaltek / Tyler Moore      -> Inbound Sell Request, customer Globaltek Components, LLC (C)
--   859880a7 Mainstream / Joe             -> Inbound Buy Request, vendor already on the row
-- Hong Li is not a customer or a vendor. His market prices were bidder rows on Mainstream.
-- Those prices move onto a new Outbound Sell Request (originator DDS, prospect Hong Li)
-- linked response_to the Mainstream inbound buy. The prices are not deleted.

create table public.quote_prospects (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  contact_name text,
  notes text,
  created_at timestamptz not null default now(),
  constraint quote_prospects_name_present check (char_length(btrim(display_name)) > 0),
  constraint quote_prospects_name_len check (char_length(display_name) <= 200),
  constraint quote_prospects_contact_len check (contact_name is null or char_length(contact_name) <= 200),
  constraint quote_prospects_notes_len check (notes is null or char_length(notes) <= 2000)
);

comment on table public.quote_prospects is
  'A company that can originate a quote before it is a customer. Not a QuickBooks customer. Promote by picking the customer later.';

comment on column public.quote_prospects.display_name is
  'Company or person as the originator list shows it.';

comment on column public.quote_prospects.contact_name is
  'Person at that company. The event contact can still differ.';

create index quote_prospects_name_idx on public.quote_prospects (lower(display_name));

alter table public.quote_prospects enable row level security;
revoke all on table public.quote_prospects from public, anon, authenticated;
grant all on table public.quote_prospects to service_role;

alter table public.quote_events
  add column side text,
  add column originator_kind text,
  add column customer_id uuid references public.customers (id) on delete set null,
  add column prospect_id uuid references public.quote_prospects (id) on delete set null,
  add column legacy_direction text;

comment on column public.quote_events.legacy_direction is
  'Previous direction token: inbound_ask, outbound_ask, inbound_response, or outbound_offer. Null on rows created after the buy/sell split.';

-- Drop the four-way check before the values become inbound or outbound.
alter table public.quote_events drop constraint quote_events_direction_known;

-- One assignment sees the old direction on every column.
update public.quote_events
set
  legacy_direction = direction,
  side = case direction
    when 'outbound_ask' then 'buy'
    when 'inbound_response' then 'buy'
    when 'outbound_offer' then 'sell'
    else 'sell'
  end,
  direction = case
    when direction in ('outbound_ask', 'outbound_offer') then 'outbound'
    else 'inbound'
  end,
  originator_kind = case
    when direction in ('outbound_ask', 'outbound_offer') then 'dds'
    when vendor_id is not null then 'vendor'
    else 'customer'
  end;

do $$
begin
  if exists (select 1 from public.quote_events where id = '6991edca-5fa9-4441-98bd-d73cf18234ed')
     and (select count(*) from public.customers where display_name = 'BrightStar Systems LLC') <> 1 then
    raise exception 'Expected one customer named BrightStar Systems LLC';
  end if;
  if exists (select 1 from public.quote_events where id = '4d580f66-2ce3-4dd9-9ce5-2e9c2a8dc70b')
     and (select count(*) from public.customers where display_name = 'Globaltek Components, LLC (C)') <> 1 then
    raise exception 'Expected one customer named Globaltek Components, LLC (C)';
  end if;
end $$;

-- Inbound sell. BrightStar is the customer. Josh Robinson is the contact. Not a vendor.
update public.quote_events
set
  side = 'sell',
  direction = 'inbound',
  originator_kind = 'customer',
  vendor_id = null,
  prospect_id = null,
  customer_id = (select id from public.customers where display_name = 'BrightStar Systems LLC'),
  counterparty_name = 'Josh Robinson'
where id = '6991edca-5fa9-4441-98bd-d73cf18234ed';

-- Inbound sell. Globaltek is a customer and a vendor. The ask is the customer, so the vendor link is cleared.
update public.quote_events
set
  side = 'sell',
  direction = 'inbound',
  originator_kind = 'customer',
  vendor_id = null,
  prospect_id = null,
  customer_id = (select id from public.customers where display_name = 'Globaltek Components, LLC (C)'),
  counterparty_name = 'Tyler Moore'
where id = '4d580f66-2ce3-4dd9-9ce5-2e9c2a8dc70b';

-- Inbound buy. Mainstream Global stays the vendor. Joe stays the contact.
update public.quote_events
set
  side = 'buy',
  direction = 'inbound',
  originator_kind = 'vendor',
  customer_id = null,
  prospect_id = null
where id = '859880a7-9563-488a-aa01-f0e0d2ad2bd8';

alter table public.quote_events
  alter column side set not null,
  alter column originator_kind set not null,
  alter column side set default 'sell',
  alter column direction set default 'inbound',
  alter column originator_kind set default 'customer';

alter table public.quote_events
  add constraint quote_events_direction_known check (direction in ('inbound', 'outbound')),
  add constraint quote_events_side_known check (side in ('buy', 'sell')),
  add constraint quote_events_originator_kind_known check (
    originator_kind in ('customer', 'vendor', 'dds', 'prospect')
  ),
  add constraint quote_events_legacy_direction_known check (
    legacy_direction is null
    or legacy_direction in ('inbound_ask', 'outbound_ask', 'inbound_response', 'outbound_offer')
  ),
  add constraint quote_events_originator_link check (
    (
      direction = 'inbound'
      and side = 'sell'
      and originator_kind = 'customer'
      and customer_id is not null
      and vendor_id is null
      and prospect_id is null
    )
    or (
      direction = 'inbound'
      and side = 'sell'
      and originator_kind = 'prospect'
      and prospect_id is not null
      and customer_id is null
      and vendor_id is null
    )
    or (
      direction = 'inbound'
      and side = 'buy'
      and originator_kind = 'vendor'
      and vendor_id is not null
      and customer_id is null
      and prospect_id is null
    )
    or (
      direction = 'outbound'
      and originator_kind = 'dds'
      and (
        (
          side = 'sell'
          and vendor_id is null
          and (customer_id is null or prospect_id is null)
        )
        or (
          side = 'buy'
          and customer_id is null
          and prospect_id is null
        )
      )
    )
  );

comment on column public.quote_events.direction is
  'Who started the ask. inbound: someone else. outbound: DDS.';

comment on column public.quote_events.side is
  'Goods flow. buy wins as a purchase order. sell wins as a sales order.';

comment on column public.quote_events.originator_kind is
  'customer, prospect, or vendor when they started it. dds when DDS started it. Outbound sell may also name a customer or prospect. Outbound buy may also name a vendor.';

comment on column public.quote_events.customer_id is
  'Customer who asked, or the customer DDS approached on an outbound sell. Null when the party is a vendor or a prospect.';

comment on column public.quote_events.prospect_id is
  'Company that is not a customer yet. Used for an inbound sell, or as the counterparty on an outbound sell.';

comment on column public.quote_events.vendor_id is
  'Vendor who asked on an inbound buy, or the vendor DDS approached on an outbound buy. Null on a sell.';

comment on column public.quote_events.counterparty_name is
  'Contact at the originator or counterparty. The company comes from the customer, vendor, or prospect.';

create index quote_events_customer_idx on public.quote_events (customer_id);
create index quote_events_prospect_idx on public.quote_events (prospect_id);

alter table public.quote_event_lines
  add column target_price numeric(12, 2),
  add column special_requirements text,
  add column reply_qty numeric(12, 2),
  add column lead_time text,
  add constraint quote_event_lines_target_nonnegative check (target_price is null or target_price >= 0),
  add constraint quote_event_lines_reply_qty_nonnegative check (reply_qty is null or reply_qty >= 0),
  add constraint quote_event_lines_requirements_len check (
    special_requirements is null or char_length(special_requirements) <= 500
  ),
  add constraint quote_event_lines_lead_len check (lead_time is null or char_length(lead_time) <= 120);

-- DDS ext follows the reply quantity when one was entered, otherwise the request quantity.
alter table public.quote_event_lines drop column our_ext;

alter table public.quote_event_lines
  add column our_ext numeric(12, 2) generated always as (
    case
      when coalesce(reply_qty, qty) is null or our_unit_price is null then null
      else round(coalesce(reply_qty, qty) * our_unit_price, 2)
    end
  ) stored;

comment on column public.quote_event_lines.target_price is
  'Optional price on the request. Null when the ask did not name one.';

comment on column public.quote_event_lines.special_requirements is
  'Optional request note for this part: packaging, firmware, date code, and the like.';

comment on column public.quote_event_lines.reply_qty is
  'Quantity on the DDS reply. Null uses the request quantity for DDS ext.';

comment on column public.quote_event_lines.lead_time is
  'DDS lead time. Null means in stock. The page shows In stock when this is empty.';

comment on column public.quote_event_lines.our_ext is
  'Reply quantity, or the request quantity when the reply quantity is null, times our_unit_price, rounded to cents. Null when either input is null. Generated by the database.';

comment on column public.quote_event_lines.qty is
  'Quantity on the request. Null when the list did not give one.';

alter table public.quote_event_bids
  add column sku text,
  add column item_name text,
  add column qty numeric(12, 2),
  add column lead_time text,
  add constraint quote_event_bids_qty_nonnegative check (qty is null or qty >= 0),
  add constraint quote_event_bids_sku_len check (sku is null or char_length(sku) <= 80),
  add constraint quote_event_bids_item_len check (item_name is null or char_length(item_name) <= 300),
  add constraint quote_event_bids_lead_len check (lead_time is null or char_length(lead_time) <= 120);

comment on column public.quote_event_bids.sku is
  'SKU on this bidder''s reply, when it differs from the line. Null uses the line SKU in the bidder detail.';

comment on column public.quote_event_bids.item_name is
  'Item name on this bidder''s reply. Null uses the line name in the bidder detail.';

comment on column public.quote_event_bids.qty is
  'Quantity on this bidder''s reply. Null uses the line quantity in the bidder detail.';

comment on column public.quote_event_bids.lead_time is
  'Bidder lead time. Null means in stock.';

comment on column public.quote_event_bids.note is
  'Special note on this bidder''s reply.';

-- Hong's market prices leave the Mainstream competing bids and become their own outbound sell.
-- Separate statements so the foreign keys see the rows already written in this transaction.
insert into public.quote_prospects (display_name, contact_name, notes)
select
  'Hong Li',
  'Hong Li',
  'Hong Kong market prices from WhatsApp on 2026-11-03. Not a buy price. Not a customer yet.'
where exists (
  select 1 from public.quote_events where id = '859880a7-9563-488a-aa01-f0e0d2ad2bd8'
);

insert into public.quote_events (
  received_on,
  vendor_id,
  customer_id,
  prospect_id,
  counterparty_name,
  channel,
  direction,
  side,
  originator_kind,
  status,
  reference,
  notes,
  currency,
  legacy_direction
)
select
  date '2026-11-03',
  null,
  null,
  prospect.id,
  'Hong Li',
  'whatsapp',
  'outbound',
  'sell',
  'dds',
  'reviewing',
  'Hong Li HK market 2026-11-03',
  'Outbound sell request for Hong Kong market prices on the Mainstream Global list. Related to that inbound buy. Prices are market prices, not a buy price.',
  'USD',
  null
from public.quote_prospects as prospect
where prospect.display_name = 'Hong Li'
  and exists (select 1 from public.quote_events where id = '859880a7-9563-488a-aa01-f0e0d2ad2bd8')
order by prospect.created_at desc
limit 1;

insert into public.quote_event_lines (
  quote_event_id,
  sort_order,
  item_id,
  part_number,
  sku,
  item_name,
  condition,
  qty
)
select
  hong.id,
  src.sort_order,
  src.item_id,
  src.part_number,
  src.sku,
  src.item_name,
  src.condition,
  src.qty
from public.quote_events as hong
join public.quote_event_lines as src
  on src.quote_event_id = '859880a7-9563-488a-aa01-f0e0d2ad2bd8'
where hong.reference = 'Hong Li HK market 2026-11-03'
  and hong.direction = 'outbound'
  and hong.side = 'sell';

insert into public.quote_event_bids (line_id, sort_order, bidder_name, unit_price, note)
select copied.id, 0, 'Hong', src_bid.unit_price, src_bid.note
from public.quote_event_lines as copied
join public.quote_events as hong
  on hong.id = copied.quote_event_id
 and hong.reference = 'Hong Li HK market 2026-11-03'
 and hong.direction = 'outbound'
 and hong.side = 'sell'
join public.quote_event_lines as src
  on src.quote_event_id = '859880a7-9563-488a-aa01-f0e0d2ad2bd8'
 and src.sort_order = copied.sort_order
join public.quote_event_bids as src_bid
  on src_bid.line_id = src.id
 and btrim(src_bid.bidder_name) = 'Hong';

insert into public.quote_event_relations (from_event_id, to_event_id, relation_type, note)
select
  hong.id,
  '859880a7-9563-488a-aa01-f0e0d2ad2bd8',
  'response_to',
  'Hong Kong market prices for this list. Not a buy price.'
from public.quote_events as hong
where hong.reference = 'Hong Li HK market 2026-11-03'
  and hong.direction = 'outbound'
  and hong.side = 'sell'
  and exists (
    select 1
    from public.quote_event_lines as copied
    where copied.quote_event_id = hong.id
  );

delete from public.quote_event_bids as bid
using public.quote_event_lines as line
where bid.line_id = line.id
  and line.quote_event_id = '859880a7-9563-488a-aa01-f0e0d2ad2bd8'
  and btrim(bid.bidder_name) = 'Hong'
  and exists (
    select 1
    from public.quote_events as hong
    where hong.reference = 'Hong Li HK market 2026-11-03'
      and hong.direction = 'outbound'
      and hong.side = 'sell'
      and hong.originator_kind = 'dds'
  );

do $$
begin
  if exists (select 1 from public.quote_events where id = '6991edca-5fa9-4441-98bd-d73cf18234ed')
     and (select count(*) from public.quote_events where id = '6991edca-5fa9-4441-98bd-d73cf18234ed' and side = 'sell' and direction = 'inbound' and originator_kind = 'customer' and vendor_id is null and customer_id is not null and counterparty_name = 'Josh Robinson') <> 1 then
    raise exception 'BrightStar did not become an inbound sell from a customer';
  end if;
  if exists (select 1 from public.quote_events where id = '4d580f66-2ce3-4dd9-9ce5-2e9c2a8dc70b')
     and (select count(*) from public.quote_events where id = '4d580f66-2ce3-4dd9-9ce5-2e9c2a8dc70b' and side = 'sell' and direction = 'inbound' and originator_kind = 'customer' and vendor_id is null and customer_id is not null and counterparty_name = 'Tyler Moore') <> 1 then
    raise exception 'Globaltek did not become an inbound sell from a customer';
  end if;
  if exists (select 1 from public.quote_events where id = '859880a7-9563-488a-aa01-f0e0d2ad2bd8')
     and (select count(*) from public.quote_events where id = '859880a7-9563-488a-aa01-f0e0d2ad2bd8' and side = 'buy' and direction = 'inbound' and originator_kind = 'vendor' and vendor_id is not null and counterparty_name = 'Joe') <> 1 then
    raise exception 'Mainstream did not become an inbound buy from a vendor';
  end if;
  if exists (select 1 from public.quote_events where id = '859880a7-9563-488a-aa01-f0e0d2ad2bd8') and exists (
    select 1
    from public.quote_event_bids as bid
    join public.quote_event_lines as line on line.id = bid.line_id
    where line.quote_event_id = '859880a7-9563-488a-aa01-f0e0d2ad2bd8'
      and btrim(bid.bidder_name) = 'Hong'
  ) then
    raise exception 'Hong bids are still on the Mainstream inbound buy';
  end if;
  if exists (select 1 from public.quote_events where id = '859880a7-9563-488a-aa01-f0e0d2ad2bd8')
     and not exists (
    select 1
    from public.quote_event_relations as rel
    join public.quote_events as hong on hong.id = rel.from_event_id
    where rel.to_event_id = '859880a7-9563-488a-aa01-f0e0d2ad2bd8'
      and rel.relation_type = 'response_to'
      and hong.reference = 'Hong Li HK market 2026-11-03'
      and hong.side = 'sell'
      and hong.direction = 'outbound'
      and hong.originator_kind = 'dds'
      and hong.prospect_id is not null
      and hong.vendor_id is null
  ) then
    raise exception 'Hong outbound sell is not linked to Mainstream';
  end if;
end $$;

notify pgrst, 'reload schema';
