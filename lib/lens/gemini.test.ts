import assert from "node:assert/strict";
import test from "node:test";
import {
  GEMINI_TIMEOUT_MS,
  geminiDeveloperUrl,
  geminiHttpFailure,
  geminiProbeBody,
  geminiRequestBody,
  geminiThrownFailure,
  keyLast4,
  publicGeminiText,
  publicProbeHeaders,
} from "./gemini.ts";

test("Lens calls the Gemini Developer API, not Vertex", () => {
  const url = geminiDeveloperUrl("gemini-3.8-flash");
  assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(url.includes("aiplatform.googleapis.com"), false);
  const body = geminiRequestBody({
    prompt: "read the label",
    images: [{ mimeType: "image/jpeg", data: "aaaa" }],
  });
  const config = body.generationConfig as { thinkingConfig?: { thinkingLevel?: string } };
  assert.equal(config.thinkingConfig?.thinkingLevel, "low");
  assert.equal(GEMINI_TIMEOUT_MS > 25_000 && GEMINI_TIMEOUT_MS < 60_000, true);
});

test("a timeout is not reported as a network failure", () => {
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  assert.equal(geminiThrownFailure(timeout), "Lens timed out waiting for Google.");
  assert.equal(geminiThrownFailure(new TypeError("fetch failed")), "Lens could not reach Google: fetch failed");
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
  const body = geminiProbeBody();
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
