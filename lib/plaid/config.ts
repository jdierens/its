export type PlaidEnvironment = "sandbox" | "production";

export type PlaidConfig = {
  clientId: string;
  secret: string;
  environment: PlaidEnvironment;
  clientUserId: string;
  webhookUrl: string | null;
  redirectUri: string | null;
};

export const PLAID_HISTORY_DAYS = 90;
export const PLAID_CLIENT_NAME = "ITS";
export const PLAID_SYNC_COUNT = 100;
export const PLAID_SYNC_PAGE_LIMIT = 20;

const DEFAULT_CLIENT_USER_ID = "its";

export function readPlaidConfig(): PlaidConfig | null {
  const clientId = process.env.PLAID_CLIENT_ID?.trim() ?? "";
  const secret = process.env.PLAID_SECRET?.trim() ?? "";
  const environment = process.env.PLAID_ENV?.trim() ?? "";
  if (!clientId || !secret) return null;
  if (environment !== "sandbox" && environment !== "production") return null;
  const clientUserId = process.env.PLAID_CLIENT_USER_ID?.trim() || DEFAULT_CLIENT_USER_ID;
  return {
    clientId,
    secret,
    environment,
    clientUserId,
    webhookUrl: httpsUrl(process.env.PLAID_WEBHOOK_URL),
    redirectUri: redirectUri(process.env.PLAID_REDIRECT_URI, environment),
  };
}

export function plaidConfigProblems(): string[] {
  const problems: string[] = [];
  const webhook = process.env.PLAID_WEBHOOK_URL?.trim() ?? "";
  if (webhook && !httpsUrl(webhook)) {
    problems.push("PLAID_WEBHOOK_URL must start with https://. Webhooks were left off.");
  }
  const redirect = process.env.PLAID_REDIRECT_URI?.trim() ?? "";
  const environment = process.env.PLAID_ENV?.trim() ?? "";
  if (redirect && !redirectUri(redirect, environment === "production" ? "production" : "sandbox")) {
    problems.push(
      environment === "production"
        ? "PLAID_REDIRECT_URI must be an https URL with no query string."
        : "PLAID_REDIRECT_URI must be https, or http://localhost in sandbox, with no query string.",
    );
  }
  return problems;
}

function httpsUrl(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

function redirectUri(value: string | undefined, environment: PlaidEnvironment): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.search || url.hash) return null;
  if (url.protocol === "https:") return trimmed;
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:" && localhost && environment === "sandbox") return trimmed;
  return null;
}
