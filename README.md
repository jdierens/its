# ITS

Inventory app for the ITS Supabase project. A sidebar groups Inventory, Sales, Purchasing, Warehouse, Pricing, and Admin. The item list at `/items` is a dense table. Filter by taxonomy short code, condition, and manufacturer, and search SKU, name, description, manufacturer, aliases, model, part number, and attribute values on the server (`ilike`). The address keeps `?tax=`, `?q=`, `?condition=`, and `?mfr=`. Arrow keys move the cell and Enter opens the item. Create and edit use taxonomies, allowed attribute values, and photos.

Under the ITS title, the sidebar shows the version from `package.json` and a short git commit, for example `v0.15.0 · a1b2c3d`. Hover that line for the full commit, branch, and Pacific build time. A collapsed sidebar keeps a tiny version under the logo. Local builds add a `-dev` suffix and a dev badge. Vercel preview builds show a preview badge; production does not. Those values are `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_GIT_SHA`, and `NEXT_PUBLIC_BUILD_TIME` (plus the branch and channel), set in `next.config.ts`. They are not secrets. Bump the version on every pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

## Privacy and terms

`/privacy` and `/terms` are public. They do not use the app shell, and they do not require sign-in. ITS has no login yet. When Google sign-in is added, leave both paths out of the auth check in `middleware.ts`. The list to keep public is `PUBLIC_PATHS` in `lib/publicPaths.ts`.

The pages are a plain-language notice, not legal advice. They give the mailing address 3730 E Dale Ave, Henderson, Nevada 89044, and the terms use the laws of the State of Nevada.

## Try it

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project's publishable or anon key. Do not commit that file.
3. Run `npm install`, then `npm run dev`.
4. Open http://localhost:3000.

Create an item from **New item**. **Main** and **Trade compliance** sit above the taxonomy fields. Manufacturer is a controlled list: type to search, pick a close match or an alias, or add a name that is not already there. Model and part number are text. Condition is New or Used and starts as Used. A new item's condition note is Factory Sealed, New Open Box, or empty. A used item's note is optional free text. ECCN starts as `5A992.C`. US HTS is digits with optional dots, up to 10 digits. CCATS is optional. Country of origin is an ISO alpha-3 country and starts empty. There is no default country.

**Admin > Manufacturers** lists those names. Rename one, add or remove aliases, or merge two. Merge moves the items and keeps the other name as an alias. Lookup trims the text, ignores case, and collapses spaces, so `SK Hynix` and `SK hynix` are the same name. `Hynix` is a separate alias.

The items table puts Taxonomy between the photo and the SKU. Manufacturer, Model, Part number, and Condition follow the name. Search matches the manufacturer name and its aliases. The 90×29 mm label is unchanged. It already holds the name, description, barcode, quantity, short code, and date, so there is no spare line for a part number. There is no CSV export.

The taxonomy field lists existing taxonomies in `sort_order` and accepts a new name. A new name is created when you save, matched without regard to case, and needs a long code (like `CRD/NIC`) and a 3-character short code (like `NIC`). Both are uppercased as you type and stored in uppercase. The new taxonomy is placed at the end of the order. On the selected taxonomy you can add an attribute (name, integer/decimal/text, optional unit, and whether it uses an allowed-value list).

**Taxonomies & Fields** opens `/taxonomies`. **New taxonomy** asks for a name, a long code, and a 3-character short code, and can start by linking fields that already exist on another taxonomy. Those fields stay one shared definition. Drag a row, or use Up and Down, to change `sort_order`. That order saves on its own and is what the item form lists. **Save changes** appears only after the name or a code is edited. Enter saves that row, and Escape puts the saved name and codes back. A taxonomy with no items can be deleted. Deleting it unlinks its fields and does not delete the field definitions.

**Fields** on a taxonomy lists the shared fields it uses, in `taxonomy_attributes.sort_order`. That order is what the item form and the items table use. **New field** creates a definition and links it. **Add existing field** links definitions that other taxonomies already use, including every field from one taxonomy. A field used by more than one taxonomy shows who else uses it. Editing its name, unit, label, or value list changes it everywhere it is linked. **Remove from this taxonomy** unlinks it here and is blocked while items in this taxonomy still have a value. The definition can be deleted only when no taxonomy links it and no item value remains. **Merge fields** folds one field into another of the same type: item values and links move, and the extra definition is deleted. Merge stops when one item has a value for both. A type change is blocked while any item uses the field.

Deleting an item asks for confirmation, then removes the item, its attribute values, and its photos, including the files in storage. The original row is not left behind.

