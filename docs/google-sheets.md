# Google Sheets export

Open in Google Sheets is documented in [item-export.md](item-export.md). CSV and Excel do not use Google.

The earlier service-account folder is not used. Do not set `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_EXPORT_FOLDER_ID` for this export. The spreadsheet is created in the signed-in person's own Drive with the `drive.file` scope, which is requested only when they choose Open in Google Sheets.
