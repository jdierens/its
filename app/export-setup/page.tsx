export default function ExportSetupPage() {
  return (
    <main className="page">
      <p>
        CSV and Excel on the items page work without Google. Open in Google Sheets stays
        hidden until the server has <code>GOOGLE_OAUTH_CLIENT_ID</code> and{" "}
        <code>GOOGLE_OAUTH_CLIENT_SECRET</code>. Do not prefix those with{" "}
        <code>NEXT_PUBLIC_</code> and do not commit the secret. The full steps are in{" "}
        <code>docs/item-export.md</code>.
      </p>
      <ol className="setup-steps">
        <li>
          Apply <code>supabase/migrations/20261021170000_user_google_drive.sql</code> in the
          Supabase SQL editor. It is service role only.
        </li>
        <li>In the existing Google Cloud project, enable the Google Drive API and the Google Sheets API.</li>
        <li>
          Add the scope <code>https://www.googleapis.com/auth/drive.file</code> on the OAuth
          consent screen. Do not add it to the normal sign-in request.
        </li>
        <li>
          Add the redirect URI <code>https://its-epks.vercel.app/api/items/export/google/callback</code>{" "}
          on the existing web OAuth client, plus localhost if you test there.
        </li>
        <li>
          Set the two env vars in Vercel from that same client id and secret, then redeploy.
        </li>
      </ol>
      <p>
        The spreadsheet is created in the signed-in person&apos;s My Drive and named{" "}
        <code>ITS items export YYYY-MM-DD HH:mm</code> (Pacific time).
      </p>
    </main>
  );
}
