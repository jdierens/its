export type EbayEnvironment = "sandbox" | "production";

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
].join(" ");

export const EBAY_STATE_COOKIE = "ebay_oauth_state";

export function authBase(environment: EbayEnvironment): string {
  return environment === "production" ? "https://auth.ebay.com" : "https://auth.sandbox.ebay.com";
}

export function apiBase(environment: EbayEnvironment): string {
  return environment === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

export function apizBase(environment: EbayEnvironment): string {
  return environment === "production" ? "https://apiz.ebay.com" : "https://apiz.sandbox.ebay.com";
}

export function tokenUrl(environment: EbayEnvironment): string {
  return `${apiBase(environment)}/identity/v1/oauth2/token`;
}

export function authorizeEndpoint(environment: EbayEnvironment): string {
  return `${authBase(environment)}/oauth2/authorize`;
}

export function userUrl(environment: EbayEnvironment): string {
  return `${apizBase(environment)}/commerce/identity/v1/user/`;
}

export function privilegeUrl(environment: EbayEnvironment): string {
  return `${apiBase(environment)}/sell/account/v1/privilege`;
}

export function tradingUrl(environment: EbayEnvironment): string {
  return `${apiBase(environment)}/ws/api.dll`;
}

export function ordersUrl(environment: EbayEnvironment, filter: string, limit = 200, offset = 0): string {
  const url = new URL(`${apiBase(environment)}/sell/fulfillment/v1/order`);
  url.searchParams.set("filter", filter);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  return url.toString();
}

/** Finances transactions, including SHIPPING_LABEL debits. Host is apiz, not the sell host. */
export function financesTransactionsUrl(environment: EbayEnvironment, filter: string, limit = 200, offset = 0): string {
  const url = new URL(`${apizBase(environment)}/sell/finances/v1/transaction`);
  url.searchParams.set("filter", filter);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  return url.toString();
}
