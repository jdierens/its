# Database

Migrations live in `supabase/migrations`. Deploying this repo does not apply them. On project `fxsbpreasbdalwthyzvk` they are already applied, except `20261021050000_lock_down_public_access.sql`, which waits until the service-role release is deployed, `20261021170000_user_google_drive.sql`, which waits until Open in Google Sheets is turned on, `20261021210000_label_lookup_trgm.sql`, which only speeds up label name and description search and is not required for that search to work, and `20261022003049_update_item_ignore_quantity.sql`, which must be applied before the item-form release is deployed. On a new database, run them in order in the SQL editor, and run the lockdown migration only after that release is serving. CSV and Excel export do not need the Google token table.

`items.updated_at` is set on each update. Rows that already existed start equal to `created_at`. A visible-columns export includes that time in the Edited column. Adding that column does not change the item save functions the deployed app already calls. `update_item_cell` writes one table cell and refuses the write when `updated_at` no longer matches. The deployed app does not call `update_item_cell`. `items.item_type` is Product, Kit/Package, Service, or Non-inventory. It is required and defaults to Product, so rows that already existed are Product without a separate update. Service and Non-inventory items should not track stock quantity or need labels. Kit/Package may later have components. A later change can map them to QuickBooks Inventory, Group/Bundle, Service, and NonInventory. `create_item` and `update_item` gain one optional item-type argument at the end, replaced in the same migration so PostgREST still sees a single function. Leaving it out creates a Product and leaves an existing item's type unchanged. `units` is the unit pick list, seeded with Piece and Lbs. Add a row to offer another unit. `items.unit` stores that name, is required, defaults to Piece, and references `units.name` so a rename follows the items. Existing items are Piece from that default. `items.oem_name` and `items.oem_part_number` are optional text. The same two functions take those three values as optional arguments after item type. Leaving them out leaves OEM empty on create and does not change a stored OEM or unit on update. An empty string clears OEM. An unknown unit is rejected. A blank required unit becomes Piece. `update_item_cell` edits the three columns. Taxonomy CBL is named Cable. Motherboard (MBD), Heatsink (SNK), and Unsorted (UNS) are sort orders 11, 12, and 13, after Processor at 10. `items.notes` stores free-form notes. `taxonomy_attributes.required` marks a field as required for that taxonomy only. `change_item_taxonomy` moves an item onto another taxonomy, deletes attribute values the new taxonomy does not link, and can append the removed values to notes. `item_taxonomy_changes` records the old and new taxonomy and the removed values. The deployed app does not call that function.

`attribute_values` holds the allowed values. `attributes.uses_list` turns that list on. `taxonomies.long_code` and `taxonomies.short_code` are unique and nullable. A trigger uppercases them, and check constraints keep `long_code` equal to `upper(long_code)` and `short_code` matching `^[A-Z0-9]{3}$`. `taxonomies.sort_order` is the list order. `item_images` points at files in the `item-images` bucket (`<item_id>/<image_id>.<ext>`). `sort_order` is the gallery order, backfilled from `created_at`. The lowest `sort_order` is the primary photo. `is_primary` is still present and a statement trigger keeps it equal to that first photo, so the currently deployed app can keep selecting it. Dropping the column waits until this release is deployed. The bucket is private, with a 10 MB limit and JPEG, PNG, WebP, and GIF only.

A migration that is applied to the live database before its pull request is merged has to keep working with the app that is already deployed. That means adding columns, tables, and functions only. Do not drop or rename columns, and do not leave two overloads of a function PostgREST already calls. An extra optional argument at the end, applied by replacing the function in one migration, stays compatible when omitting it keeps the old behavior. Do not change that behavior until a later migration after the new code is live. `20261021050000_lock_down_public_access.sql` is the exception: it removes anon access, so it is applied only after the release that reads and writes with the service role is deployed. The order is in the section below.

