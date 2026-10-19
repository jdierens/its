import assert from "node:assert/strict";
import test from "node:test";
import { requestToken, TokenRequestError } from "./auth.ts";
import { ebayRead } from "./http.ts";

const config = { clientId: "app-id", clientSecret: "cert-id" };
const tokenEndpoint = "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("client credentials grant does not require a refresh token", async () => {
  const original = globalThis.fetch;
  let body = "";
  globalThis.fetch = async (_input, init) => {
    body = String(init?.body ?? "");
    return jsonResponse({ access_token: "app-token", expires_in: 7200 }, 200, { rlogid: "rlog-app" });
  };
  try {
    const tokens = await requestToken({
      config,
      tokenEndpoint,
      backoffMs: 0,
      fields: {
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      },
    });
    assert.equal(tokens.access_token, "app-token");
    assert.equal(tokens.refresh_token, null);
    assert.match(body, /grant_type=client_credentials/);
    assert.match(body, /api_scope/);
  } finally {
    globalThis.fetch = original;
  }
});

test("refresh grant returns a new access token", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse(
      { access_token: "new-access", expires_in: 7200, refresh_token: "rotated" },
      200,
      { rlogid: "rlog-refresh", "x-ebay-c-request-id": "req-refresh" },
    );
  try {
    const tokens = await requestToken({
      config,
      tokenEndpoint,
      backoffMs: 0,
      fields: { grant_type: "refresh_token", refresh_token: "old-refresh" },
    });
    assert.equal(tokens.access_token, "new-access");
    assert.equal(tokens.refresh_token, "rotated");
    assert.equal(tokens.expires_in, 7200);
  } finally {
    globalThis.fetch = original;
  }
});

test("invalid_grant is not retried and keeps rlogid", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(
      { error: "invalid_grant", error_description: "refresh token is invalid" },
      400,
      { rlogid: "rlog-grant" },
    );
  };
  try {
    await assert.rejects(
      () =>
        requestToken({
          config,
          tokenEndpoint,
          backoffMs: 0,
          fields: { grant_type: "refresh_token", refresh_token: "dead" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof TokenRequestError);
        assert.equal(error.code, "invalid_grant");
        assert.equal(error.rlogid, "rlog-grant");
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("a token endpoint 500 is retried then succeeds", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({ error: "server_error" }, 500, { rlogid: "rlog-500" });
    return jsonResponse({ access_token: "after-retry", refresh_token: "kept", expires_in: 7200 }, 200);
  };
  try {
    const tokens = await requestToken({
      config,
      tokenEndpoint,
      backoffMs: 0,
      fields: { grant_type: "authorization_code", code: "abc", redirect_uri: "RuName" },
    });
    assert.equal(tokens.access_token, "after-retry");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("a 401 refreshes once and retries the read once", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    calls.push(authorization);
    if (authorization.includes("old-token")) {
      return jsonResponse({ errors: [{ message: "Invalid access token" }] }, 401, { rlogid: "rlog-401" });
    }
    return jsonResponse({ sellerRegistrationCompleted: true }, 200, { rlogid: "rlog-ok" });
  };
  try {
    let refreshes = 0;
    const result = await ebayRead<{ sellerRegistrationCompleted?: boolean }>({
      url: "https://api.sandbox.ebay.com/sell/account/v1/privilege",
      token: "old-token",
      refresh: async () => {
        refreshes += 1;
        return "new-token";
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.body.sellerRegistrationCompleted, true);
      assert.equal(result.rlogid, "rlog-ok");
    }
    assert.equal(refreshes, 1);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("a second 401 does not refresh again", async () => {
  let refreshes = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({ errors: [{ message: "Invalid access token" }] }, 401, { rlogid: "rlog-again" });
  try {
    const result = await ebayRead({
      url: "https://api.sandbox.ebay.com/sell/account/v1/privilege",
      token: "old-token",
      refresh: async () => {
        refreshes += 1;
        return "still-bad";
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.rlogid, "rlog-again");
    assert.equal(refreshes, 1);
  } finally {
    globalThis.fetch = original;
  }
});
