import assert from "node:assert/strict";
import test from "node:test";
import { isExpiredAccessToken, requestToken, TokenRequestError } from "./auth.ts";
import { qboRequest } from "./http.ts";

const config = {
  clientId: "client",
  clientSecret: "secret",
  environment: "sandbox" as const,
};
const tokenEndpoint = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function jsonResponse(body: unknown, status: number, intuitTid: string | null): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (intuitTid) headers.set("intuit_tid", intuitTid);
  return new Response(JSON.stringify(body), { status, headers });
}

test("a 401 with code 3200 refreshes once and retries the request once", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === tokenEndpoint) {
      return jsonResponse(
        { access_token: "new-token", refresh_token: "rotated", expires_in: 3600 },
        200,
        "tid-refresh",
      );
    }
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    if (authorization.includes("old-token")) {
      return jsonResponse(
        {
          Fault: {
            Error: [{ Message: "AuthenticationFailed", Detail: "Token expired", code: "3200" }],
          },
        },
        401,
        "tid-401",
      );
    }
    return jsonResponse({ QueryResponse: {} }, 200, "tid-ok");
  };

  try {
    const result = await qboRequest<Record<string, unknown>>({
      method: "GET",
      url: "https://sandbox-quickbooks.api.intuit.com/v3/company/1/query",
      token: "old-token",
      gapMs: 0,
      refresh: async () => {
        const response = await fetch(tokenEndpoint, { method: "POST" });
        const body = (await response.json()) as { access_token: string };
        return body.access_token;
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.intuitTid, "tid-ok");
    assert.equal(calls.filter((call) => call.startsWith("POST")).length, 1);
    assert.equal(calls.filter((call) => call.includes("/query")).length, 2);
    assert.equal(isExpiredAccessToken(401, "3200", "AuthenticationFailed Token expired"), true);
  } finally {
    globalThis.fetch = original;
  }
});

test("a second 401 does not refresh again", async () => {
  let refreshes = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse(
      { Fault: { Error: [{ Message: "AuthenticationFailed", Detail: "Token expired", code: "3200" }] } },
      401,
      "tid-again",
    );
  try {
    const result = await qboRequest({
      method: "GET",
      url: "https://sandbox-quickbooks.api.intuit.com/v3/company/1/query",
      token: "old-token",
      gapMs: 0,
      refresh: async () => {
        refreshes += 1;
        return "still-expired";
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "3200");
      assert.equal(result.intuitTid, "tid-again");
    }
    assert.equal(refreshes, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("invalid_grant is not retried and keeps intuit_tid", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(
      { error: "invalid_grant", error_description: "Refresh token expired" },
      400,
      "tid-grant",
    );
  };
  try {
    await assert.rejects(
      () =>
        requestToken({
          config,
          fields: { grant_type: "refresh_token", refresh_token: "dead" },
          tokenEndpoint,
          backoffMs: 0,
        }),
      (error: unknown) => {
        assert.ok(error instanceof TokenRequestError);
        assert.equal(error.code, "invalid_grant");
        assert.equal(error.intuitTid, "tid-grant");
        assert.equal(error.message, "Refresh token expired");
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("invalid_client is not retried and a 500 is retried", async () => {
  const original = globalThis.fetch;
  let invalidClientCalls = 0;
  globalThis.fetch = async () => {
    invalidClientCalls += 1;
    return jsonResponse({ error: "invalid_client" }, 401, "tid-client");
  };
  try {
    await assert.rejects(
      () => requestToken({ config, fields: { grant_type: "refresh_token", refresh_token: "x" }, tokenEndpoint, backoffMs: 0 }),
      (error: unknown) => error instanceof TokenRequestError && error.code === "invalid_client",
    );
    assert.equal(invalidClientCalls, 1);

    let serverCalls = 0;
    globalThis.fetch = async () => {
      serverCalls += 1;
      if (serverCalls === 1) return jsonResponse({ error: "server" }, 500, "tid-500");
      return jsonResponse(
        { access_token: "a", refresh_token: "b", expires_in: 3600 },
        200,
        "tid-ok",
      );
    };
    const tokens = await requestToken({
      config,
      fields: { grant_type: "refresh_token", refresh_token: "x" },
      tokenEndpoint,
      backoffMs: 0,
    });
    assert.equal(serverCalls, 2);
    assert.equal(tokens.access_token, "a");
  } finally {
    globalThis.fetch = original;
  }
});
