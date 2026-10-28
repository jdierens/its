import assert from "node:assert/strict";
import test from "node:test";
import { actionProblem, errorDetail, readActionBody, recentOrderPullSuccess } from "./clientActionError.ts";

test("error detail keeps the thrown name and message", () => {
  const abort = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  assert.match(errorDetail(abort), /TimeoutError/);
  assert.match(errorDetail(abort), /aborted due to timeout/);
  assert.equal(errorDetail(new TypeError("Failed to fetch")), "TypeError: Failed to fetch");
  assert.equal(errorDetail(new Error("Seed the legacy log map before pulling eBay orders.")), "Seed the legacy log map before pulling eBay orders.");
});

test("a non-JSON body keeps the status and a snippet for an admin", async () => {
  const response = new Response("<!DOCTYPE html> Gateway timeout", { status: 504, headers: { "Content-Type": "text/html" } });
  const body = await readActionBody(response);
  assert.equal(body.httpOk, false);
  assert.equal(body.status, 504);
  assert.equal(body.serverMessage, null);
  assert.match(body.transport ?? "", /504|JSON|DOCTYPE/i);
  assert.equal(
    actionProblem({ detailed: false, fallback: "eBay orders could not be pulled.", status: body.status, transport: body.transport }),
    "eBay orders could not be pulled.",
  );
  const admin = actionProblem({
    detailed: true,
    fallback: "eBay orders could not be pulled.",
    status: body.status,
    transport: body.transport,
  });
  assert.match(admin, /HTTP 504/);
  assert.match(admin, /DOCTYPE/);
});

test("an API message is shown, with the status added for an admin", async () => {
  const response = new Response(JSON.stringify({ ok: false, message: "eBay needs to be reconnected." }), { status: 409 });
  const body = await readActionBody(response);
  assert.equal(body.serverMessage, "eBay needs to be reconnected.");
  assert.equal(
    actionProblem({ detailed: false, fallback: "eBay orders could not be pulled.", status: 409, serverMessage: body.serverMessage }),
    "eBay needs to be reconnected.",
  );
  assert.equal(
    actionProblem({ detailed: true, fallback: "eBay orders could not be pulled.", status: 409, serverMessage: body.serverMessage }),
    "HTTP 409. eBay needs to be reconnected.",
  );
});

test("a lost response still counts as success when the orders log finished after the click", () => {
  const started = Date.parse("2026-10-28T06:00:00.000Z");
  const logs = [
    {
      entity: "orders",
      status: "ok",
      finishedAt: "2026-10-28T05:50:00.000Z",
      message: "Created 0 draft sales orders. Updated 440. Linked 0. Found shipping label fees for 360 orders.",
    },
    {
      entity: "orders",
      status: "ok",
      finishedAt: "2026-10-28T06:02:10.000Z",
      message: "Created 1 draft sales orders. Updated 0. Linked 0. Found shipping label fees for 360 orders.",
    },
  ];
  assert.equal(
    recentOrderPullSuccess(logs, started),
    "Created 1 draft sales orders. Updated 0. Linked 0. Found shipping label fees for 360 orders.",
  );
  assert.equal(
    recentOrderPullSuccess(
      [...logs, { entity: "orders", status: "error", finishedAt: "2026-10-28T06:03:00.000Z", message: "eBay request failed (500)." }],
      started,
    ),
    null,
  );
  assert.equal(recentOrderPullSuccess(logs, Date.parse("2026-10-28T06:10:00.000Z")), null);
  assert.equal(recentOrderPullSuccess(null, started), null);
});

test("a thrown fetch error is the admin message and stays generic otherwise", () => {
  const transport = errorDetail(new TypeError("Failed to fetch"));
  assert.equal(actionProblem({ detailed: false, fallback: "eBay orders could not be pulled.", transport }), "eBay orders could not be pulled.");
  assert.equal(
    actionProblem({ detailed: true, fallback: "eBay orders could not be pulled.", transport }),
    "TypeError: Failed to fetch",
  );
});
