-- A rejected or expired QuickBooks refresh token cannot be repaired in place.
-- needs_reconnect tells the app to stop using the stored tokens and ask for Connect.
-- Row level security on qbo_connection stays enabled with no anon policies.

alter table public.qbo_connection
  add column needs_reconnect boolean not null default false;

comment on column public.qbo_connection.needs_reconnect is
  'True when the refresh token expired or Intuit returned invalid_grant. The user must connect again.';

notify pgrst, 'reload schema';
