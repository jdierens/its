# Sign-in

Sign-in is shipped and idle. It runs only when the server env `AUTH_REQUIRED` is exactly `true`. Leave that unset until the Google OAuth client and the Supabase Google provider are configured. With it unset, pages open with no session, nothing redirects to `/login`, and the app does not read `app_users`. `/privacy`, `/terms`, and the eBay and QuickBooks callbacks stay public either way. Set `AUTH_REQUIRED=true` on Vercel and redeploy when Google sign-in is ready. That same value is copied to the browser at build time so the users screen stays dormant until then.

The app asks for a Google session on every page except `PUBLIC_PATHS` (`/privacy`, `/terms`, `/api/ebay/callback`, `/api/ebay/account-deletion`, `/api/qbo/callback`). `/login` and `/auth/callback` are open so sign-in can start. A signed-in person whose email is not `@deepdiscountservers.com` is signed out. Google's hosted-domain (`hd`) claim is checked on the callback, and the email domain is checked from the verified session after that.

The first sign-in creates a pending row in `app_users`. Pending and disabled people see **Waiting for approval** and cannot open the rest of the app. `jan@deepdiscountservers.com` is seeded as an approved admin. The seed uses a placeholder id until that Google account signs in, then the row moves onto that account.

**Admin > Users** (admins only) approves an account, sets admin, staff, or read only, or disables it. An admin cannot remove their own access, and the last approved admin stays. Read only is recorded and does not block saves yet. That wait is phase 2, below.

Creating or editing an item, changing its taxonomy, saving a price quote, or recording a transaction stores the signed-in user id when the request has a session. Bins do the same when that table is present. A request with no user, which is how the copy deployed today writes, leaves those columns empty.

## Google Cloud and Supabase Auth

Do this once in the `deepdiscountservers.com` Google account and in the Supabase project `fxsbpreasbdalwthyzvk`. The app does not ship a client id or secret.

1. In Google Cloud, open the project you want for ITS sign-in (or create one). Set the OAuth consent screen to **Internal** if that Cloud project belongs to the `deepdiscountservers.com` Workspace. Internal is the right restriction for this company. The app also sends `hd=deepdiscountservers.com` and rejects any other email after Google returns.
2. Create an OAuth client of type **Web application**.
3. Authorized JavaScript origins: `https://its-epks.vercel.app` and `http://localhost:3000`.
4. Authorized redirect URI: `https://fxsbpreasbdalwthyzvk.supabase.co/auth/v1/callback`. Google sends the user there. Supabase then returns the browser to the app.
5. In the Supabase dashboard, Authentication → URL configuration, set Site URL to `https://its-epks.vercel.app`. Add these redirect URLs: `https://its-epks.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`.
6. Authentication → Providers → Google: turn it on and paste the client id and client secret. Leave the provider on. Item export to a person's own Drive uses a separate consent for `https://www.googleapis.com/auth/drive.file`. Do not add that scope here or to the sign-in request. Those steps are in `docs/item-export.md`.

## Phase 2, not applied

This release does not enable row level security, and it does not revoke the anon grants already on the inventory tables. Doing that now would stop the deployed app, which still uses the anon key. `app_users` is new: anon has no access to it, and a signed-in user can read it but cannot write it except through `ensure_app_user` and `set_app_user`. `qbo_connection`, `qbo_sync_cursor`, and `ebay_connection` stay service-role only.

After this version is deployed, a follow-up can turn policies on. Ask before applying it. The plan is: approved users can read; staff and admin can write; settings, users, and integrations stay admin-only; anon writes are revoked; the QuickBooks and eBay token tables stay service-role only. When that follow-up is deployed, Vercel Deployment Protection can be turned off. Until then, leave Deployment Protection on, because the anon key can still change inventory.
