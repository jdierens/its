import assert from "node:assert/strict";
import test from "node:test";
import { plaidConfigProblems, readPlaidConfig } from "./config.ts";

const KEYS = ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV", "PLAID_WEBHOOK_URL", "PLAID_REDIRECT_URI", "PLAID_CLIENT_USER_ID"] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("missing Plaid keys leave the integration unconfigured", () => {
  const saved = saveEnv();
  delete process.env.PLAID_CLIENT_ID;
  delete process.env.PLAID_SECRET;
  delete process.env.PLAID_ENV;
  assert.equal(readPlaidConfig(), null);
  restoreEnv(saved);
});

test("Plaid config requires an explicit sandbox or production environment", () => {
  const saved = saveEnv();
  process.env.PLAID_CLIENT_ID = "client";
  process.env.PLAID_SECRET = "secret";
  process.env.PLAID_ENV = "development";
  assert.equal(readPlaidConfig(), null);
  process.env.PLAID_ENV = "sandbox";
  process.env.PLAID_WEBHOOK_URL = "http://localhost/api/plaid/webhook";
  process.env.PLAID_REDIRECT_URI = "http://localhost:3000/admin/integrations/plaid";
  const config = readPlaidConfig();
  assert.equal(config?.environment, "sandbox");
  assert.equal(config?.clientUserId, "its");
  assert.equal(config?.webhookUrl, null);
  assert.equal(config?.redirectUri, "http://localhost:3000/admin/integrations/plaid");
  assert.ok(plaidConfigProblems().some((problem) => problem.includes("PLAID_WEBHOOK_URL")));
  process.env.PLAID_ENV = "production";
  process.env.PLAID_REDIRECT_URI = "http://localhost:3000/admin/integrations/plaid";
  assert.equal(readPlaidConfig()?.redirectUri, null);
  restoreEnv(saved);
});
