import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { parsePlaidWebhook } from "./webhookBody.ts";
import { verifyPlaidWebhook, type WebhookVerificationKey } from "./webhookVerify.ts";

function signed(body: string, iat: number, privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]) {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iat, request_body_sha256: createHash("sha256").update(body).digest("hex") }),
  ).toString("base64url");
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

test("a Plaid webhook verifies when the body and key match", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as WebhookVerificationKey;
  const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" });
  const now = 1_700_000_000;
  const jwt = signed(body, now, privateKey);
  const verified = verifyPlaidWebhook({ jwt, rawBody: body, key: { ...jwk, alg: "ES256", kid: "test-key" }, nowSeconds: now });
  assert.equal(verified.ok, true);
  const tampered = verifyPlaidWebhook({
    jwt,
    rawBody: `${body} `,
    key: { ...jwk, alg: "ES256", kid: "test-key" },
    nowSeconds: now,
  });
  assert.equal(tampered.ok, false);
  const stale = verifyPlaidWebhook({
    jwt,
    rawBody: body,
    key: { ...jwk, alg: "ES256", kid: "test-key" },
    nowSeconds: now + 301,
  });
  assert.equal(stale.ok, false);
  assert.deepEqual(parsePlaidWebhook(body), {
    webhookType: "TRANSACTIONS",
    webhookCode: "SYNC_UPDATES_AVAILABLE",
    itemId: "item-1",
    errorCode: null,
    errorMessage: null,
  });
});

test("a webhook signed with the wrong algorithm is rejected before the key is used", () => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", kid: "test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: 1, request_body_sha256: "ab" })).toString("base64url");
  const result = verifyPlaidWebhook({ jwt: `${header}.${payload}.sig`, rawBody: "{}", key: null, nowSeconds: 1 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /ES256/);
});
