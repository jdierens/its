const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Files this app creates. Not added to the normal sign-in request. */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

type FetchLike = typeof fetch;

export function readGoogleOAuth(env: Record<string, string | undefined>): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function googleConsentUrl(input: {
  config: GoogleOAuthConfig;
  redirectUri: string;
  state: string;
  loginHint?: string | null;
}): string {
  const params = new URLSearchParams({
    client_id: input.config.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: DRIVE_FILE_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: input.state,
  });
  const hint = input.loginHint?.trim();
  if (hint) params.set("login_hint", hint);
  return `${AUTH_URL}?${params.toString()}`;
}

async function googleJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    let message = `Google returned HTTP ${response.status}.`;
    try {
      const body = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string };
      const detail = body.error_description
        || (typeof body.error === "string" ? body.error : body.error?.message);
      if (detail) message = detail.slice(0, 300);
    } catch {
      if (text) message = text.slice(0, 300);
    }
    throw new Error(message);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function exchangeGoogleCode(input: {
  config: GoogleOAuthConfig;
  code: string;
  redirectUri: string;
  fetch?: FetchLike;
}): Promise<{ refreshToken: string; accessToken: string }> {
  const fetchImpl = input.fetch ?? fetch;
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const token = await googleJson<{ access_token?: string; refresh_token?: string }>(response);
  if (!token.access_token || !token.refresh_token) {
    throw new Error("Google did not return a refresh token. Try connecting again.");
  }
  return { refreshToken: token.refresh_token, accessToken: token.access_token };
}

export async function refreshGoogleAccess(input: {
  config: GoogleOAuthConfig;
  refreshToken: string;
  fetch?: FetchLike;
}): Promise<string> {
  const fetchImpl = input.fetch ?? fetch;
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: input.refreshToken,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const token = await googleJson<{ access_token?: string }>(response);
  if (!token.access_token) throw new Error("Google did not return an access token.");
  return token.access_token;
}

export async function createUserSpreadsheet(input: {
  accessToken: string;
  title: string;
  headers: string[];
  rows: string[][];
  fetch?: FetchLike;
}): Promise<{ id: string; url: string }> {
  const fetchImpl = input.fetch ?? fetch;
  const auth = { authorization: `Bearer ${input.accessToken}` };
  const created = await fetchImpl("https://www.googleapis.com/drive/v3/files?fields=id,webViewLink", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      name: input.title,
      mimeType: "application/vnd.google-apps.spreadsheet",
    }),
  });
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

  const frozen = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${file.id}:batchUpdate`, {
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
  });
  await googleJson(frozen);

  return {
    id: file.id,
    url: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
  };
}
