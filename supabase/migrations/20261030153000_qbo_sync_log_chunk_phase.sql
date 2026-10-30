-- One qbo_sync_log row per customer or vendor sync chunk.
-- phase is in_flight while that request is reading QuickBooks, then completed
-- on the same row. Apply by hand. Deploying does not run this file.
-- Adds a column and widens a check. Grants and row level security stay as they are.

alter table public.qbo_sync_log
  add column phase text not null default 'completed';

alter table public.qbo_sync_log
  drop constraint qbo_sync_log_status_known;

alter table public.qbo_sync_log
  add constraint qbo_sync_log_status_known
  check (status in ('in_flight', 'ok', 'error'));

alter table public.qbo_sync_log
  add constraint qbo_sync_log_phase_known
  check (phase in ('in_flight', 'completed'));

alter table public.qbo_sync_log
  add constraint qbo_sync_log_in_flight_open
  check (
    (phase = 'in_flight' and status = 'in_flight' and finished_at is null)
    or (phase = 'completed' and status in ('ok', 'error'))
  );

comment on column public.qbo_sync_log.phase is
  'in_flight while a sync chunk is running. The same row becomes completed when that chunk finishes.';

comment on column public.qbo_sync_log.status is
  'in_flight while phase is in_flight. ok or error once the same row is completed.';

comment on table public.qbo_sync_log is
  'Sync and OAuth outcomes. A customer or vendor pull chunk is one row: phase in_flight, then that same row completed. Messages must not include tokens or full QuickBooks payloads.';

notify pgrst, 'reload schema';
