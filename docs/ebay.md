# eBay seller connection

**Admin > Integrations > eBay** stores the seller connection, reads active listings, and can pull eBay orders into draft sales orders. Later steps will create listings from items, sync quantity, and push tracking.

Copy these into `.env.local`. They are server-only. Do not prefix them with `NEXT_PUBLIC_` and do not commit the file.

| Variable | Purpose |
| --- | --- |
| `EBAY_CLIENT_ID` | App ID (client id) |
| `EBAY_CLIENT_SECRET` | Cert ID (client secret) |
| `EBAY_RU_NAME` | RuName from the eBay developer portal. OAuth sends this as `redirect_uri`. |
| `EBAY_ENVIRONMENT` | `sandbox` or `production` |
| `EBAY_DEPLETION_VERIFICATION_TOKEN` | Token you choose for marketplace account deletion. 32 to 80 characters. |

`SUPABASE_SERVICE_ROLE_KEY` is also required. It is the only key that can read `ebay_connection`.

In the eBay developer portal, create a RuName whose **Auth Accepted URL** is:

`https://its-epks.vercel.app/api/ebay/callback`

Put that RuName in `EBAY_RU_NAME`. eBay does not use the URL itself as `redirect_uri`. Sandbox and production each have their own RuName. `EBAY_ENVIRONMENT` selects the hosts: `auth.ebay.com` and `api.ebay.com`, or `auth.sandbox.ebay.com` and `api.sandbox.ebay.com`.

Connect starts at `/api/ebay/connect`. The browser goes to eBay with a short-lived CSRF cookie and these scopes: `https://api.ebay.com/oauth/api_scope`, `https://api.ebay.com/oauth/api_scope/sell.inventory`, `https://api.ebay.com/oauth/api_scope/sell.account`, `https://api.ebay.com/oauth/api_scope/sell.fulfillment`, `https://api.ebay.com/oauth/api_scope/sell.marketing`, and `https://api.ebay.com/oauth/api_scope/commerce.identity.readonly`. The cookie is httpOnly, SameSite=Lax, and expires after 10 minutes. It is marked Secure in production. eBay returns to `/api/ebay/callback`, which checks the cookie with a constant-time compare. A mismatch shows "Connection could not be verified, please try Connect again" and is written to `ebay_sync_log`. The code is exchanged at `/identity/v1/oauth2/token` with HTTP Basic auth. ITS then calls the Commerce Identity `getUser` API and stores the eBay username and user id.

The access token lasts about two hours. ITS refreshes it with the long-lived refresh token when it is close to expiry. A sell API call that returns 401 is refreshed once and retried once. Token calls retry network errors, HTTP 429, and HTTP 5xx up to three times. `invalid_grant` and `invalid_client` are not retried. If the refresh token is past `refresh_expires_at`, or eBay returns `invalid_grant`, the connection is marked `needs_reconnect`. The card shows "eBay needs to be reconnected" and a Reconnect button. Errors in `ebay_sync_log` include `rlogid` and `X-EBAY-C-REQUEST-ID` when eBay sent them. Disconnect deletes the local tokens. eBay does not provide a revoke call for this flow, so the seller can also remove the app from their eBay account.

**Test connection** calls `sell/account/v1/privilege`, a read of selling privileges, and shows whether eBay accepted the token.

Production keysets must answer marketplace account deletion notifications. The endpoint is:

`https://its-epks.vercel.app/api/ebay/account-deletion`

Set the same URL and `EBAY_DEPLETION_VERIFICATION_TOKEN` in the eBay developer portal. A GET with `challenge_code` responds with `{ "challengeResponse": "<sha256 hex>" }`, where the hash is `challengeCode + verificationToken + endpoint` with no separator. A POST notification is acknowledged with HTTP 200 and a log line. ITS does not store the buyer username, user id, or eias token from that notification.

