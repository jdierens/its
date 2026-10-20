-- Remembers where an unfinished QuickBooks list pull stopped.
-- Applied on fxsbpreasbdalwthyzvk as version 20261020055503.
-- Adds columns only. Row level security and grants on qbo_sync_cursor stay as they are.

alter table public.qbo_sync_cursor
  add column start_position integer,
  add column query_total integer,
  add column resume_since timestamptz,
  add column pull_started_at timestamptz,
  add column pull_counts jsonb;

alter table public.qbo_sync_cursor
  add constraint qbo_sync_cursor_start_position_positive
  check (start_position is null or start_position >= 1);

alter table public.qbo_sync_cursor
  add constraint qbo_sync_cursor_query_total_nonnegative
  check (query_total is null or query_total >= 0);

comment on column public.qbo_sync_cursor.start_position is
  'Next 1-based QuickBooks query position for an unfinished list pull, ordered by Id. Null when no list pull is in progress.';

comment on column public.qbo_sync_cursor.query_total is
  'QuickBooks count for the list pull in progress.';

comment on column public.qbo_sync_cursor.resume_since is
  'Change time used to continue an unfinished CDC pull. Null when CDC is not in progress.';

comment on column public.qbo_sync_cursor.pull_started_at is
  'When the unfinished pull started. Becomes cdc_since once the pull finishes.';

comment on column public.qbo_sync_cursor.pull_counts is
  'Created, updated, conflict, and error totals for the pull in progress.';
