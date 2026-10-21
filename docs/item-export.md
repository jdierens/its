# Item export

**Export** on the items page downloads the current filtered and sorted list, or the selected rows when any are selected. It includes every matching row, not only the page on screen. The server loads ids in pages of 200, then loads the item rows in batches.

CSV and Excel work with no Google setup. Both require an approved signed-in user, including when `AUTH_REQUIRED` is unset. `read_only` can export. A role without `can_view_financials` does not receive ecommerce price, market price, or MSRP. Today that capability is admin, staff, and `read_only`.

**All fields** exports SKU, name, description, taxonomy, item type, manufacturer, model, part number, OEM name, OEM part number, unit, condition, condition note, ECCN, US HTS, CCATS, COO, quantity, product URL, the three prices when allowed, and one column per attribute. Attributes from several taxonomies share a column when the name matches. **Visible columns** exports the columns on screen, in that order, and skips the photo. The Edited column is the item's `updated_at`.

CSV is UTF-8 with a byte order mark, quoted the way RFC 4180 describes, and uses CRLF. A cell that starts with `=`, `+`, `-`, `@`, a tab, or a carriage return is prefixed with an apostrophe so a spreadsheet does not treat it as a formula. Excel is an `.xlsx` file built in the app. On iPhone, iPad, and iPod the download is a normal form post so Safari saves the file. Android Chrome and desktop browsers save it from the response.

## Open in Google Sheets

The button is hidden until both server env vars below are set. It creates a spreadsheet in the signed-in person's own My Drive, freezes the header row, and opens it. The file is named `ITS items export YYYY-MM-DD HH:mm` in Pacific time. The only scope is `https://www.googleapis.com/auth/drive.file`. That scope is requested the first time someone uses this button. It is not added to the normal sign-in request or to the Supabase Google provider.

Do not commit the client secret, and do not prefix either variable with `NEXT_PUBLIC_`.

### What Jan sets up

CSV and Excel need none of this.

1. Apply `supabase/migrations/20261021170000_user_google_drive.sql` in the Supabase SQL editor on project `fxsbpreasbdalwthyzvk`. It creates `user_google_drive`, enables row level security, adds no policies, and grants the table only to `service_role`. Do not grant `anon` or `authenticated`. This migration is not applied yet. Sheets cannot store a refresh token until it is. CSV and Excel do not use the table.
2. In the Google Cloud project already used for ITS sign-in, enable the **Google Drive API** and the **Google Sheets API**.
3. On that project's OAuth consent screen, add the scope `https://www.googleapis.com/auth/drive.file` only. Do not add `https://www.googleapis.com/auth/spreadsheets` or `https://www.googleapis.com/auth/drive`. `drive.file` is a non-sensitive scope. If the screen is External and the app is in testing, the Google account must be a test user. Internal is enough for the `deepdiscountservers.com` Workspace.
4. On the existing **Web application** OAuth client, add these authorized redirect URIs. Do not remove the Supabase callback that sign-in already uses.
   - `https://its-epks.vercel.app/api/items/export/google/callback`
   - `http://localhost:3000/api/items/export/google/callback`
   - For a preview host, `https://<that-host>/api/items/export/google/callback`
5. Do not add `drive.file` under Supabase Authentication → Providers → Google. Leave the sign-in scopes as they are.
6. Set these in Vercel Production and in `.env.local`. Use the same web client id and secret already stored for Supabase Auth.
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
7. Redeploy. Until both variables are present, **Open in Google Sheets** stays hidden.

The first export sends that person through Google's consent screen (`prompt=consent`, `access_type=offline`, `include_granted_scopes=true`) and stores the refresh token in `user_google_drive`. Later exports reuse it. ITS can open only the files this app created.
