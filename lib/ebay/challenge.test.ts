import assert from "node:assert/strict";
import test from "node:test";
import { challengeResponse } from "./challenge.ts";

const code = "challenge-code";
const token = "verification-token-32-characters-min";
const endpoint = "https://its-epks.vercel.app/api/ebay/account-deletion";

test("challenge hash is sha256 hex of code + token + endpoint", () => {
  assert.equal(
    challengeResponse(code, token, endpoint),
    "b3f81fc1800c0fbbe3adb63aaad06917a296f46df032731842e44474a2ae5beb",
  );
});

test("challenge hash changes when the endpoint changes", () => {
  assert.notEqual(challengeResponse(code, token, endpoint), challengeResponse(code, token, `${endpoint}/`));
});
