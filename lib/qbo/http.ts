const MIN_GAP_MS = 180;
const MAX_ATTEMPTS = 4;

let nextAllowedAt = 0;

export type QboResult<T> =
  | { ok: true; status: number; data: T; intuitTid: string | null }
  | { ok: false; status: number; message: string; code: string | null; intuitTid: string | null };

export async function qboRequest<T>(options: {
  method: "GET" | "POST";
  url: string;
  token: string;
  body?: unknown;
  refresh?: () => Promise<string>;
  gapMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<QboResult<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const gapMs = options.gapMs ?? MIN_GAP_MS;
  let token = options.token;
  let authRetried = false;
  let last: QboResult<T> | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const now = Date.now();
    if (now < nextAllowedAt) await sleep(nextAllowedAt - now);
    nextAllowedAt = Date.now() + gapMs;

    let response: Response;
    try {
      response = await fetchImpl(options.url, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "QuickBooks request failed.";
      last = { ok: false, status: 0, message, code: null, intuitTid: null };
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt);
        continue;
      }
      return last;
    }

    const intuitTid = response.headers.get("intuit_tid");
    if (response.status === 429 && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * attempt;
      nextAllowedAt = Date.now() + wait;
      await sleep(wait);
      continue;
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const fault = readFault(data);
      if (
        !authRetried &&
        options.refresh &&
        isExpiredAccessToken(response.status, fault.code, fault.message)
      ) {
        authRetried = true;
        token = await options.refresh();
        continue;
      }
      return {
        ok: false,
        status: response.status,
        message: fault.message || `QuickBooks request failed (${response.status}).`,
        code: fault.code,
        intuitTid,
      };
    }
    return { ok: true, status: response.status, data: data as T, intuitTid };
  }

  return last ?? { ok: false, status: 429, message: "QuickBooks rate limit persisted.", code: "429", intuitTid: null };
}

export function readFault(body: unknown): { message: string; code: string | null } {
  if (!body || typeof body !== "object") {
    return { message: "QuickBooks request failed.", code: null };
  }
  const record = body as {
    Fault?: { Error?: unknown };
    error_description?: unknown;
    error?: unknown;
  };
  const errors = record.Fault?.Error;
  const first = Array.isArray(errors) ? errors[0] : errors;
  if (first && typeof first === "object") {
    const error = first as { Message?: unknown; Detail?: unknown; code?: unknown };
    const message = [error.Message, error.Detail]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" ");
    return {
      message: message || "QuickBooks request failed.",
      code: typeof error.code === "string" ? error.code : null,
    };
  }
  if (typeof record.error_description === "string") {
    return {
      message: record.error_description,
      code: typeof record.error === "string" ? record.error : null,
    };
  }
  return { message: "QuickBooks request failed.", code: null };
}

export function isStaleSyncToken(code: string | null, message: string): boolean {
  return code === "5010" || /stale object/i.test(message);
}

function isExpiredAccessToken(status: number, code: string | null, message: string): boolean {
  return status === 401 || code === "3200" || /authenticationfailed/i.test(message) || /token expired/i.test(message);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