The `item-images` bucket is private, with a 10 MB limit and JPEG, PNG, WebP, and GIF only. The browser uploads and downloads through a signed URL created by the service role. The file bytes do not go through a server action. `20261021050000_lock_down_public_access.sql` drops `item_images_read`, `item_images_insert`, and `item_images_delete` and revokes anon and authenticated access to `storage.objects` and `storage.buckets`. Until that migration is applied, those policies still let the anon key upload and download.

From 2026-10-30, a new table, view, or sequence in `public` does not receive automatic Data API grants. Every migration that creates one must grant in the same migration. Grant `service_role` always. Grant `authenticated` only when a request still uses the signed-in user's session for that object. Grant `anon` only when an anonymous client must call it. This app reads and writes with the service role, so new app tables get `service_role` only. Enable row level security in that same migration and do not add an anon or authenticated policy. `qbo_connection`, `qbo_sync_cursor`, and `ebay_connection` stay service-role only. Never grant `anon` on customer, vendor, item, token, or other sensitive data.

Row level security is enabled on every `public` table by `20261021050000_lock_down_public_access.sql`. There is no anon or authenticated policy, and those roles have no grants on the tables, sequences, or functions. The publishable key cannot read or write them. The service role, used only on the server, bypasses row level security and keeps its grants. `created_by` and `updated_by` stay empty on these writes because `auth.uid()` is null for the service role, which is the same result the anon app already stored. `ensure_app_user` and `set_app_user` are not called: the server copies their checks and writes `app_users` with the service role, so `auth.uid()` is not required. Trigger functions still run as the service role, which has `execute`. `qbo_connection` and `ebay_connection` hold the tokens. `qbo_sync_cursor` holds each QuickBooks entity's change cursor, last sync time, and an unfinished list pull's position. `countries` is the ISO 3166-1 list. Manufacturer names and aliases are unique after the same trim, case, and space normalization used by the form. `ebay_sync_log` messages must not include tokens or buyer personal data.

While sign-in is off (`AUTH_REQUIRED` is not exactly `true`), server actions and route handlers use the service role with no session check. When sign-in is on, those calls require an approved `app_users` row. Pending and disabled accounts can still read their own profile. The publishable key stays in the sign-in page so Google OAuth can start. It is not a grant on any table.

## Apply update_item before the item-form deploy

`supabase/migrations/20261022003049_update_item_ignore_quantity.sql` replaces `update_item` in place. The argument list stays the same, so PostgREST still sees one function. `p_quantity` defaults to null and is ignored, and the `update` no longer assigns `items.quantity`. Execute is revoked from `public`, `anon`, and `authenticated`, and granted to `service_role` only.

Apply this file before merging the item-form release. That release stops sending `p_quantity`. The function in production today has no default for that argument, so a deploy that lands first makes an item save fail. Applying this file first keeps the app that is already deployed working: it still sends `p_quantity`, the call still succeeds, and on-hand quantity is left unchanged.

## Apply the lockdown after the deploy

1. Set `SUPABASE_SERVICE_ROLE_KEY` on Vercel Production and Preview. Do not prefix it with `NEXT_PUBLIC_`. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` stay for the sign-in page. Leave `AUTH_REQUIRED` unset until Google OAuth is ready.
2. Merge this change and wait until production is serving it. The new server can use the service role before the migration, because that role already has grants.
3. Run `supabase/migrations/20261021050000_lock_down_public_access.sql` on project `fxsbpreasbdalwthyzvk`. Do not run it before step 2. The browser app on the previous release calls PostgREST with the publishable key and will fail closed.
4. Confirm `GET /rest/v1/customers?select=id&limit=1` with the publishable key as both `apikey` and `Authorization: Bearer` returns a permission error, and repeat for `vendors` and `items`. A hard refresh clears a cached bundle that still embeds table calls.
5. Open items, an item page, a photo upload, labels, Lens, QuickBooks and eBay status, and scan.

Rolling the migration back while the new app is still deployed re-opens the publishable key. Roll it back only together with a revert of the app.

```sql
-- Rollback for 20261021050000_lock_down_public_access.sql.
-- Re-opens anon access. Use only if the service-role app is reverted too.

