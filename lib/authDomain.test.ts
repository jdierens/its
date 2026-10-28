import assert from "node:assert/strict";
import test from "node:test";
import { gateRequest, hostedDomain, isCompanyEmail, safeNextPath } from "./authDomain.ts";

test("company email is the deepdiscountservers.com domain only", () => {
  assert.equal(isCompanyEmail("jan@deepdiscountservers.com"), true);
  assert.equal(isCompanyEmail(" Jan@DeepDiscountServers.com "), true);
  assert.equal(isCompanyEmail("jan@gmail.com"), false);
  assert.equal(isCompanyEmail("jan@deepdiscountservers.com.evil.com"), false);
  assert.equal(isCompanyEmail("notdeepdiscountservers.com"), false);
  assert.equal(isCompanyEmail(null), false);
});

test("hosted domain is read from the Google identity, not a loose string", () => {
  assert.equal(hostedDomain({ identity_data: { hd: "DeepDiscountServers.com" } }), "deepdiscountservers.com");
  assert.equal(hostedDomain({ hd: "gmail.com" }), "gmail.com");
  assert.equal(hostedDomain({ identity_data: { email: "jan@deepdiscountservers.com" } }), null);
  assert.equal(hostedDomain(null), null);
});

test("next paths stay inside the app", () => {
  assert.equal(safeNextPath("/items?tax=MEM"), "/items?tax=MEM");
  assert.equal(safeNextPath("https://evil.example"), "/items");
  assert.equal(safeNextPath("//evil.example"), "/items");
  assert.equal(safeNextPath("/login"), "/items");
  assert.equal(safeNextPath(null), "/items");
});

test("public callbacks and legal pages do not need a session", () => {
  assert.deepEqual(gateRequest({ pathname: "/privacy", email: null, domain: null, status: null, role: null }), {
    type: "allow",
  });
  assert.deepEqual(
    gateRequest({ pathname: "/api/qbo/callback", email: null, domain: null, status: null, role: null }),
    { type: "allow" },
  );
  assert.deepEqual(
    gateRequest({ pathname: "/api/ebay/account-deletion", email: null, domain: null, status: null, role: null }),
    { type: "allow" },
  );
  assert.deepEqual(
    gateRequest({ pathname: "/api/plaid/webhook", email: null, domain: null, status: null, role: null }),
    { type: "allow" },
  );
});

test("a missing session goes to login, and a pending account waits", () => {
  assert.deepEqual(gateRequest({ pathname: "/items", email: null, domain: null, status: null, role: null }), {
    type: "redirect",
    path: "/login",
  });
  assert.deepEqual(
    gateRequest({
      pathname: "/items",
      email: "sam@gmail.com",
      domain: null,
      status: "approved",
      role: "staff",
    }),
    { type: "redirect", path: "/login?error=domain" },
  );
  assert.deepEqual(
    gateRequest({
      pathname: "/items",
      email: "sam@deepdiscountservers.com",
      domain: "gmail.com",
      status: "approved",
      role: "staff",
    }),
    { type: "redirect", path: "/login?error=domain" },
  );
  assert.deepEqual(
    gateRequest({
      pathname: "/items",
      email: "sam@deepdiscountservers.com",
      domain: null,
      status: "pending",
      role: "read_only",
    }),
    { type: "redirect", path: "/waiting" },
  );
  assert.deepEqual(
    gateRequest({
      pathname: "/waiting",
      email: "sam@deepdiscountservers.com",
      domain: "deepdiscountservers.com",
      status: "disabled",
      role: "staff",
    }),
    { type: "allow" },
  );
});

test("approved staff use the app, and only an admin opens users", () => {
  assert.deepEqual(
    gateRequest({
      pathname: "/items",
      email: "sam@deepdiscountservers.com",
      domain: null,
      status: "approved",
      role: "staff",
    }),
    { type: "allow" },
  );
  assert.deepEqual(
    gateRequest({
      pathname: "/admin/users",
      email: "sam@deepdiscountservers.com",
      domain: null,
      status: "approved",
      role: "staff",
    }),
    { type: "redirect", path: "/items" },
  );
  assert.deepEqual(
    gateRequest({
      pathname: "/admin/users",
      email: "jan@deepdiscountservers.com",
      domain: null,
      status: "approved",
      role: "admin",
    }),
    { type: "allow" },
  );
  assert.deepEqual(
    gateRequest({
      pathname: "/login",
      email: "jan@deepdiscountservers.com",
      domain: null,
      status: "approved",
      role: "admin",
    }),
    { type: "redirect", path: "/items" },
  );
});