`/api/ebay/callback` and `/api/ebay/account-deletion` are in `PUBLIC_PATHS`. `/api/qbo/callback` is too. Those routes stay outside the session check. eBay's servers call the deletion endpoint with no session.

Vercel Deployment Protection still has to stay on. Sign-in does not lock the database: the anon key can still write the existing tables until the phase 2 policies in [sign-in](sign-in.md) are applied. eBay will not send a Vercel bypass header, so a protected deployment returns a login wall instead of the challenge JSON. That is unchanged. Turn Deployment Protection off only after phase 2 is deployed.

The Integrations card shows the accept URL and the deletion URL for the origin you are browsing. On production that is the two URLs above.

## Active listings

**Refresh listings** on Admin > Integrations > eBay reads every active listing. It does not create, revise, or end anything on eBay. The button is admin only. The call is Trading API `GetMyeBaySelling` with `ActiveList`, 200 listings per page, using the stored user token in `X-EBAY-API-IAF-TOKEN`. A 401, or an auth failure code 931, 17470, or 21917053, refreshes the token once and retries once. Seller Hub listings are included. The Inventory API is not used for this pull, because it misses those legacy listings.

Rows go into `ebay_listings`. `supabase/migrations/20261024180000_ebay_listings.sql` is already applied. Pack size is a second file, `supabase/migrations/20261024190000_ebay_listing_packs.sql`. Apply that file yourself. It adds `base_sku` (text, null until a pack label matches) and `pack_qty` (integer, not null, default 1, check at least 1). Deploying the app does not run it. One listing with variations becomes one row per variation. A listing without variations has `variation_sku` null. The unique key is `(ebay_item_id, coalesce(variation_sku, ''))`, stored as `variation_key`. Prices are not stored. Row level security is on and only `service_role` can read or write the table.

During the pull, the label is `variation_sku` when one is present, otherwise `sku`. An exact match of that full label to `items.sku` wins, including a unique case-insensitive match. That row gets `pack_qty` 1 and `base_sku` null, so a real item whose SKU ends in `-4PK` is not read as a pack. If the full label matches no item and it has the form `<SKU>-<n>PK` (case-insensitive, `n` an integer of at least 1, no leading zero), the pull matches `<SKU>`, sets `pack_qty` to `n`, and stores the parsed base in `base_sku`. `-PK`, `-0PK`, `-04PK`, and `-4pkx` do not parse. A kit is an item, so its SKU matches the same way. Nothing is added to `items`. A label that matches no item stays in `ebay_listings` with `item_id` null. Several listings can point at one item: a single, a pack, and another grade that uses the same SKU each stay as their own row. After every page has been read, rows that were active and were missing from this pull are marked `Ended`. A failed page leaves the previous rows unchanged. The pull writes one `ebay_sync_log` row with entity `listings`. The log has counts only, not SKUs, titles, or tokens.

Until the pack migration is applied, refresh still stores listings and every row is treated as a pack of 1. After you apply it, run **Refresh listings** again so `pack_qty` and `base_sku` are filled. Existing rows default to 1. The eBay card shows the active count, how many active rows have no item, and when listings were last fetched. Before `ebay_listings` exists, those counts stay blank and the items page still loads.

## Listings browser

**Browse listings** on Admin > Integrations > eBay, and **eBay listings** in the sidebar, open `/admin/integrations/ebay/listings`. The page lists every active row: title, picture, custom label, quantity, and the ITS item. Search covers the title, custom label, eBay item id, and the matched item's SKU or name. Filters are all active, unmatched, and matched. Ended rows stay out of this list.

The picture is the listing's https `PictureURL`, or `GalleryURL` when `PictureURL` is missing. Both come from the `GetMyeBaySelling` response already used by refresh. There is no extra call per listing. `supabase/migrations/20261025020000_ebay_listing_browser.sql` adds `picture_url` (text, null until a picture is stored) and `matched_manually` (boolean, not null, default false). Apply that file yourself. Deploying the app does not run it. Until then the page still loads. A matched item can show its ITS photo. After you apply the file, run **Refresh listings** so `picture_url` is filled.

