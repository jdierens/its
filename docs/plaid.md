# Plaid bank feeds

**Admin > Integrations > Bank feeds** connects a US bank through Plaid and stores accounts and recent transactions. Bank of America is the account Jan expects. Sandbox test banks use the same Link screen. This version connects, stores, and shows transactions. It does not reconcile them to sales orders or purchase orders, and it does not mirror them into QuickBooks.

The app builds and the page loads with no Plaid keys. The page then says **Add Plaid credentials** and Connect stays disabled.

## Keys

Copy these into `.env.local` for local dev, and into Vercel Production and Preview for the deployed app. They are server-only. Do not prefix them with `NEXT_PUBLIC_` and do not commit the file. After changing them on Vercel, redeploy so the server picks them up.

| Variable | Purpose |
| --- | --- |
| `PLAID_CLIENT_ID` | Plaid client id |
| `PLAID_SECRET` | Secret for the environment in `PLAID_ENV`. Sandbox and production secrets are different. |
| `PLAID_ENV` | `sandbox` or `production`. Required. A blank value does not guess. |
| `PLAID_WEBHOOK_URL` | Public `https` URL of `/api/plaid/webhook`. Optional until webhooks should fire. |
| `PLAID_REDIRECT_URI` | OAuth return URL. Required for Bank of America. Optional for sandbox test banks. |
| `PLAID_CLIENT_USER_ID` | Optional stable company id sent to Plaid. Defaults to `its`. Do not put an email here. |
| `SUPABASE_SERVICE_ROLE_KEY` | Already used for QuickBooks and eBay. The only key that can read `plaid_items`. |

Jan pastes the client id and the matching secret. For the first pass use the Sandbox secret and `PLAID_ENV=sandbox`. For live Bank of America data, use the Production secret and `PLAID_ENV=production`. Disconnect sandbox Items before switching. A sandbox access token does not work against production, and this server holds one secret at a time.

## Sandbox and Trial

Sandbox is free and returns test data. In Link, search for a sandbox institution such as First Platypus Bank and sign in with `user_good` / `pass_good`. That does not need a redirect URI.

Production reads live accounts. Plaid Trial, for a US or Canada team created on or after 15 Apr 2026, includes up to 10 connected Items at no charge. An Item is one bank login, not one transaction and not one account under that login. One or two Bank of America logins fit in that allowance. After Trial, Plaid prices each connected Item. Transaction volume is not the meter. Trial includes Auth, Transactions, Balance, Identity, Assets, Liabilities, Investments, and Statements. This integration requests Transactions only. Balance comes back on the accounts. Auth, Identity, and the other products are not called, so account and routing numbers are not stored.

Link is limited to US institutions. It is not locked to Bank of America, so a sandbox bank and another US bank can connect the same way.

## What to apply on production

Deploying the app does not run SQL. In the SQL editor for project `fxsbpreasbdalwthyzvk`, run `supabase/migrations/20261028160000_plaid_bank_feeds.sql` after review. The file only adds tables. The previous app does not read them, so it can be applied before or after the deploy. Until it is applied, the bank-feeds page says the tables are missing.

Register the redirect URI in the Plaid dashboard under Allowed redirect URIs before connecting Bank of America. Use the same value as `PLAID_REDIRECT_URI`. Production must be `https`. A typical value is:

`https://its-epks.vercel.app/admin/integrations/plaid`

For local sandbox OAuth, `http://localhost:3000/admin/integrations/plaid` is allowed. The URI must not include a query string. Plaid compares it exactly.

Point `PLAID_WEBHOOK_URL` at:

`https://its-epks.vercel.app/api/plaid/webhook`

Plaid cannot call `http://localhost`. Sandbox can still connect and sync without a webhook. **Fire sandbox webhook** on a sandbox Item calls `/sandbox/item/fire_webhook` for `SYNC_UPDATES_AVAILABLE`. Plaid delivers that only when the webhook URL is public. The route checks the `Plaid-Verification` JWT with `/webhook_verification_key/get` on the same environment as `PLAID_ENV`. That key endpoint exists in sandbox, so verification is the same path as production. A missing or bad signature is rejected. The body hash is the raw request bytes.

## Flow

Connect calls `POST /api/plaid/link-token`, which calls `/link/token/create` with product `transactions`, country `US`, and 90 days of history. The browser receives only the short-lived `link_token`. Plaid Link returns a `public_token` to the page. `POST /api/plaid/exchange` calls `/item/public_token/exchange` on the server and stores the `access_token`. The browser never sees the access token.

Sync calls `/accounts/get` and `/transactions/sync`, saves the cursor on the Item, and upserts accounts and transactions. A pagination conflict (`TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`) restarts from the cursor that was saved before that run. One request pulls up to 20 pages. If more remain, Sync again continues. The first sync also turns on `SYNC_UPDATES_AVAILABLE` webhooks when a webhook URL was set at Link.

Disconnect calls `/item/remove` and deletes the local Item, its accounts, and its transactions. If `PLAID_ENV` no longer matches the Item, the local rows are deleted and Plaid is not called, because the other environment's secret is not on this server. Remove that Item in the Plaid dashboard if it would still be billed.

Repair connection opens Link in update mode for an Item in `login_required`.

When sign-in is on, only an approved admin or staff user can open the data or connect, sync, or disconnect. `read_only` is told that bank feeds are limited to admin and staff. When `AUTH_REQUIRED` is not exactly `true`, bank feeds follow the rest of ITS and stay open.

## Security

`plaid_items.access_token` is stored like `ebay_connection` and `qbo_connection`: a server-only column, row level security on, no policies, and grants revoked from `anon` and `authenticated`. Only the service role, used by route handlers, can read it. Status JSON is built without `access_token`, the sync cursor, or the public token. Logs store the Plaid Item id and error codes, not tokens.

The raw transaction payload is not stored. The table keeps the date, name, merchant, amount, pending flag, channel, and personal-finance category. Plaid's amount is positive when money leaves the account. The screen shows the opposite sign, so a purchase looks negative.

`/api/plaid/webhook` is in `PUBLIC_PATHS` because Plaid has no ITS session. Every other Plaid route stays behind the normal sign-in gate.
