import assert from "node:assert/strict";
import test from "node:test";
import { environmentMismatchHint, formatQboError } from "./failure.ts";
import { readFault } from "./http.ts";

test("lowercase Intuit faults keep the code and message", () => {
  const fault = readFault({
    fault: {
      error: [
        {
          message: "message=AuthenticationFailed; errorCode=003200; statusCode=401",
          code: "003200",
        },
      ],
      type: "AUTHENTICATION",
    },
  });
  assert.equal(fault.code, "003200");
  assert.match(fault.message, /AuthenticationFailed/);
});

test("a sandbox auth failure names the request, status, code, tid, and environment", () => {
  const message = formatQboError({
    subject: "Customer CDC",
    status: 401,
    code: "003200",
    message: "AuthenticationFailed",
    intuitTid: "1-6ad54416-4f2a2b53255ce14b7d9015e3",
    environment: "sandbox",
    refreshed: true,
  });
  assert.match(message, /Customer CDC failed: HTTP 401, Intuit 003200/);
  assert.match(message, /AuthenticationFailed/);
  assert.match(message, /intuit_tid 1-6ad54416-4f2a2b53255ce14b7d9015e3/);
  assert.match(message, /QBO_ENVIRONMENT is sandbox/);
  assert.match(message, /Set QBO_ENVIRONMENT to production and reconnect/);
});

test("a production mismatch points back at sandbox", () => {
  const hint = environmentMismatchHint({
    subject: "Vendor query",
    status: 401,
    code: "3100",
    message: "ApplicationAuthenticationFailed",
    intuitTid: null,
    environment: "production",
    refreshed: true,
  });
  assert.match(hint ?? "", /QBO_ENVIRONMENT is production/);
  assert.match(hint ?? "", /Set QBO_ENVIRONMENT to sandbox and reconnect/);
});

test("an ordinary validation error does not suggest an environment mismatch", () => {
  const hint = environmentMismatchHint({
    subject: "Customer update",
    status: 400,
    code: "6000",
    message: "A business validation error has occurred",
    intuitTid: "1-abc",
    environment: "sandbox",
    refreshed: false,
  });
  assert.equal(hint, null);
});
