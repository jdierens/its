import assert from "node:assert/strict";
import test from "node:test";
import { INTEGRATIONS, INTEGRATIONS_HOME, integrationReturnHref } from "./integrations.ts";

test("integrations keep a home page and a page for each live service", () => {
  assert.equal(INTEGRATIONS_HOME, "/admin/integrations");
  assert.deepEqual(
    INTEGRATIONS.map((entry) => [entry.id, entry.href]),
    [
      ["quickbooks", "/admin/integrations/quickbooks"],
      ["ebay", "/admin/integrations/ebay"],
      ["google", null],
      ["brokerbin", null],
    ],
  );
});

test("callback queries go to the service page and a decline stays on the overview", () => {
  assert.equal(
    integrationReturnHref(new URLSearchParams("connected=1")),
    "/admin/integrations/quickbooks",
  );
  assert.equal(
    integrationReturnHref(new URLSearchParams("ebay_error=denied")),
    "/admin/integrations/ebay",
  );
  assert.equal(integrationReturnHref(new URLSearchParams("error=access_denied")), null);
  assert.equal(integrationReturnHref(new URLSearchParams()), null);
});
