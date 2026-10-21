import assert from "node:assert/strict";
import test from "node:test";
import {
  DRIVE_FILE_SCOPE,
  createUserSpreadsheet,
  exchangeGoogleCode,
  googleConsentUrl,
  readGoogleOAuth,
} from "./sheets.ts";

const config = { clientId: "client", clientSecret: "secret" };

test("Sheets stays hidden until both server env vars are set", () => {
  assert.equal(readGoogleOAuth({}), null);
  assert.equal(readGoogleOAuth({ GOOGLE_OAUTH_CLIENT_ID: "client" }), null);
  assert.equal(readGoogleOAuth({ GOOGLE_OAUTH_CLIENT_SECRET: "secret" }), null);
  assert.deepEqual(
    readGoogleOAuth({ GOOGLE_OAUTH_CLIENT_ID: " client ", GOOGLE_OAUTH_CLIENT_SECRET: " secret " }),
    config,
  );
});

test("consent asks only for drive.file and a refresh token", () => {
  const url = new URL(googleConsentUrl({
    config,
    redirectUri: "https://its-epks.vercel.app/api/items/export/google/callback",
    state: "state-1",
    loginHint: "jan@deepdiscountservers.com",
  }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), DRIVE_FILE_SCOPE);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("login_hint"), "jan@deepdiscountservers.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope")?.includes("spreadsheets"), false);
  assert.equal(url.searchParams.get("scope")?.endsWith("/drive"), false);
});

test("a code exchange requires the refresh token", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ access_token: "ya29" }), { status: 200 });
  await assert.rejects(
    () => exchangeGoogleCode({ config, code: "code", redirectUri: "https://example.com/callback", fetch: fetchImpl }),
    /refresh token/,
  );
});

test("a spreadsheet is created in the user's Drive with no parent folder", async () => {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, body });
    if (url.includes("drive/v3/files")) {
      return new Response(JSON.stringify({ id: "sheet1", webViewLink: "https://docs.google.com/spreadsheets/d/sheet1/edit" }), {
        status: 200,
      });
    }
    return new Response("{}", { status: 200 });
  };

  const result = await createUserSpreadsheet({
    accessToken: "ya29.test",
    title: "ITS items export 2026-10-19 11:00",
    headers: ["SKU", "Taxonomy"],
    rows: [["107075", "MEM"]],
    fetch: fetchImpl,
  });

  assert.equal(result.url, "https://docs.google.com/spreadsheets/d/sheet1/edit");
  const drive = calls.find((call) => call.url.includes("drive/v3/files"));
  assert.equal(drive?.url.includes("supportsAllDrives"), false);
  const created = JSON.parse(drive?.body ?? "{}") as { name: string; parents?: string[]; mimeType: string };
  assert.equal(created.name, "ITS items export 2026-10-19 11:00");
  assert.equal(created.parents, undefined);
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
