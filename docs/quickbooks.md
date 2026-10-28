# QuickBooks customers and vendors

**Contacts** in the sidebar lists customers and vendors. The search box keeps each character. The list and the address (`q`) update after a short pause, and a newer query wins over an older reply. **Admin > Integrations** opens an overview. **QuickBooks**, **eBay**, and **Bank feeds** are sidebar pages under it. The app has no Intuit credentials until you add them. Lists and forms work before that. Sync runs after the connection is saved. Google and BrokerBin can be added as further pages. `/admin/integrations` stays in place, including as the eBay auth-declined address.

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

**Sync** on Admin > Integrations > QuickBooks chooses customers, vendors, or both, and Pull from QuickBooks, Push ITS changes, or Both. Both is the default. **Start sync** uses that choice. **Sync customers** and **Sync vendors** run one entity with the same direction. **Full resync** ignores that entity's change cursor and reads every active and inactive record, unless a pull of that list is already unfinished, in which case it continues. The toolbar Save remembers the checkboxes, direction, and full-resync choice in `localStorage`. Connect, disconnect, test, and sync are icons in that same toolbar.

A full list is read in Id order, 100 records at a time, two pages per request. The page stays open and calls the sync route again until the list is done. The line looks like `Customers 3,500 / 8,102`. `qbo_sync_cursor.start_position` is the next 1-based position, and `query_total` is the count QuickBooks reported. Each finished page is saved before the next one starts, and each request writes a progress row to `qbo_sync_log`. A request that fails or is cut off leaves that position in place. The next sync continues there. Rows match on `qbo_id`, so reading the same page again updates the contact instead of inserting another one. `last_sync_at` and `cdc_since` change only when the list is finished. `cdc_since` is the time the pull started, so edits made while the pages were loading are included in the next incremental pull. The route allows 60 seconds, and one request stays well under that.

Customers and vendors each have a last-sync time and a CDC cursor in `qbo_sync_cursor`. Syncing one does not move the other. The first migration copies the previous shared cursor onto both. A push updates the last-sync time and leaves the cursor. A finished pull sets the cursor to the time that pull started, with a two-minute overlap on the next incremental pull. An incremental pull also stops after one change page and continues on the next request. `POST /api/qbo/sync` requires `{ entities: ["customer" and/or "vendor"], direction: "pull" | "push" | "both", full: boolean }`. The browser sends push once, then pull one entity at a time until each report says it is done.

Push sends ITS rows marked local, pending, or error. A conflict stays put until you edit the contact again. Rows match on `qbo_id`. An update sends the QuickBooks `SyncToken`. If QuickBooks returns a stale-object error (5010), ITS refetches that record, keeps the QuickBooks version, and logs the discarded local edit. Inactive QuickBooks records stay in the list with Active set to No. The result line looks like `Customers: 12 new, 3 updated, 0 errors`.

Customer tax id is `ResaleNum`. Vendor tax id is `TaxIdentifier`. Vendor notes and shipping addresses stay in ITS, because QuickBooks vendors do not store them. Clearing an email, phone, or address in ITS leaves the previous QuickBooks value in place; the next pull keeps that QuickBooks value. Setting Active to off is sent.
