export default function ExportSetupPage() {
  return (
    <main className="page">
      <p>
        CSV download on the items page works without Google. Google Sheet needs a service
        account that can create spreadsheets in a Workspace folder. These values stay on the
        server. Do not prefix them with <code>NEXT_PUBLIC_</code> and do not commit the key.
      </p>
      <ol className="setup-steps">
        <li>Create a project in Google Cloud.</li>
        <li>Enable the Google Sheets API and the Google Drive API.</li>
        <li>Create a service account and download its JSON key.</li>
        <li>
          In Google Drive, signed in at deepdiscountservers.com, create a folder on a shared
          drive so new files are owned by the Workspace. Share that folder with the service
          account email as Editor.
        </li>
        <li>
          Set <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> to the full JSON key, and{" "}
          <code>GOOGLE_EXPORT_FOLDER_ID</code> to the folder id (the part after{" "}
          <code>/folders/</code> in the Drive URL). Add both in Vercel Production and in{" "}
          <code>.env.local</code>.
        </li>
      </ol>
      <p>
        Export then creates a spreadsheet named <code>ITS items export YYYY-MM-DD HH:mm</code>{" "}
        (Pacific time) in that folder, freezes the header row, and opens the link.
      </p>
    </main>
  );
}
