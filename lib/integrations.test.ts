import assert from "node:assert/strict";
import test from "node:test";
import { INTEGRATIONS, INTEGRATIONS_HOME, integrationReturnHref } from "./integrations.ts";
import { NAV_GROUPS, pageMetaFor } from "./nav.ts";

test("integrations keep a home page and a page for each live service", () => {
  assert.equal(INTEGRATIONS_HOME, "/admin/integrations");
  assert.deepEqual(
    INTEGRATIONS.map((entry) => [entry.id, entry.href]),
    [
      ["quickbooks", "/admin/integrations/quickbooks"],
      ["ebay", "/admin/integrations/ebay"],
      ["plaid", "/admin/integrations/plaid"],
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

test("bank feeds sit with the other integration pages", () => {
  const admin = NAV_GROUPS.find((group) => group.label === "Admin");
  const integrations = admin?.items.find((item) => item.href === "/admin/integrations");
  const bankFeeds = integrations?.children?.find((child) => child.href === "/admin/integrations/plaid");
  assert.equal(bankFeeds?.label, "Bank feeds");
  const meta = pageMetaFor("/admin/integrations/plaid");
  assert.equal(meta.title, "Bank feeds");
  assert.equal(meta.crumbs.at(-1)?.label, "Bank feeds");
});
