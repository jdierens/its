import { randomUUID } from "node:crypto";

export type EbayCallResult<T> =
  | {
      ok: true;
      status: number;
      body: T;
      rlogid: string | null;
      requestId: string | null;
    }
  | {
      ok: false;
      status: number;
      message: string;
      rlogid: string | null;
      requestId: string | null;
    };

export async function ebayRead<T>(input: {
  url: string;
  token: string;
  refresh?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  marketplace?: boolean;
}): Promise<EbayCallResult<T>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let token = input.token;
  let refreshed = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestId = randomUUID();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-EBAY-C-REQUEST-ID": requestId,
    };
    if (input.marketplace) headers["X-EBAY-C-MARKETPLACE-ID"] = "EBAY_US";

    const response = await fetchImpl(input.url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    const ids = {
      rlogid: response.headers.get("rlogid"),
      requestId: response.headers.get("x-ebay-c-request-id") || requestId,
    };
    const body = (await response.json().catch(() => null)) as T | null;

    if (response.status === 401 && input.refresh && !refreshed) {
      refreshed = true;
      token = await input.refresh();
      continue;
    }

    if (!response.ok || body === null) {
      return {
        ok: false,
        status: response.status,
        message: errorMessage(body, response.status),
        rlogid: ids.rlogid,
        requestId: ids.requestId,
      };
    }

    return {
      ok: true,
      status: response.status,
      body,
      rlogid: ids.rlogid,
      requestId: ids.requestId,
    };
  }

  return {
    ok: false,
    status: 401,
    message: "eBay rejected the access token.",
    rlogid: null,
    requestId: null,
  };
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "errors" in body) {
    const errors = (body as { errors?: { message?: string; longMessage?: string }[] }).errors;
    const first = errors?.[0];
    if (first?.longMessage) return first.longMessage;
    if (first?.message) return first.message;
  }
  return `eBay request failed (${status}).`;
}