Attribute fields with a list accept a listed value or a new one. Integer and decimal values are checked before save. A new value is written into `attribute_values` in the same `create_item` or `update_item` call. Numeric lists are ordered by number.

Photos upload to the private `item-images` bucket. On an existing item they save immediately, at the end of the gallery. On a new item they upload after the item row is created, in the order shown. The first photo is the primary image. The items table uses that photo as the thumbnail. The label does not print a photo.

Click a saved photo, or focus it and press Enter, to open the editor. Delete is the corner icon and asks before removing the file. Drag photos to reorder them, or focus a photo and press the left or right arrow. That order saves immediately. The first photo is primary. `is_primary` stays on the table and a trigger sets it from that order, because the deployed app still reads the column. A later migration drops it after this release is live.

The editor adjusts brightness, contrast, white balance, and sharpness, with a before/after toggle. Crop includes a free rectangle and a 1:1 square, and the photo can rotate 90 degrees. Remove background runs in the browser with `@imgly/background-removal` (the smaller `isnet_quint8` model) and can leave white or transparency. Redact drags a rectangle that is pixelated, or filled solid when the area is small, into the pixels. Saving adds a new gallery photo just after the one you edited and does not replace the original. `source_image_id` records which photo it came from. A white background exports as JPEG at quality 0.92, keeping the edited size and at least 1600 px on the long side when the photo is that large. A transparent background exports as PNG.

**Print labels** opens `/labels`. Look up an item by SKU or uuid, enter the quantity to print and how many copies (default 1), then print. The quantity is only printed on the label. It does not change the item's stock. The edit page has a **Print label** button that opens this page with the item filled in.

