import { decodedBase64Bytes, type LensImage } from "@/lib/lens/images";
import { lensResponseSchema } from "@/lib/lens/parse";

export const GEMINI_TIMEOUT_MS = 50_000;
export const GEMINI_MAX_OUTPUT_TOKENS = 1024;

export function geminiThinkingLevel(model: string): "minimal" | "low" {
  const name = model.toLowerCase();
  if (name.includes("3.8") || name.includes("gemini-4")) return "low";
  return "minimal";
}

export function geminiDeveloperUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export function geminiRequestBody(input: { model: string; prompt: string; images: LensImage[] }): Record<string, unknown> {
  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: input.prompt },
          ...input.images.map((image) => ({
            inline_data: { mime_type: image.mimeType, data: image.data },
          })),
        ],
      },
    ],
    generationConfig: {
      thinkingConfig: { thinkingLevel: geminiThinkingLevel(input.model) },
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      responseFormat: {
        text: {
          mimeType: "APPLICATION_JSON",
          schema: lensResponseSchema(),
        },
      },
    },
  };
}

export function publicGeminiText(value: string, limit = 240): string {
  return value
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[key]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function keyLast4(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) return "";
  return trimmed.slice(-4);
}

const PROBE_HEADER_NAMES = ["content-type", "date", "server", "via", "x-goog-request-id", "x-request-id", "alt-svc"];

export function publicProbeHeaders(headers: { get(name: string): string | null }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of PROBE_HEADER_NAMES) {
    const value = headers.get(name);
    if (!value) continue;
    out[name] = publicGeminiText(value, 160);
  }
  return out;
}

export function geminiProbeBody(model: string): Record<string, unknown> {
  return {
    contents: [{ role: "user", parts: [{ text: "Reply with the single word ok." }] }],
    generationConfig: { thinkingConfig: { thinkingLevel: geminiThinkingLevel(model) }, maxOutputTokens: 16 },
  };
}

export type GeminiProbe = {
  host: string;
  googleStatus: number | null;
  latencyMs: number;
  errorName: string | null;
  message: string;
  headers: Record<string, string>;
  body: string;
};

export async function probeGemini(input: { apiKey: string; model: string }): Promise<GeminiProbe> {
  const started = Date.now();
  const url = geminiDeveloperUrl(input.model);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify(geminiProbeBody(input.model)),
      signal: AbortSignal.timeout(20_000),
    });
    const bodyText = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bodyText) as unknown;
    } catch {
      parsed = null;
    }
    return {
      host: new URL(url).host,
      googleStatus: response.status,
      latencyMs: Date.now() - started,
      errorName: null,
      message: response.ok ? "Google answered." : geminiHttpFailure(response.status, parsed),
      headers: publicProbeHeaders(response.headers),
      body: publicGeminiText(bodyText, 500),
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    return {
      host: new URL(url).host,
      googleStatus: null,
      latencyMs,
      errorName: error instanceof Error ? error.name : "Error",
      message: geminiThrownFailure(error, latencyMs),
      headers: {},
      body: "",
    };
  }
}

export type GeminiFailure = {
  name: string;
  message: string;
  causeName: string;
  causeCode: string;
  causeMessage: string;
};

export function geminiFailure(error: unknown): GeminiFailure {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  const message = error instanceof Error ? error.message : "";
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeName = cause && typeof cause === "object" && "name" in cause ? String((cause as { name: unknown }).name) : "";
  const causeCode = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code ?? "") : "";
  const causeMessage = cause instanceof Error ? cause.message : "";
  return {
    name,
    message: publicGeminiText(message, 180),
    causeName,
    causeCode: publicGeminiText(causeCode, 80),
    causeMessage: publicGeminiText(causeMessage, 180),
  };
}

