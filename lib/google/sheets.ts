import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
].join(" ");

export type ServiceAccount = {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
};

export type GoogleExportConfig = {
  account: ServiceAccount;
  folderId: string;
};

export function folderIdFrom(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (fromUrl?.[1]) return fromUrl[1];
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  return null;
}

export function readGoogleExport(env: Record<string, string | undefined>): GoogleExportConfig | null {
  const folderId = folderIdFrom(env.GOOGLE_EXPORT_FOLDER_ID);
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ?? "";
  if (!folderId || !raw.startsWith("{")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { client_email?: unknown; private_key?: unknown; token_uri?: unknown };
  const clientEmail = typeof record.client_email === "string" ? record.client_email.trim() : "";
  const privateKey = typeof record.private_key === "string" ? record.private_key : "";
  const tokenUri = typeof record.token_uri === "string" && record.token_uri.startsWith("https://")
    ? record.token_uri
    : TOKEN_URL;
  if (!clientEmail.includes("@") || !privateKey.includes("PRIVATE KEY")) return null;
  return { account: { clientEmail, privateKey, tokenUri }, folderId };
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function serviceAccountAssertion(account: ServiceAccount, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: SCOPES,
      aud: account.tokenUri,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign(account.privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

type FetchLike = typeof fetch;

async function googleJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    let message = `Google returned HTTP ${response.status}.`;
    try {
      const body = JSON.parse(text) as { error?: { message?: string } | string };
      const detail = typeof body.error === "string" ? body.error : body.error?.message;
      if (detail && !detail.includes("PRIVATE KEY")) message = detail.slice(0, 300);
    } catch {
      if (text && !text.includes("PRIVATE KEY")) message = text.slice(0, 300);
    }
    throw new Error(message);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function accessToken(account: ServiceAccount, fetchImpl: FetchLike, nowSeconds: number): Promise<string> {
  const assertion = serviceAccountAssertion(account, nowSeconds);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetchImpl(account.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const token = await googleJson<{ access_token?: string }>(response);
  if (!token.access_token) throw new Error("Google did not return an access token.");
  return token.access_token;
}

export async function createItemsSpreadsheet(input: {
  config: GoogleExportConfig;
  title: string;
  headers: string[];
  rows: string[][];
  now?: Date;
  fetch?: FetchLike;
}): Promise<{ id: string; url: string }> {
  const fetchImpl = input.fetch ?? fetch;
  const now = input.now ?? new Date();
  const token = await accessToken(input.config.account, fetchImpl, Math.floor(now.getTime() / 1000));
  const title = input.title;
  const auth = { authorization: `Bearer ${token}` };

  const created = await fetchImpl(
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink",
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        name: title,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [input.config.folderId],
      }),
    },
  );
  const file = await googleJson<{ id?: string; webViewLink?: string }>(created);
  if (!file.id) throw new Error("Google did not return a spreadsheet id.");

  const range = encodeURIComponent("Sheet1!A1");
  const written = await fetchImpl(
    `https://sheets.googleapis.com/v4/spreadsheets/${file.id}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        range: "Sheet1!A1",
        majorDimension: "ROWS",
        values: [input.headers, ...input.rows],
      }),
    },
  );
  await googleJson(written);

  const frozen = await fetchImpl(
    `https://sheets.googleapis.com/v4/spreadsheets/${file.id}:batchUpdate`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
        ],
      }),
    },
  );
  await googleJson(frozen);

  return {
    id: file.id,
    url: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
  };
}
