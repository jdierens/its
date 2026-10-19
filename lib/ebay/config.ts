import { authorizeEndpoint, EBAY_SCOPES, type EbayEnvironment } from "@/lib/ebay/endpoints";

export type EbayConfig = {
  clientId: string;
  clientSecret: string;
  ruName: string;
  environment: EbayEnvironment;
};

export function readEbayConfig(): EbayConfig | null {
  const clientId = process.env.EBAY_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() ?? "";
  const ruName = process.env.EBAY_RU_NAME?.trim() ?? "";
  const environment = process.env.EBAY_ENVIRONMENT?.trim() ?? "";
  if (!clientId || !clientSecret || !ruName) return null;
  if (environment !== "sandbox" && environment !== "production") return null;
  return { clientId, clientSecret, ruName, environment };
}

export function readDeletionToken(): string | null {
  const token = process.env.EBAY_DEPLETION_VERIFICATION_TOKEN?.trim() ?? "";
  return token.length > 0 ? token : null;
}

export function authorizeUrl(config: EbayConfig, state: string): string {
  const url = new URL(authorizeEndpoint(config.environment));
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.ruName);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", EBAY_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}
