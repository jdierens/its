# Google Sheets export

CSV download works with no extra setup. Google Sheet needs the two server env vars below. Do not prefix them with `NEXT_PUBLIC_` and do not commit the key.

1. Create a project in Google Cloud.
2. Enable the Google Sheets API and the Google Drive API.
3. Create a service account and download its JSON key. The email is the `client_email` field.
4. In Google Drive, signed in at deepdiscountservers.com, create a folder on a shared drive so spreadsheets are owned by the Workspace. Share that folder with the service account email as Editor.
5. Add both variables in Vercel Production and in `.env.local`:
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: the full JSON key file.
   - `GOOGLE_EXPORT_FOLDER_ID`: the folder id, which is the path segment after `/folders/` in the Drive URL. A full folder URL is also accepted.

Export creates a spreadsheet named `ITS items export YYYY-MM-DD HH:mm` in Pacific time, inside that folder, freezes the header row, and opens the link in a new tab. The same steps are linked from the items page when Google is not configured.
