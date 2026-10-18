const DISCOVERY_URL = {
  sandbox: "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration",
  production: "https://developer.api.intuit.com/.well-known/openid_configuration",
} as const;

const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_TOKEN_ATTEMPTS = 3;

export const FALLBACK_ENDPOINTS = {
  authorization_endpoint: "https://appcenter.intuit.com/connect/oauth2",
  token_endpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revocation_endpoint: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
};

export type QboEnvironmentName = keyof typeof DISCOVERY_URL;

export type QboEndpoints = {
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
};

export class TokenRequestError extends Error {
  readonly code: string | null;
  readonly status: number;
  readonly intuitTid: string | null;

  constructor(message: string, code: string | null, status: number, intuitTid: string | null) {
    super(message);
    this.name = "TokenRequestError";
    this.code = code;
    this.status = status;
    this.intuitTid = intuitTid;
  }
}

export class ReconnectError extends Error {
  readonly intuitTid: string | null;

  constructor(intuitTid: string | null = null) {
    super("QuickBooks needs to be reconnected");
    this.name = "ReconnectError";
    this.intuitTid = intuitTid;
  }
}

export type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
};

type TokenBody = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
};

const cache = new Map<QboEnvironmentName, { expiresAt: number; endpoints: QboEndpoints }>();

export function clearDiscoveryCache(): void {
  cache.clear();
}

export async function discoverEndpoints(
  environment: QboEnvironmentName,
  fetchImpl: typeof fetch = fetch,
): Promise<QboEndpoints> {
  const cached = cache.get(environment);
  if (cached && cached.expiresAt > Date.now()) return cached.endpoints;

  try {
    const response = await fetchImpl(DISCOVERY_URL[environment], {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return FALLBACK_ENDPOINTS;
    const body = (await response.json()) as Partial<QboEndpoints>;
    const endpoints: QboEndpoints = {
      authorization_endpoint: httpsUrl(body.authorization_endpoint) ?? FALLBACK_ENDPOINTS.authorization_endpoint,
      token_endpoint: httpsUrl(body.token_endpoint) ?? FALLBACK_ENDPOINTS.token_endpoint,
      revocation_endpoint: httpsUrl(body.revocation_endpoint) ?? FALLBACK_ENDPOINTS.revocation_endpoint,
    };
    cache.set(environment, { expiresAt: Date.now() + CACHE_MS, endpoints });
    return endpoints;
  } catch {
    return FALLBACK_ENDPOINTS;
  }
}

export async function requestToken(input: {
  config: { clientId: string; clientSecret: string; environment: QboEnvironmentName };
  fields: Record<string, string>;
  fetchImpl?: typeof fetch;
  backoffMs?: number;
  tokenEndpoint?: string;
}): Promise<TokenSet> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = input.tokenEndpoint ?? (await discoverEndpoints(input.config.environment, fetchImpl)).token_endpoint;
  const authorization = `Basic ${Buffer.from(`${input.config.clientId}:${input.config.clientSecret}`).toString("base64")}`;
  let lastError: TokenRequestError | null = null;

  for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(input.fields),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      lastError = new TokenRequestError(
        error instanceof Error ? error.message : "QuickBooks token request failed.",
        null,
        0,
        null,
      );
      if (attempt < MAX_TOKEN_ATTEMPTS) {
        await sleep(waitMs(attempt, input.backoffMs));
        continue;
      }
      throw lastError;
    }

    const intuitTid = response.headers.get("intuit_tid");
    const body = (await response.json().catch(() => null)) as TokenBody | null;
    const code = typeof body?.error === "string" ? body.error : null;
    if (code === "invalid_grant" || code === "invalid_client") {
      throw new TokenRequestError(body?.error_description || code, code, response.status, intuitTid);
    }

    const transient = response.status === 429 || response.status >= 500;
    if (!response.ok || !body?.access_token || !body.refresh_token || !body.expires_in) {
      lastError = new TokenRequestError(
        body?.error_description || body?.error || `QuickBooks token request failed (${response.status}).`,
        code,
        response.status,
        intuitTid,
      );
      if (transient && attempt < MAX_TOKEN_ATTEMPTS) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : waitMs(attempt, input.backoffMs);
        await sleep(wait);
        continue;
      }
      throw lastError;
    }

    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_in: body.expires_in,
      x_refresh_token_expires_in: body.x_refresh_token_expires_in,
    };
  }

  throw lastError ?? new TokenRequestError("QuickBooks token request failed.", null, 0, null);
}

export function isExpiredAccessToken(status: number, code: string | null, message: string): boolean {
  return status === 401 || code === "3200" || /authenticationfailed/i.test(message) || /token expired/i.test(message);
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^https:\/\//.test(value)) return null;
  return value;
}

function waitMs(attempt: number, backoffMs: number | undefined): number {
  if (backoffMs !== undefined) return backoffMs;
  return 300 * attempt;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