The label is one 90 mm × 29 mm landscape page, for a Brother QL-820NWB with DK-1201 (29 × 90 mm) die-cut labels. The item name stays on one line. Names longer than 60 characters are cut to 60 and end with an ellipsis. The font shrinks so a name of up to 60 characters fits the label width. The barcode is Code 128 from [JsBarcode](https://github.com/lindell/JsBarcode), encoding the SKU, or the item id when the SKU is empty. That same value is printed in bold under the bars, about 3 to 4 mm cap height when the code is short. Bars stay at least 8 mm tall and a whole number of 300 dpi dots (4 dots wide, or 3 if the code is long). The quantity number in the middle is about 8.4 mm and bold, with a small QTY caption under it. That caption, the item ID, and the print date share one baseline. The barcode, quantity number, and taxonomy short code share one top line. The short code stays large and bold, and the date is spaced to the same width so their edges line up. An item with no taxonomy leaves that spot empty.

Seeded codes, in display order:

| Order | Taxonomy | Long code | Short code |
| --- | --- | --- | --- |
| 1 | server | SYS/SRV | SRV |
| 2 | memory | DIM/MEM | MEM |
| 3 | HDD | DSK/HDD | HDD |
| 4 | SSD | DSK/SSD | SSD |
| 5 | network card | CRD/NIC | NIC |
| 6 | HBA card | CRD/HBA | HBA |
| 7 | transceiver | OPT/TRX | TRX |
| 8 | switch | NET/SWT | SWT |
| 9 | network cable | NET/CBL | CBL |

From a Mac browser, use these print-dialog settings:

- Paper size: 29 × 90 mm
- Orientation: Landscape
- Scale: 100%
- Margins: None
- Headers and footers: off

## QuickBooks customers and vendors

**Contacts** in the sidebar lists customers and vendors. **Admin > Integrations** connects QuickBooks Online. The app has no Intuit credentials until you add them. Lists and forms work before that. Sync runs after the connection is saved.

Copy these into `.env.local`. They are server-only. Do not prefix them with `NEXT_PUBLIC_` and do not commit the file.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Server key for `qbo_connection`. The browser never sees tokens. |
| `QBO_CLIENT_ID` | Intuit app client id |
| `QBO_CLIENT_SECRET` | Intuit app client secret |
| `QBO_REDIRECT_URI` | Must match a redirect URI on the Intuit app |
| `QBO_ENVIRONMENT` | `sandbox` or `production` |

For local dev, register this redirect URI on the Intuit app and set `QBO_REDIRECT_URI` to the same value:

`http://localhost:3000/api/qbo/callback`

Intuit matches the URI exactly. If you open the app at `http://127.0.0.1:3000` instead, register `http://127.0.0.1:3000/api/qbo/callback` and set the env var to that. Production keys require `https`. Sandbox keys can use `http://localhost`.

Connect starts at `/api/qbo/connect`, which sends the browser to Intuit with scope `com.intuit.quickbooks.accounting` and a short-lived CSRF cookie. The cookie is httpOnly, SameSite=Lax, and expires after 10 minutes. It is marked Secure in production. Intuit returns to `/api/qbo/callback`, which checks that cookie with a constant-time compare. A mismatch shows "Connection could not be verified, please try Connect again" and is written to `qbo_sync_log`.

Authorization, token, and revoke URLs come from Intuit's OpenID discovery document (`openid_sandbox_configuration` or `openid_configuration`), cached in memory for 24 hours. If that fetch fails, ITS uses the documented Intuit hosts. `QBO_ENVIRONMENT` still chooses the QuickBooks API host, sandbox or production.

Access tokens are refreshed when they are close to expiry. If a QuickBooks call returns 401, AuthenticationFailed, code 3200, or "Token expired", ITS refreshes once and retries that call once. If the refresh token is past `refresh_expires_at`, or Intuit returns `invalid_grant`, the connection is marked `needs_reconnect`. Admin, then Integrations, shows "QuickBooks needs to be reconnected" and a Reconnect button. Sync returns that same message. Token-endpoint calls retry network errors, HTTP 429, and HTTP 5xx up to three times. `invalid_grant` and `invalid_client` are not retried. A failed QuickBooks call is stored in `qbo_sync_log` with the request, HTTP status, Intuit fault code and message, and `intuit_tid` when Intuit sent one. If the call still fails authentication after a refresh, the message says whether `QBO_ENVIRONMENT` is sandbox or production and which one to set.

Disconnect calls Intuit's revoke endpoint and deletes the local row.

**Sync** on Admin > Integrations chooses customers, vendors, or both, and Pull from QuickBooks, Push ITS changes, or Both. Both is the default. **Start sync** uses that choice. **Sync customers** and **Sync vendors** run one entity with the same direction. **Full resync** ignores that entity's change cursor and reads every active and inactive record. The browser remembers the checkboxes, direction, and full-resync choice in `localStorage`.

Customers and vendors each have a last-sync time and a CDC cursor in `qbo_sync_cursor`. Syncing one does not move the other. The first migration copies the previous shared cursor onto both. A push updates the last-sync time and leaves the cursor. A finished pull sets the cursor to the time that pull started, with a two-minute overlap on the next incremental pull. `POST /api/qbo/sync` requires `{ entities: ["customer" and/or "vendor"], direction: "pull" | "push" | "both", full: boolean }`.

Push sends ITS rows marked local, pending, or error. A conflict stays put until you edit the contact again. Rows match on `qbo_id`. An update sends the QuickBooks `SyncToken`. If QuickBooks returns a stale-object error (5010), ITS refetches that record, keeps the QuickBooks version, and logs the discarded local edit. Inactive QuickBooks records stay in the list with Active set to No. The result line looks like `Customers: 12 new, 3 updated, 0 errors`.

Customer tax id is `ResaleNum`. Vendor tax id is `TaxIdentifier`. Vendor notes and shipping addresses stay in ITS, because QuickBooks vendors do not store them. Clearing an email, phone, or address in ITS leaves the previous QuickBooks value in place; the next pull keeps that QuickBooks value. Setting Active to off is sent.

## eBay seller connection

**Admin > Integrations** has an eBay card next to QuickBooks. This step stores the seller connection only. Later steps will create listings from items, sync quantity, import orders into sales orders, and push tracking. Nothing in this step lists an item or reads orders.

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

`/api/ebay/callback` and `/api/ebay/account-deletion` are in `PUBLIC_PATHS`. When Google sign-in is added, leave both out of the auth check. eBay's servers call the deletion endpoint with no session.

Vercel Deployment Protection blocks those calls. eBay will not send a Vercel bypass header, so a protected deployment returns a login wall instead of the challenge JSON and eBay rejects the endpoint. Two options: turn Deployment Protection off for this deployment, or use Vercel's Protection Bypass for Automation only if the request can actually carry the bypass (eBay's notification call cannot). Once Google sign-in exists, Deployment Protection can stay off and the app can require a session everywhere except `PUBLIC_PATHS`.

The Integrations card shows the accept URL and the deletion URL for the origin you are browsing. On production that is the two URLs above.

## Item pricing

An existing item shows **Pricing** under the item form. Ecommerce price, market price, and MSRP are USD. Each price stores the time it last changed. Saving the item form does not change them. **Save prices** writes only those three amounts.

