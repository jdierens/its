-- Won partial: some lines on a quote request were awarded, and some were not.
-- Not applied here. Deploying does not run this file.

alter table public.quote_events drop constraint if exists quote_events_status_known;

alter table public.quote_events
  add constraint quote_events_status_known check (
    status in ('open', 'reviewing', 'bid_sent', 'won', 'won_partial', 'lost', 'passed')
  );

comment on constraint quote_events_status_known on public.quote_events is
  'open, reviewing, bid_sent, won, won_partial, lost, or passed. won_partial means only some lines were awarded.';
