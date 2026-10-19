import { requestToken, TokenRequestError } from "@/lib/ebay/auth";
import { apiBase, tokenUrl, type EbayEnvironment } from "@/lib/ebay/endpoints";
import {
  quotesFromBrowse,
  quotesFromInsights,
  type QuoteDraft,
} from "@/lib/pricing/quotes";

export const EBAY_APP_SCOPE = "https://api.ebay.com/oauth/api_scope";
export const EBAY_BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.browse";
export const EBAY_INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

const LISTED_LIMIT = 25;

export type ProviderStatus = "ran" | "skipped" | "error";

export type ProviderReport = {
  source: "ebay_listed" | "ebay_sold" | "brokerbin";
  label: string;
  status: ProviderStatus;
  count: number;
  message: string | null;
  quotes: QuoteDraft[];
};

export type PricingEnv = {
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_ENVIRONMENT?: string;
  EBAY_INSIGHTS_ENABLED?: string;
  BROKERBIN_API_KEY?: string;
};

export async function collectPriceQuotes(input: {
  query: string;
  env: PricingEnv;
  fetchImpl?: typeof fetch;
}): Promise<ProviderReport[]> {
  const query = input.query.trim();
  const [listed, sold, broker] = await Promise.all([
    ebayListed(query, input.env, input.fetchImpl),
    ebaySold(query, input.env, input.fetchImpl),
    brokerBin(query, input.env),
  ]);
  return [listed, sold, broker];
}

async function ebayListed(query: string, env: PricingEnv, fetchImpl?: typeof fetch): Promise<ProviderReport> {
  const base = {
    source: "ebay_listed" as const,
    label: "eBay listed",
    count: 0,
    quotes: [] as QuoteDraft[],
  };
  if (!query) {
    return { ...base, status: "error", message: "Add a part number or model before updating pricing." };
  }
  const ready = ebayReady(env);
  if (!ready.ok) return { ...base, status: "error", message: ready.message };
  try {
    const token = await applicationToken(ready, `${EBAY_APP_SCOPE} ${EBAY_BROWSE_SCOPE}`, fetchImpl);
    const url = new URL(`${apiBase(ready.environment)}/buy/browse/v1/item_summary/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(LISTED_LIMIT));
    const response = await ebayGet(url, token, fetchImpl);
    if (!response.ok) {
      return { ...base, status: "error", message: await ebayFailure("eBay listed", response) };
    }
    const quotes = quotesFromBrowse(await response.json());
    return { ...base, status: "ran", count: quotes.length, quotes, message: null };
  } catch (error) {
    return { ...base, status: "error", message: providerError("eBay listed", error) };
  }
}

async function ebaySold(query: string, env: PricingEnv, fetchImpl?: typeof fetch): Promise<ProviderReport> {
  const base = {
    source: "ebay_sold" as const,
    label: "eBay sold",
    count: 0,
    quotes: [] as QuoteDraft[],
  };
  if (env.EBAY_INSIGHTS_ENABLED?.trim().toLowerCase() !== "true") {
    return {
      ...base,
      status: "skipped",
      message: "Marketplace Insights is off. Set EBAY_INSIGHTS_ENABLED=true after eBay approves it.",
    };
  }
  if (!query) {
    return { ...base, status: "error", message: "Add a part number or model before updating pricing." };
  }
  const ready = ebayReady(env);
  if (!ready.ok) return { ...base, status: "error", message: ready.message };
  try {
    const token = await applicationToken(ready, EBAY_INSIGHTS_SCOPE, fetchImpl);
    const url = new URL(`${apiBase(ready.environment)}/buy/marketplace_insights/v1_beta/item_sales/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(LISTED_LIMIT));
    const response = await ebayGet(url, token, fetchImpl);
    if (!response.ok) {
      return { ...base, status: "error", message: await ebayFailure("eBay sold", response) };
    }
    const quotes = quotesFromInsights(await response.json());
    return { ...base, status: "ran", count: quotes.length, quotes, message: null };
  } catch (error) {
    return { ...base, status: "error", message: providerError("eBay sold", error) };
  }
}

function brokerBin(query: string, env: PricingEnv): ProviderReport {
  const base = {
    source: "brokerbin" as const,
    label: "BrokerBin",
    count: 0,
    quotes: [] as QuoteDraft[],
  };
  if (!env.BROKERBIN_API_KEY?.trim()) {
    return { ...base, status: "skipped", message: "BrokerBin is off until BROKERBIN_API_KEY is set." };
  }
  if (!query) {
    return { ...base, status: "error", message: "Add a part number or model before updating pricing." };
  }
  return {
    ...base,
    status: "ran",
    message: "BrokerBin lookup is not connected yet.",
  };
}

type EbayReady = { ok: true; clientId: string; clientSecret: string; environment: EbayEnvironment } | { ok: false; message: string };

function ebayReady(env: PricingEnv): EbayReady {
  const clientId = env.EBAY_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim() ?? "";
  const environment = env.EBAY_ENVIRONMENT?.trim() ?? "";
  if (!clientId || !clientSecret) return { ok: false, message: "Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET." };
  if (environment !== "sandbox" && environment !== "production") {
    return { ok: false, message: "Set EBAY_ENVIRONMENT to sandbox or production." };
  }
  return { ok: true, clientId, clientSecret, environment };
}

async function applicationToken(
  ready: Extract<EbayReady, { ok: true }>,
  scope: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  const tokens = await requestToken({
    config: { clientId: ready.clientId, clientSecret: ready.clientSecret },
    tokenEndpoint: tokenUrl(ready.environment),
    fetchImpl,
    fields: { grant_type: "client_credentials", scope },
  });
  return tokens.access_token;
}

async function ebayGet(url: URL, token: string, fetchImpl?: typeof fetch): Promise<Response> {
  const fetchCall = fetchImpl ?? fetch;
  return fetchCall(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
    signal: AbortSignal.timeout(30_000),
  });
}

async function ebayFailure(label: string, response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { errors?: { message?: string }[] } | null;
  const detail = body?.errors?.find((error) => error.message)?.message;
  return detail ? `${label} failed (${response.status}): ${detail}` : `${label} failed (${response.status}).`;
}

function providerError(label: string, error: unknown): string {
  if (error instanceof TokenRequestError) {
    return `${label} token failed (${error.status || "network"}): ${error.message}`;
  }
  return error instanceof Error ? `${label} failed: ${error.message}` : `${label} failed.`;
}
