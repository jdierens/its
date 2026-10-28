import { createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from "node:crypto";

export const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

export type WebhookVerificationKey = {
  alg?: string;
  crv?: string;
  kid?: string;
  kty?: string;
  x?: string;
  y?: string;
  expired_at?: number | null;
};

export type VerifiedWebhook = {
  iat: number;
  requestBodySha256: string;
};

export function plaidWebhookKeyId(jwt: string | null): { ok: true; kid: string } | { ok: false; reason: string } {
  if (!jwt) return { ok: false, reason: "Plaid webhook signature is missing." };
  const parts = jwt.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return { ok: false, reason: "Plaid webhook signature is missing." };
  }
  let header: { alg?: unknown; kid?: unknown };
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: unknown; kid?: unknown };
  } catch {
    return { ok: false, reason: "Plaid webhook signature header is not valid." };
  }
  if (header.alg !== "ES256") return { ok: false, reason: "Plaid webhook signature algorithm is not ES256." };
  if (typeof header.kid !== "string" || header.kid.trim().length === 0) {
    return { ok: false, reason: "Plaid webhook signature has no key id." };
  }
  return { ok: true, kid: header.kid };
}

export function verifyPlaidWebhook(input: {
  jwt: string;
  rawBody: string;
  key: WebhookVerificationKey | null;
  nowSeconds?: number;
}): { ok: true; payload: VerifiedWebhook } | { ok: false; reason: string } {
  const header = plaidWebhookKeyId(input.jwt);
  if (!header.ok) return header;
  const key = input.key;
  if (!key) return { ok: false, reason: "Plaid webhook verification key was not found." };
  if (key.alg !== "ES256" || key.kty !== "EC" || key.crv !== "P-256") {
    return { ok: false, reason: "Plaid webhook verification key is not an ES256 P-256 key." };
  }
  if (key.kid && key.kid !== header.kid) return { ok: false, reason: "Plaid webhook key id does not match." };
  if (!key.x || !key.y) return { ok: false, reason: "Plaid webhook verification key is incomplete." };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof key.expired_at === "number" && key.expired_at <= now) {
    return { ok: false, reason: "Plaid webhook verification key has expired." };
  }

  const parts = input.jwt.split(".");
  let payload: { iat?: unknown; request_body_sha256?: unknown };
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      iat?: unknown;
      request_body_sha256?: unknown;
    };
  } catch {
    return { ok: false, reason: "Plaid webhook signature payload is not valid." };
  }

  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: key.x, y: key.y },
      format: "jwk",
    });
  } catch {
    return { ok: false, reason: "Plaid webhook verification key could not be read." };
  }

  const signature = Buffer.from(parts[2], "base64url");
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const valid = verify("sha256", signed, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
  if (!valid) return { ok: false, reason: "Plaid webhook signature is not valid." };

  if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) {
    return { ok: false, reason: "Plaid webhook signature has no issued-at time." };
  }
  if (payload.iat > now + 60) return { ok: false, reason: "Plaid webhook signature is from the future." };
  if (now - payload.iat > WEBHOOK_MAX_AGE_SECONDS) return { ok: false, reason: "Plaid webhook signature is too old." };

  if (typeof payload.request_body_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(payload.request_body_sha256)) {
    return { ok: false, reason: "Plaid webhook body hash is missing." };
  }
  const actual = createHash("sha256").update(input.rawBody).digest("hex");
  const expected = Buffer.from(payload.request_body_sha256, "hex");
  const got = Buffer.from(actual, "hex");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false, reason: "Plaid webhook body does not match its signature." };
  }
  return { ok: true, payload: { iat: payload.iat, requestBodySha256: actual } };
}