**Update pricing** looks up the part number. When the part number is blank, it uses the model. Each result is a new price quote. Older quotes stay. **Last updated** is the time of that lookup.

- eBay listed prices use the Browse API `item_summary/search` with an application token. The token is a client-credentials grant from `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`. The scope is `https://api.ebay.com/oauth/api_scope` and `https://api.ebay.com/oauth/api_scope/buy.browse`. The token is not stored.
- eBay sold prices use Marketplace Insights and stay off unless `EBAY_INSIGHTS_ENABLED=true`. That API needs eBay approval.
- BrokerBin stays off unless `BROKERBIN_API_KEY` is set. With a key, the provider reports that lookup is not connected yet.

The page lists which providers ran, how many quotes they returned, and any error. A price under 30% or over 300% of the median for its currency is kept and marked as an outlier. One price in a currency is not marked.

**Price references** lists every quote. The newest quote for each source is highlighted. Column headers sort the table. Each row shows a relative time such as `captured 2h ago` and the exact Pacific time. **Add quote** records a manual observation, such as a BrokerBin quote or an inbound quote.

**Transactions** lists buys and sells. Filter by type and by date. **Add transaction** records a manual row. The total is quantity times unit price, rounded to cents in the database. A sell can name a customer. A buy can name a vendor. A later QuickBooks or eBay import can insert rows the same way. The same source, reference, and item cannot be inserted twice.

**Admin > Settings** has **Pricing/sales window (days)**. It starts at 90. Last sold price and last bought price are the newest transaction of that type. Quantity sold, revenue, average sell price, quantity bought, and spend count transactions inside the window.

`price_quotes`, `item_transactions`, and `app_settings` hold prices and the sales window. They are not credentials. Row level security stays off on them, matching `items`.

## Database

Migrations live in `supabase/migrations`. Deploying this repo does not apply them. They are already applied on project `fxsbpreasbdalwthyzvk`. On a new database, run them in order in the SQL editor.

`attribute_values` holds the allowed values. `attributes.uses_list` turns that list on. `taxonomies.long_code` and `taxonomies.short_code` are unique and nullable. A trigger uppercases them, and check constraints keep `long_code` equal to `upper(long_code)` and `short_code` matching `^[A-Z0-9]{3}$`. `taxonomies.sort_order` is the list order. `item_images` points at files in the `item-images` bucket (`<item_id>/<image_id>.<ext>`). `sort_order` is the gallery order, backfilled from `created_at`. The lowest `sort_order` is the primary photo. `is_primary` is still present and a statement trigger keeps it equal to that first photo, so the currently deployed app can keep selecting it. Dropping the column waits until this release is deployed. The bucket is private, with a 10 MB limit and JPEG, PNG, WebP, and GIF only.

A migration that is applied to the live database before its pull request is merged has to keep working with the app that is already deployed. That means adding columns, tables, and functions only. Do not drop or rename columns, and do not change an existing function's arguments, until a later migration after the new code is live.

Storage policies on `storage.objects`, for `anon` and `authenticated`, bucket `item-images` only:

- `item_images_read` (select): authenticated download, object info, and signed URLs. Listing the bucket is not allowed.
- `item_images_insert` (insert): upload.
- `item_images_delete` (delete): remove a file.

There is no update policy, so objects cannot be overwritten. Deleting a photo removes the file through the Storage API and then deletes the `item_images` row. Storage does not allow deleting `storage.objects` from a database trigger.

Row level security is disabled on `items`, `taxonomies`, `attributes`, `item_attributes`, `attribute_values`, `item_images`, `customers`, `vendors`, `qbo_sync_log`, `ebay_sync_log`, `countries`, `manufacturers`, `manufacturer_aliases`, `price_quotes`, `item_transactions`, and `app_settings`. The anon key can read and write those rows. This app does not turn RLS on for them. Enabling it without policies would block the client, and the app has no login. `countries` is the ISO 3166-1 list. Manufacturer names and aliases are unique after the same trim, case, and space normalization used by the form. `ebay_sync_log` messages must not include tokens or buyer personal data.

`qbo_connection`, `qbo_sync_cursor`, and `ebay_connection` are the exceptions. Row level security is enabled and there are no policies for `anon` or `authenticated`. Their grants are revoked. Only the service role, from server route handlers, can read them. `qbo_connection` and `ebay_connection` hold the tokens. `needs_reconnect` is set when the refresh token can no longer be used. `qbo_sync_cursor` holds each QuickBooks entity's change cursor and last sync time.

`npm run typecheck` and `npm run build` both need to pass.
