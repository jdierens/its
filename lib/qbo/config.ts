export const QBO_SCOPE = "com.intuit.quickbooks.accounting";
export const QBO_MINOR_VERSION = "75";
export const QBO_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QBO_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
export const QBO_STATE_COOKIE = "qbo_oauth_state";

const SANDBOX_API = "https://sandbox-quickbooks.api.intuit.com";
const PRODUCTION_API = "https://quickbooks.api.intuit.com";

export type QboEnvironment = "sandbox" | "production";

export type QboConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QboEnvironment;
};

export function readQboConfig(): QboConfig | null {
  const clientId = process.env.QBO_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.QBO_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = process.env.QBO_REDIRECT_URI?.trim() ?? "";
  const environment = process.env.QBO_ENVIRONMENT?.trim() ?? "";
  if (!clientId || !clientSecret || !redirectUri) return null;
  if (environment !== "sandbox" && environment !== "production") return null;
  return { clientId, clientSecret, redirectUri, environment };
}

export function apiBaseUrl(environment: QboEnvironment): string {
  return environment === "production" ? PRODUCTION_API : SANDBOX_API;
}

export function authorizeUrl(config: QboConfig, state: string): string {
  const url = new URL(QBO_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QBO_SCOPE);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export function basicAuthHeader(config: QboConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
}

export function companyUrl(
  config: QboConfig,
  realmId: string,
  path: string,
  query?: Record<string, string>,
): string {
  const url = new URL(`${apiBaseUrl(config.environment)}/v3/company/${encodeURIComponent(realmId)}/${path}`);
  url.searchParams.set("minorversion", QBO_MINOR_VERSION);
  if (query) {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  }
  return url.toString();
}
