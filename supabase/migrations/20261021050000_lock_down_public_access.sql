-- Lock the public schema so the anon and authenticated roles cannot read or
-- write it. Apply this only after the app that uses the service role on the
-- server is deployed. Applying it first stops the current browser app.
--
-- No policies are added for anon or authenticated. The service role bypasses
-- row level security and keeps its grants. From 2026-10-30, new public
-- tables, views, and sequences also need an explicit grant in the migration
-- that creates them. See docs/database.md.

do $lock$
declare
  table_name text;
  fn record;
begin
  foreach table_name in array array[
    'app_settings',
    'app_users',
    'attribute_values',
    'attributes',
    'bin_counter',
    'bin_events',
    'bins',
    'countries',
    'customers',
    'ebay_connection',
    'ebay_sync_log',
    'item_attributes',
    'item_images',
    'item_taxonomy_changes',
    'item_transactions',
    'items',
    'manufacturer_aliases',
    'manufacturers',
    'price_quotes',
    'qbo_connection',
    'qbo_sync_cursor',
    'qbo_sync_log',
    'sku_counter',
    'taxonomies',
    'taxonomy_attributes',
    'units',
    'vendors'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;

  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated',
      fn.name,
      fn.args
    );
    execute format(
      'grant execute on function public.%I(%s) to service_role',
      fn.name,
      fn.args
    );
  end loop;
end
$lock$;

revoke all on all sequences in schema public from public, anon, authenticated;
grant all on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

do $defaults$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from public, anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from public, anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from public, anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public grant all on tables to service_role';
  execute 'alter default privileges for role supabase_admin in schema public grant all on sequences to service_role';
  execute 'alter default privileges for role supabase_admin in schema public grant execute on functions to service_role';
exception
  when insufficient_privilege then
    raise notice 'postgres cannot change supabase_admin default privileges; migrations run as postgres are still covered';
end
$defaults$;

drop policy if exists item_images_insert on storage.objects;
drop policy if exists item_images_delete on storage.objects;
drop policy if exists item_images_read on storage.objects;
revoke all on table storage.objects from anon, authenticated;
revoke all on table storage.buckets from anon, authenticated;
grant all on table storage.objects to service_role;
grant all on table storage.buckets to service_role;

notify pgrst, 'reload schema';
