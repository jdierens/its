export type EbayEnvironment = "sandbox" | "production";

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
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
