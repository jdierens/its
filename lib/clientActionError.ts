/**
 * Failure text for a browser call to an app route.
 * Admins see the HTTP status, the API message, and the thrown error.
 * Other roles keep the API message when one was returned, and the fallback
 * when the response never parsed or the request did not finish.
 */

export function errorDetail(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (error.name && error.name !== "Error" && message && !message.includes(error.name)) {
      return `${error.name}: ${message}`;
    }
    return message || error.name || "";
  }
  if (typeof error === "string") return error.trim();
  return "";
}

export type ActionBody = {
  httpOk: boolean;
  status: number;
  serverMessage: string | null;
  transport: string | null;
  json: Record<string, unknown> | null;
};

export async function readActionBody(response: Response): Promise<ActionBody> {
  const status = response.status;
  let text = "";
  try {
    text = await response.text();
  } catch (error) {
    return {
      httpOk: false,
      status,
      serverMessage: null,
      transport: errorDetail(error) || "The response body could not be read.",
      json: null,
    };
  }
  const trimmed = text.trim();
  if (!trimmed) return { httpOk: response.ok, status, serverMessage: null, transport: null, json: null };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { httpOk: response.ok, status, serverMessage: null, transport: null, json: null };
    }
    const body = parsed as { message?: unknown; error?: unknown };
    const serverMessage =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : typeof body.error === "string" && body.error.trim()
          ? body.error.trim()
          : null;
    return { httpOk: response.ok, status, serverMessage, transport: null, json: body as Record<string, unknown> };
  } catch (error) {
    const detail = errorDetail(error);
    const snippet = trimmed.replace(/\s+/g, " ").slice(0, 160);
    const transport = [detail, snippet].filter(Boolean).join(" ");
    return {
      httpOk: false,
      status,
      serverMessage: null,
      transport: transport || "The response was not JSON.",
      json: null,
    };
  }
}

/**
 * An orders pull that finished after this click, from `/api/ebay/status` logs.
 * Used when the browser lost the POST response but the sync log already says ok.
 * Returns the log message, or null when nothing finished in this attempt.
 */
export function recentOrderPullSuccess(logs: unknown, startedAtMs: number): string | null {
  if (!Array.isArray(logs)) return null;
  let latest: { finished: number; status: string; message: string } | null = null;
  for (const row of logs) {
    if (!row || typeof row !== "object") continue;
    const log = row as { entity?: unknown; status?: unknown; finishedAt?: unknown; message?: unknown };
    if (log.entity !== "orders" || (log.status !== "ok" && log.status !== "error")) continue;
    const finished = typeof log.finishedAt === "string" ? Date.parse(log.finishedAt) : NaN;
    if (!Number.isFinite(finished) || finished + 5000 < startedAtMs) continue;
    const message = typeof log.message === "string" ? log.message.trim() : "";
    if (!latest || finished > latest.finished) latest = { finished, status: String(log.status), message };
  }
  if (!latest || latest.status !== "ok" || !latest.message) return null;
  return latest.message;
}

export async function recoverOrderPullMessage(startedAtMs: number, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetchImpl("/api/ebay/status", { cache: "no-store" });
    const body = await readActionBody(response);
    if (!body.httpOk) return null;
    return recentOrderPullSuccess(body.json?.logs, startedAtMs);
  } catch {
    return null;
  }
}

export function actionProblem(input: {
  detailed: boolean;
  fallback: string;
  status?: number;
  serverMessage?: string | null;
  transport?: string | null;
}): string {
  const server = input.serverMessage?.trim() ?? "";
  if (server) {
    if (!input.detailed || typeof input.status !== "number" || server.includes(`HTTP ${input.status}`)) return server;
    return `HTTP ${input.status}. ${server}`;
  }
  if (!input.detailed) return input.fallback;
  const transport = input.transport?.trim() ?? "";
  if (typeof input.status === "number" && transport && !transport.includes(`HTTP ${input.status}`)) {
    return `HTTP ${input.status}. ${transport}`;
  }
  if (transport) return transport;
  if (typeof input.status === "number") return `HTTP ${input.status}. ${input.fallback}`;
  return input.fallback;
}
