import { randomUUID } from "node:crypto";

const MAX_TOKEN_ATTEMPTS = 3;

export class TokenRequestError extends Error {
  readonly code: string | null;
  readonly status: number;
  readonly rlogid: string | null;
  readonly requestId: string | null;

  constructor(
    message: string,
    code: string | null,
    status: number,
    rlogid: string | null,
    requestId: string | null,
  ) {
    super(message);
    this.name = "TokenRequestError";
    this.code = code;
    this.status = status;
    this.rlogid = rlogid;
    this.requestId = requestId;
  }
}

export class ReconnectError extends Error {
  readonly rlogid: string | null;
  readonly requestId: string | null;

  constructor(rlogid: string | null = null, requestId: string | null = null) {
    super("eBay needs to be reconnected");
    this.name = "ReconnectError";
    this.rlogid = rlogid;
    this.requestId = requestId;
  }
}

export type TokenSet = {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  refresh_token_expires_in?: number;
};

type TokenBody = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
};

export async function requestToken(input: {
  config: { clientId: string; clientSecret: string };
  tokenEndpoint: string;
  fields: Record<string, string>;
  fetchImpl?: typeof fetch;
  backoffMs?: number;
}): Promise<TokenSet> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const authorization = `Basic ${Buffer.from(`${input.config.clientId}:${input.config.clientSecret}`).toString("base64")}`;
  const requireRefresh = input.fields.grant_type !== "refresh_token";
  let lastError: TokenRequestError | null = null;

  for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const requestId = randomUUID();
    let response: Response;
    try {
      response = await fetchImpl(input.tokenEndpoint, {
        method: "POST",
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "X-EBAY-C-REQUEST-ID": requestId,
        },
        body: new URLSearchParams(input.fields),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      lastError = new TokenRequestError(
        error instanceof Error ? error.message : "eBay token request failed.",
        null,
        0,
        null,
        requestId,
      );
      if (attempt < MAX_TOKEN_ATTEMPTS) {
        await sleep(waitMs(attempt, input.backoffMs));
        continue;
      }
      throw lastError;
    }

    const ids = ebayIds(response, requestId);
    const body = (await response.json().catch(() => null)) as TokenBody | null;
    const code = typeof body?.error === "string" ? body.error : null;
    if (code === "invalid_grant" || code === "invalid_client") {
      throw new TokenRequestError(body?.error_description || code, code, response.status, ids.rlogid, ids.requestId);
    }

    const transient = response.status === 429 || response.status >= 500;
    if (!response.ok || !body?.access_token || !body.expires_in || (requireRefresh && !body.refresh_token)) {
      lastError = new TokenRequestError(
        body?.error_description || body?.error || `eBay token request failed (${response.status}).`,
        code,
        response.status,
        ids.rlogid,
        ids.requestId,
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
      refresh_token: body.refresh_token ?? null,
      expires_in: body.expires_in,
      refresh_token_expires_in: body.refresh_token_expires_in,
    };
  }

  throw lastError ?? new TokenRequestError("eBay token request failed.", null, 0, null, null);
}

export function ebayIds(response: Response, sentRequestId: string | null): { rlogid: string | null; requestId: string | null } {
  return {
    rlogid: response.headers.get("rlogid"),
    requestId: response.headers.get("x-ebay-c-request-id") || sentRequestId,
  };
}

function waitMs(attempt: number, backoffMs: number | undefined): number {
  if (backoffMs !== undefined) return backoffMs;
  return 300 * attempt;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
