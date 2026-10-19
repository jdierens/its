import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  createItemsSpreadsheet,
  folderIdFrom,
  readGoogleExport,
  serviceAccountAssertion,
  type GoogleExportConfig,
} from "./sheets.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const email = "its-export@example.iam.gserviceaccount.com";

function config(): GoogleExportConfig {
  return {
    account: { clientEmail: email, privateKey: pem, tokenUri: "https://oauth2.googleapis.com/token" },
    folderId: "folder123",
  };
}

test("a folder id is accepted as an id or a Drive URL", () => {
  assert.equal(folderIdFrom(" folder123 "), "folder123");
  assert.equal(
    folderIdFrom("https://drive.google.com/drive/folders/abc_DEF-123?usp=sharing"),
    "abc_DEF-123",
  );
  assert.equal(folderIdFrom("https://example.com/not-a-folder"), null);
  assert.equal(folderIdFrom(""), null);
});

test("the Google option is not configured until both server env vars parse", () => {
  assert.equal(readGoogleExport({}), null);
  assert.equal(
    readGoogleExport({
      GOOGLE_EXPORT_FOLDER_ID: "folder123",
      GOOGLE_SERVICE_ACCOUNT_JSON: "not json",
    }),
    null,
  );
  const parsed = readGoogleExport({
    GOOGLE_EXPORT_FOLDER_ID: "https://drive.google.com/drive/folders/folder123",
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: email,
      private_key: pem,
      token_uri: "https://oauth2.googleapis.com/token",
    }),
  });
  assert.equal(parsed?.folderId, "folder123");
  assert.equal(parsed?.account.clientEmail, email);
});

test("the service account assertion asks for Sheets and Drive and is signed", () => {
  const jwt = serviceAccountAssertion(config().account, 1_700_000_000);
  const [header, payload, signature] = jwt.split(".");
  assert.ok(header && payload && signature);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    iss: string;
    scope: string;
    aud: string;
  };
  assert.equal(claims.iss, email);
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.match(claims.scope, /spreadsheets/);
  assert.match(claims.scope, /auth\/drive$/);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  verifier.end();
  assert.equal(verifier.verify(publicKey, signature, "base64url"), true);
});

test("creating a sheet puts it in the shared folder, writes rows, and freezes the header", async () => {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, body });
    if (url.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "ya29.test" }), { status: 200 });
    }
    if (url.includes("drive/v3/files")) {
      return new Response(JSON.stringify({ id: "sheet1", webViewLink: "https://docs.google.com/spreadsheets/d/sheet1/edit" }), {
        status: 200,
      });
    }
    return new Response("{}", { status: 200 });
  };

  const result = await createItemsSpreadsheet({
    config: config(),
    title: "ITS items export 2026-10-19 11:00",
    headers: ["SKU", "Taxonomy"],
    rows: [["107075", "MEM"]],
    now: new Date("2026-10-19T18:00:00.000Z"),
    fetch: fetchImpl,
  });

  assert.equal(result.url, "https://docs.google.com/spreadsheets/d/sheet1/edit");
  const drive = calls.find((call) => call.url.includes("drive/v3/files"));
  assert.match(drive?.url ?? "", /supportsAllDrives=true/);
  const created = JSON.parse(drive?.body ?? "{}") as { name: string; parents: string[]; mimeType: string };
  assert.equal(created.name, "ITS items export 2026-10-19 11:00");
  assert.deepEqual(created.parents, ["folder123"]);
  assert.equal(created.mimeType, "application/vnd.google-apps.spreadsheet");

  const values = calls.find((call) => call.url.includes("/values/"));
  assert.match(values?.url ?? "", /valueInputOption=RAW/);
  const written = JSON.parse(values?.body ?? "{}") as { values: string[][] };
  assert.deepEqual(written.values, [
    ["SKU", "Taxonomy"],
    ["107075", "MEM"],
  ]);

  const freeze = calls.find((call) => call.url.includes(":batchUpdate"));
  const request = JSON.parse(freeze?.body ?? "{}") as {
    requests: { updateSheetProperties: { properties: { gridProperties: { frozenRowCount: number } } } }[];
  };
  assert.equal(request.requests[0]?.updateSheetProperties.properties.gridProperties.frozenRowCount, 1);
});
