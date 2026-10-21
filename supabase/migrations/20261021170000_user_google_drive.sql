-- Refresh tokens for Open in Google Sheets. Each token belongs to one approved
-- app user and is written only by the service role. Not applied: run this in
-- the SQL editor before using that option. CSV and Excel do not need it.

create table public.user_google_drive (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_google_drive_token_present check (char_length(refresh_token) > 0)
);

comment on table public.user_google_drive is
  'Google refresh token for drive.file, so ITS can create a spreadsheet in that person''s Drive. Service role only.';

alter table public.user_google_drive enable row level security;

revoke all on table public.user_google_drive from public, anon, authenticated;
grant all on table public.user_google_drive to service_role;
