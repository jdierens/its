import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_GEMINI_MODEL } from "./config.ts";
import {
  GEMINI_MAX_OUTPUT_TOKENS,
  GEMINI_TIMEOUT_MS,
  geminiDeveloperUrl,
  geminiHttpFailure,
  geminiProbeBody,
  geminiRequestBody,
  geminiThinkingLevel,
  geminiFailure,
  geminiThrownFailure,
  geminiUsage,
  keyLast4,
  publicGeminiText,
  publicProbeHeaders,
} from "./gemini.ts";

test("Lens calls the Gemini Developer API, not Vertex", () => {
  const url = geminiDeveloperUrl("gemini-3.8-flash");
  assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(url.includes("aiplatform.googleapis.com"), false);
  const body = geminiRequestBody({
    model: DEFAULT_GEMINI_MODEL,
    prompt: "read the label",
    images: [{ mimeType: "image/jpeg", data: "aaaa" }],
  });
  const config = body.generationConfig as {
    thinkingConfig?: { thinkingLevel?: string };
    maxOutputTokens?: number;
    responseMimeType?: unknown;
    responseJsonSchema?: unknown;
    responseFormat?: { text?: { mimeType?: string; schema?: unknown } };
  };
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");
  assert.equal(geminiThinkingLevel(DEFAULT_GEMINI_MODEL), "minimal");
  assert.equal(geminiThinkingLevel("gemini-3.8-flash"), "low");
  assert.equal(config.thinkingConfig?.thinkingLevel, "minimal");
  assert.equal(config.maxOutputTokens, GEMINI_MAX_OUTPUT_TOKENS);
  assert.equal(GEMINI_MAX_OUTPUT_TOKENS <= 1024, true);
  assert.equal(config.responseFormat?.text?.mimeType, "APPLICATION_JSON");
  assert.ok(config.responseFormat?.text?.schema);
  assert.equal(config.responseJsonSchema, undefined);
  assert.equal(config.responseMimeType, undefined);
  assert.equal(GEMINI_TIMEOUT_MS <= 20_000, true);
});

test("only the AbortSignal timeout is reported as waiting on Google", () => {
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  const waiting = geminiThrownFailure(timeout, 20_012, 8123);
  assert.match(waiting, /timed out waiting for Google/);
  assert.match(waiting, /20012ms/);
  assert.match(waiting, /TimeoutError/);
  assert.match(waiting, /8123 image bytes/);

  const connect = new TypeError("fetch failed", {
    cause: Object.assign(new Error("Connect Timeout Error"), { name: "ConnectTimeoutError", code: "UND_ERR_CONNECT_TIMEOUT" }),
  });
  const connectText = geminiThrownFailure(connect, 420, 8000);
  assert.match(connectText, /could not connect to Google/);
  assert.match(connectText, /420ms/);
  assert.match(connectText, /ConnectTimeoutError/);
  assert.match(connectText, /UND_ERR_CONNECT_TIMEOUT/);
  assert.equal(/timed out waiting for Google/i.test(connectText), false);

  const body = new TypeError("fetch failed", {
    cause: Object.assign(new Error("terminated"), { name: "BodyTimeoutError", code: "UND_ERR_BODY_TIMEOUT" }),
  });
  const bodyText = geminiThrownFailure(body, 1100);
  assert.match(bodyText, /lost Google's response/);
  assert.equal(/timed out waiting for Google/i.test(bodyText), false);

  const headers = new TypeError("fetch failed", {
    cause: Object.assign(new Error("Headers Timeout Error"), { name: "HeadersTimeoutError", code: "UND_ERR_HEADERS_TIMEOUT" }),
  });
  assert.equal(/timed out waiting for Google/i.test(geminiThrownFailure(headers, 900)), false);

  const other = geminiThrownFailure(new Error("upstream timeout from the proxy"), 50);
  assert.equal(/timed out waiting for Google/i.test(other), false);
  assert.match(other, /upstream timeout from the proxy/);
  assert.match(other, /50ms/);

  const failed = geminiThrownFailure(new TypeError("fetch failed"), 15);
  assert.match(failed, /could not reach Google: fetch failed/);
  assert.match(failed, /TypeError/);
  assert.equal(/timed out waiting for Google/i.test(failed), false);
  assert.equal(geminiFailure(connect).causeCode, "UND_ERR_CONNECT_TIMEOUT");
  assert.deepEqual(geminiUsage({ usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, thoughtsTokenCount: 0 } }), {
    promptTokens: 20,
    outputTokens: 8,
    thoughtTokens: 0,
  });
});

test("Google errors name the cause and hide the key", () => {
  assert.equal(
    geminiHttpFailure(400, { error: { status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } }),
    "The Gemini API key was rejected. Use an AI Studio key for the Gemini Developer API.",
  );
  assert.equal(
    geminiHttpFailure(404, { error: { status: "NOT_FOUND", message: "models/gemini-1.5-flash is not found" } }),
    "Gemini model was not found: models/gemini-1.5-flash is not found",
  );
  assert.match(geminiHttpFailure(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }), /quota|busy/i);
  assert.match(
    geminiHttpFailure(429, { error: { message: "Billing account is not enabled for quota." } }),
    /billing/i,
  );
  assert.equal(geminiHttpFailure(413, { error: { message: "Request payload too large" } }), "Those photos are too large for Google.");
  assert.equal(publicGeminiText("bad key AIzaSyDUMMYKEYVALUE1234567890"), "bad key [key]");
});

test("the probe reports only the last four characters and strips the key from Google's body", () => {
  assert.equal(keyLast4("AIzaSyEXAMPLEKEY1234abcd"), "abcd");
  assert.equal(keyLast4("short"), "");
  const body = geminiProbeBody(DEFAULT_GEMINI_MODEL);
  assert.equal(JSON.stringify(body).includes("inline_data"), false);
  const headers = publicProbeHeaders({
    get(name: string) {
      if (name === "content-type") return "application/json; charset=UTF-8";
      if (name === "server") return "ESF";
      if (name === "x-goog-request-id") return "req-1";
      return null;
    },
  });
  assert.deepEqual(headers, {
    "content-type": "application/json; charset=UTF-8",
    server: "ESF",
    "x-goog-request-id": "req-1",
  });
  assert.equal(publicGeminiText('{"error":{"message":"bad AIzaSyEXAMPLEKEY1234abcd"}}', 500).includes("AIza"), false);
});
