import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INBOX_PASS_FAILED,
  INBOX_PASS_MISSING,
  INBOX_PASS_STARTED,
  inboxPassBody,
  inboxPassResult,
  readInboxWebhookConfig,
} from "./inboxPass.ts";

describe("Winston inbox webhook", () => {
  it("requires the URL and the sender key", () => {
    assert.deepEqual(readInboxWebhookConfig({}), { error: INBOX_PASS_MISSING });
    assert.deepEqual(readInboxWebhookConfig({ WINSTON_INBOX_WEBHOOK_URL: " https://example.test/hook " }), {
      error: INBOX_PASS_MISSING,
    });
    assert.deepEqual(
      readInboxWebhookConfig({
        WINSTON_INBOX_WEBHOOK_URL: "https://example.test/hook",
        WINSTON_INBOX_WEBHOOK_KEY: " crsr_test ",
      }),
      { url: "https://example.test/hook", key: "crsr_test" },
    );
  });

  it("treats HTTP 200 as a started pass and any other status as a failure", () => {
    assert.deepEqual(inboxPassResult(200), { ok: true, message: INBOX_PASS_STARTED });
    assert.equal(inboxPassResult(200).message.includes("approved"), true);
    assert.deepEqual(inboxPassResult(401), { ok: false, message: INBOX_PASS_FAILED });
    assert.equal(inboxPassBody().includes("on-demand-inbox-po-pass"), true);
    assert.equal(inboxPassBody().includes("crsr_"), false);
  });
});