do $rollback$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_settings', 'attribute_values', 'attributes', 'bin_counter', 'bin_events', 'bins',
    'countries', 'customers', 'ebay_sync_log', 'item_attributes', 'item_images',
    'item_taxonomy_changes', 'item_transactions', 'items', 'manufacturer_aliases',
    'manufacturers', 'price_quotes', 'qbo_sync_log', 'sku_counter', 'taxonomies',
    'taxonomy_attributes', 'units', 'vendors'
  ]
  loop
    execute format('alter table public.%I disable row level security', table_name);
    execute format('grant all on table public.%I to anon, authenticated, service_role', table_name);
  end loop;
end
$rollback$;

alter table public.app_users disable row level security;
revoke all on table public.app_users from public, anon, authenticated;
grant select on table public.app_users to authenticated;
grant all on table public.app_users to service_role;

alter table public.ebay_connection enable row level security;
alter table public.qbo_connection enable row level security;
alter table public.qbo_sync_cursor enable row level security;
revoke all on table public.ebay_connection from public, anon, authenticated;
revoke all on table public.qbo_connection from public, anon, authenticated;
revoke all on table public.qbo_sync_cursor from public, anon, authenticated;
grant all on table public.ebay_connection to service_role;
grant all on table public.qbo_connection to service_role;
grant all on table public.qbo_sync_cursor to service_role;

grant execute on all functions in schema public to anon, authenticated, service_role;
revoke all on function public.ensure_app_user(text) from public, anon;
revoke all on function public.set_app_user(uuid, text, text) from public, anon;
grant execute on function public.ensure_app_user(text) to authenticated, service_role;
grant execute on function public.set_app_user(uuid, text, text) to authenticated, service_role;

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant execute on functions to anon, authenticated, service_role;

grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select, insert, update, delete on storage.buckets to anon, authenticated;
grant all on table storage.objects to service_role;
grant all on table storage.buckets to service_role;

drop policy if exists item_images_read on storage.objects;
drop policy if exists item_images_insert on storage.objects;
drop policy if exists item_images_delete on storage.objects;
create policy item_images_read on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'item-images'
    and storage.allow_any_operation(array[
      'storage.object.get_authenticated', 'storage.object.get_authenticated_info',
      'object.get_authenticated_info', 'storage.object.sign', 'storage.object.sign_many',
      'storage.object.info_authenticated', 'storage.object.delete', 'storage.object.delete_many'
    ])
  );
create policy item_images_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'item-images');
create policy item_images_delete on storage.objects for delete to anon, authenticated
  using (bucket_id = 'item-images');

notify pgrst, 'reload schema';
```

`price_quotes` can store market research before an item exists. `20261023220820_price_quotes_research.sql` is already applied on project `fxsbpreasbdalwthyzvk` (version `20261023220820`). Do not edit that file and do not run it again. `item_id` is nullable, and deleting the item sets it null. A row must have an item or a non-blank `part_number`. The before-insert trigger `price_quotes_fill_part_number` fills an empty `part_number` from the linked item: `part_number`, then `oem_part_number`, then `model`. `part_number_norm` is generated by uppercasing `part_number` and removing whitespace, `-`, and `/`. Match it to `items.part_number` normalized the same way, then to `items.oem_part_number`, and set `item_id` only when exactly one item matches. `price` is the unit price excluding shipping. `qty` is the units in the lot. `shipping` is the charge for the whole listing (null when unknown, 0 when free). `condition` stays unconstrained source text. `condition_class` is New, New Open Box, Refurbished, Used, or For Parts. `source` also allows `web_listed`. Optional columns are `manufacturer_id`, `manufacturer_name`, `model`, `taxonomy_id`, `condition_note`, `listing_type` (asking, sold, quote, or offer), and `listing_date`. Grants and row level security are unchanged: enabled, no policies, `service_role` only.

`npm run typecheck` and `npm run build` both need to pass.