When `item_id` is null, an admin can search for an item and match it. That sets `item_id` and `matched_manually`. It does not change the custom label on eBay. A later refresh keeps that item when the label still matches no SKU. A label that matches an item SKU replaces the hand match. Until `matched_manually` exists, the hand match is stored on `item_id` and the next refresh can clear it. Only an admin can match. The page is readable with the rest of Integrations.

Pushing an adjusted SKU to eBay and ending a listing are not available. Each row shows those actions disabled. They do not call eBay. `ebay_listings` has no `updated_by` column. Pulls and the match update do not invent one.

The items table has an eBay column for listings matched directly to that item. Each id links to `https://www.ebay.com/itm/<id>`. A pack greater than 1 shows beside the id, for example `4x`. Several ids show the first and then +N, which opens the rest. A separate control, such as `in 3 kit listings`, opens the kit listings that use the item. That list has the listing id, the kit SKU linked to the kit item, and how many of this item are in the listing. The item page splits the same facts into **Listed directly** (listing id and pack size, including `1x`) and **In kit listings**.

Kit use is computed when the item is read. It walks `kit_components`, including a kit that contains a kit, and does not add listing rows for the components. Quantity is the component quantity along the recipe, multiplied, times the kit listing's `pack_qty`. Searching an eBay item id finds the listed item or kit only. It does not find components. Ended rows are not shown, but the id still finds the listed item.

## Orders

**Pull orders** reads the Fulfillment API `getOrders` and writes draft sales orders. It does not approve an order, release it, or call `reserve_sales_order_number`. `so_number` stays empty until someone approves the draft, and that number comes from `so_counter`, the same series as every other sales order. The button is admin only. A paid eBay order is still a draft.

Every new draft uses the existing customer named `eBay Customer` with QuickBooks id `1`. The pull does not create a customer for a buyer. Buyer name, username, email, and phone go on `sales_orders.buyer`. The ship-to address is the buyer's. The eBay order id is stored in `ebay_order_id` and `source_ref`. The sales record number, when it is digits, is stored in `ebay_sales_record_ref`. `source` is `ebay` and `channel` is `ebay`. A line whose SKU matches one item is allocated to that item. A line whose SKU matches nothing, or matches more than one item, stays on the draft without an allocation. `operator_id` stays null. The history row is labeled `eBay`.

If `ebay_order_id` already matches a sales order, that order is used and a second draft is not created. A draft that nobody has edited is refreshed. Any other match is linked: empty eBay ids are filled, and lines, status, and the SO number are left as they are. A sales record reference is used only when it matches exactly one sales order. Several matches are left alone.

The pull reads orders whose order date is **1 Jan 2026 or later**, in 90-day windows. That is the inventory cutover: beginning inventory is as of that date, and later sales orders are what should move stock. An eBay order dated before then is left out of the pull. A later change can flag those for manual review. Pull orders stays disabled until the legacy log map has been applied, because ITS sales orders do not yet have `ebay_order_id` filled. **Apply log map** takes the CSV export (it is not stored) and, for each eBay order id, sets `ebay_order_id` and `ebay_sales_record_ref` on the sales order whose `so_number` matches the sheet REF (`SO#27254` or a suffixed `SO#27254-01`). It does not create sales orders, including for orders dated before 2026. When one eBay order id is on two SO numbers, the lower number is linked and the other is counted as a conflict. A later pull of a 2026-or-later order then finds the linked order instead of inserting a draft. The CSV stays out of git.

`supabase/migrations/20261025020829_ebay_order_pull.sql` adds `ebay_order_seed` (one row, row level security on, `service_role` only) and lets `ebay_sync_log.entity` be `orders`. Apply it yourself. Deploying does not run it. The log row for a pull has counts only.

A seller who connected before order access was granted has to reconnect. The pull says so and does not mark the token expired on its own. Tracking is not pushed back to eBay.

