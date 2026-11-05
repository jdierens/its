-- Bidder class on a quote request.
-- cmp, mkt, and fsp are price references stored the same way: one bidder row
-- (column code and bid note) and one unit price per line on quote_event_bids.
-- DDS stays on the event (dds_column_code, dds_bid_note, our_unit_price).
-- An existing fsp_unit is copied onto one FSP bidder so the forecast is not
-- dropped. The bidder name is Forecast when that name is free. fsp_unit is
-- then cleared. fsp_unit and fsp_ext stay on the line. The app does not read
-- or write them.
-- Not applied here. Deploying does not run this file.

alter table public.quote_event_bidders
  add column bidder_class text not null default 'cmp',
  add constraint quote_event_bidders_class_known check (bidder_class in ('cmp', 'mkt', 'fsp'));

comment on column public.quote_event_bidders.bidder_class is
  'cmp competitive bidder, mkt market estimate, or fsp forecasted sales price. Each class has a column code, a bid note, and a unit price per line. DDS is not a row here.';

insert into public.quote_event_bidders (quote_event_id, bidder_name, bidder_class, sort_order)
select
  event.id,
  case
    when not exists (
      select 1
      from public.quote_event_bidders existing
      where existing.quote_event_id = event.id
        and lower(btrim(existing.bidder_name)) = 'forecast'
    ) and not exists (
      select 1
      from public.quote_event_lines line
      join public.quote_event_bids bid on bid.line_id = line.id
      where line.quote_event_id = event.id
        and lower(btrim(bid.bidder_name)) = 'forecast'
    ) then 'Forecast'
    when not exists (
      select 1
      from public.quote_event_bidders existing
      where existing.quote_event_id = event.id
        and lower(btrim(existing.bidder_name)) = 'forecasted sales price'
    ) and not exists (
      select 1
      from public.quote_event_lines line
      join public.quote_event_bids bid on bid.line_id = line.id
      where line.quote_event_id = event.id
        and lower(btrim(bid.bidder_name)) = 'forecasted sales price'
    ) then 'Forecasted sales price'
    else 'Forecast ' || substr(replace(event.id::text, '-', ''), 1, 8)
  end,
  'fsp',
  coalesce((
    select max(existing.sort_order) + 1
    from public.quote_event_bidders existing
    where existing.quote_event_id = event.id
  ), 0)
from public.quote_events event
where exists (
  select 1
  from public.quote_event_lines line
  where line.quote_event_id = event.id
    and line.fsp_unit is not null
)
and not exists (
  select 1
  from public.quote_event_bidders existing
  where existing.quote_event_id = event.id
    and existing.bidder_class = 'fsp'
);

insert into public.quote_event_bids (line_id, sort_order, bidder_name, unit_price)
select
  line.id,
  coalesce((
    select max(bid.sort_order) + 1
    from public.quote_event_bids bid
    where bid.line_id = line.id
  ), 0),
  bidder.bidder_name,
  line.fsp_unit
from public.quote_event_lines line
join public.quote_event_bidders bidder
  on bidder.quote_event_id = line.quote_event_id
 and bidder.bidder_class = 'fsp'
where line.fsp_unit is not null
  and not exists (
    select 1
    from public.quote_event_bids bid
    where bid.line_id = line.id
      and lower(btrim(bid.bidder_name)) = lower(btrim(bidder.bidder_name))
  );

update public.quote_event_lines
set fsp_unit = null
where fsp_unit is not null;

comment on column public.quote_event_lines.fsp_unit is
  'Unused. Forecasted sales price is a bidder of class fsp. Cleared when that bidder was created. The app does not read or write this column.';

comment on column public.quote_event_lines.fsp_ext is
  'Unused generated extension of fsp_unit. Null once fsp_unit is cleared. The app does not read it.';

notify pgrst, 'reload schema';