export function geminiThrownFailure(error: unknown, elapsedMs = 0, imageBytes?: number): string {
  const failure = geminiFailure(error);
  const detail = failureDetail(failure, elapsedMs, imageBytes);
  const kind = `${failure.name} ${failure.causeName} ${failure.causeCode} ${failure.causeMessage}`;
  if (/UND_ERR_CONNECT_TIMEOUT|ConnectTimeout/i.test(kind)) {
    return `Lens could not connect to Google (${detail}).`;
  }
  if (/UND_ERR_HEADERS_TIMEOUT|HeadersTimeout/i.test(kind)) {
    return `Lens got no response headers from Google (${detail}).`;
  }
  if (/UND_ERR_BODY_TIMEOUT|BodyTimeout/i.test(kind)) {
    return `Lens lost Google's response while reading it (${detail}).`;
  }
  if (failure.name === "TimeoutError" || failure.causeName === "TimeoutError") {
    return `Lens timed out waiting for Google (${detail}).`;
  }
  if (failure.name === "AbortError" || failure.causeName === "AbortError") {
    return `Lens aborted the Google request (${detail}).`;
  }
  const safe = failure.message;
  if (/header/i.test(safe)) return "The Gemini API key could not be sent. Remove any spaces or line breaks from it.";
  if (safe) return `Lens could not reach Google: ${safe} (${detail}).`;
  return `Lens could not reach Google (${detail}).`;
}

function failureDetail(failure: GeminiFailure, elapsedMs: number, imageBytes?: number): string {
  const cause = [failure.causeName, failure.causeCode, failure.causeMessage].filter(Boolean).join(" ");
  return [
    `${Math.max(0, Math.round(elapsedMs))}ms`,
    failure.name || "Error",
    failure.message,
    cause ? `cause ${cause}` : "",
    imageBytes != null ? `${imageBytes} image bytes` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export function geminiHttpFailure(status: number, body: unknown): string {
  const google = googleError(body);
  const blob = `${google.status} ${google.message}`.toLowerCase();
  if (status === 429 || blob.includes("quota") || blob.includes("rate limit") || blob.includes("resource_exhausted")) {
    if (blob.includes("billing") || blob.includes("bill")) {
      return "Gemini has no quota for this AI Studio project. Enable billing on that project, or wait and try again.";
    }
    return "Lens is busy. Gemini quota or rate limit was reached. Wait a moment and try again.";
  }
  if (status === 401 || blob.includes("api key") || blob.includes("api_key_invalid")) {
    return "The Gemini API key was rejected. Use an AI Studio key for the Gemini Developer API.";
  }
  if (status === 403) {
    return google.message ? `Gemini refused the key: ${google.message}` : "Gemini refused the API key.";
  }
  if (status === 404 || (blob.includes("model") && blob.includes("not found"))) {
    return google.message ? `Gemini model was not found: ${google.message}` : "Gemini model was not found.";
  }
  if (status === 413 || blob.includes("too large") || blob.includes("payload")) {
    return "Those photos are too large for Google.";
  }
  if (google.message) return `Gemini returned ${status}: ${google.message}`;
  return `Gemini returned ${status}.`;
}

export type GeminiUsage = {
  promptTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
};

export type GeminiResult = {
  raw: unknown;
  elapsedMs: number;
  promptChars: number;
  thinkingLevel: string;
  usage: GeminiUsage;
};

export class GeminiRequestError extends Error {
  readonly elapsedMs: number;
  readonly promptChars: number;
  readonly thinkingLevel: string;
  readonly usage: GeminiUsage;

  constructor(message: string, meta: Omit<GeminiResult, "raw">) {
    super(message);
    this.name = "GeminiRequestError";
    this.elapsedMs = meta.elapsedMs;
    this.promptChars = meta.promptChars;
    this.thinkingLevel = meta.thinkingLevel;
    this.usage = meta.usage;
  }
}

export async function identifyWithGemini(input: {
  apiKey: string;
  model: string;
  prompt: string;
  images: LensImage[];
}): Promise<GeminiResult> {
  const started = Date.now();
  const imageBytes = input.images.reduce((sum, image) => sum + decodedBase64Bytes(image.data), 0);
  let response: Response;
  try {
    response = await fetch(geminiDeveloperUrl(input.model), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify(geminiRequestBody({ model: input.model, prompt: input.prompt, images: input.images })),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const failure = geminiFailure(error);
    lensLog({
      event: "gemini",
      model: input.model,
      region: process.env.VERCEL_REGION || "",
      imageCount: input.images.length,
      imageBytes,
      elapsedMs,
      googleStatus: "",
      errorName: failure.name,
      causeName: failure.causeName,
      causeCode: failure.causeCode,
      causeMessage: failure.causeMessage,
    });
    throw new GeminiRequestError(geminiThrownFailure(error, elapsedMs, imageBytes), {
      elapsedMs,
      promptChars: input.prompt.length,
      thinkingLevel: geminiThinkingLevel(input.model),
      usage: { promptTokens: null, outputTokens: null, thoughtTokens: null },
    });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const failure = geminiFailure(error);
    lensLog({
      event: "gemini",
      model: input.model,
      region: process.env.VERCEL_REGION || "",
      imageCount: input.images.length,
      imageBytes,
      elapsedMs,
      googleStatus: response.status,
      errorName: failure.name,
      causeName: failure.causeName,
      causeCode: failure.causeCode,
      causeMessage: failure.causeMessage,
    });
    throw new GeminiRequestError(geminiThrownFailure(error, elapsedMs, imageBytes), {
      elapsedMs,
      promptChars: input.prompt.length,
      thinkingLevel: geminiThinkingLevel(input.model),
      usage: { promptTokens: null, outputTokens: null, thoughtTokens: null },
    });
  }
  const usage = geminiUsage(body);
  const meta = {
    elapsedMs: Date.now() - started,
    promptChars: input.prompt.length,
    thinkingLevel: geminiThinkingLevel(input.model),
    usage,
  };
  if (!response.ok) {
    lensLog({
      event: "gemini",
      model: input.model,
      region: process.env.VERCEL_REGION || "",
      imageCount: input.images.length,
      imageBytes,
      elapsedMs: Date.now() - started,
      googleStatus: response.status,
      errorName: "",
      causeName: "",
      causeCode: "",
      causeMessage: publicGeminiText(geminiHttpFailure(response.status, body), 180),
      ...usage,
    });
    throw new GeminiRequestError(geminiHttpFailure(response.status, body), meta);
  }
  const text = readingText(body);
  const reason = text ? "" : finishReason(body);
  lensLog({
    event: "gemini",
    model: input.model,
    region: process.env.VERCEL_REGION || "",
    imageCount: input.images.length,
    imageBytes,
    elapsedMs: Date.now() - started,
    googleStatus: response.status,
    errorName: "",
    causeName: "",
    causeCode: "",
    causeMessage: reason,
    ...usage,
  });
  if (!text) {
    throw new GeminiRequestError(reason ? `Lens could not read those photos (${reason}).` : "Lens could not read those photos.", meta);
  }
  try {
    return { raw: JSON.parse(text) as unknown, ...meta };
  } catch {
    throw new GeminiRequestError("Lens could not read those photos.", meta);
  }
}

export function lensLog(fields: Record<string, string | number | null>): void {
  console.log(JSON.stringify({ source: "lens", ...fields }));
}

export function geminiUsage(payload: unknown): GeminiUsage {
  if (!payload || typeof payload !== "object") return { promptTokens: null, outputTokens: null, thoughtTokens: null };
  const usage = (payload as { usageMetadata?: unknown }).usageMetadata;
  if (!usage || typeof usage !== "object") return { promptTokens: null, outputTokens: null, thoughtTokens: null };
  const record = usage as { promptTokenCount?: unknown; candidatesTokenCount?: unknown; thoughtsTokenCount?: unknown };
  return {
    promptTokens: numberOrNull(record.promptTokenCount),
    outputTokens: numberOrNull(record.candidatesTokenCount),
    thoughtTokens: numberOrNull(record.thoughtsTokenCount),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function googleError(body: unknown): { status: string; message: string } {
  if (!body || typeof body !== "object") return { status: "", message: "" };
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return { status: "", message: "" };
  const record = error as { status?: unknown; message?: unknown };
  return {
    status: typeof record.status === "string" ? record.status : "",
    message: typeof record.message === "string" ? publicGeminiText(record.message) : "",
  };
}

function readingText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return "";
  const first = candidates[0];
  if (!first || typeof first !== "object") return "";
  const parts = (first as { content?: { parts?: unknown } }).content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as { text?: unknown; thought?: unknown };
      if (record.thought === true) return "";
      return typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

function finishReason(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== "object") return "";
  const reason = (candidates[0] as { finishReason?: unknown }).finishReason;
  return typeof reason === "string" ? publicGeminiText(reason) : "";
}
