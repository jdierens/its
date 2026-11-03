import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilitiesFor,
  hasCapability,
  isFinancialItemField,
  routeAllowed,
  type Capability,
} from "./capabilities.ts";

const ROLES = ["admin", "staff", "warehouse_manager", "warehouse_clerk", "read_only"] as const;

function caps(role: string | null, pricingOfficer = false) {
  return capabilitiesFor({ role, status: "approved", pricingOfficer, authOn: true });
}

function yes(role: (typeof ROLES)[number], capability: Capability, pricingOfficer = false) {
  assert.equal(hasCapability(caps(role, pricingOfficer), capability), true, `${role} ${capability}`);
}

function no(role: (typeof ROLES)[number], capability: Capability, pricingOfficer = false) {
  assert.equal(hasCapability(caps(role, pricingOfficer), capability), false, `${role} ${capability}`);
}

test("admin and staff keep financial and floor access, and staff do not get integrations or user admin", () => {
  for (const role of ["admin", "staff"] as const) {
    yes(role, "can_view_financials");
    yes(role, "can_edit_financials");
    yes(role, "can_edit_items");
    yes(role, "can_add_photos");
    yes(role, "can_log_picks");
    yes(role, "can_move_bins");
    yes(role, "can_receive");
    yes(role, "can_adjust_counts");
    yes(role, "can_manage_catalog");
    yes(role, "can_edit_settings");
    no(role, "can_allocate_cogs");
  }
  yes("admin", "can_manage_users");
  yes("admin", "can_manage_integrations");
  no("staff", "can_manage_users");
  no("staff", "can_manage_integrations");
});

test("warehouse roles cannot see or edit money, and the clerk cannot edit items or counts", () => {
  for (const role of ["warehouse_manager", "warehouse_clerk"] as const) {
    no(role, "can_view_financials");
    no(role, "can_edit_financials");
    no(role, "can_manage_catalog");
    no(role, "can_manage_users");
    no(role, "can_manage_integrations");
    no(role, "can_edit_settings");
    no(role, "can_allocate_cogs");
    yes(role, "can_add_photos");
    yes(role, "can_log_picks");
    yes(role, "can_move_bins");
    yes(role, "can_receive");
  }
  yes("warehouse_manager", "can_edit_items");
  yes("warehouse_manager", "can_adjust_counts");
  yes("warehouse_manager", "can_manage_warehouse");
  no("warehouse_clerk", "can_edit_items");
  no("warehouse_clerk", "can_adjust_counts");
  no("warehouse_clerk", "can_manage_warehouse");
});

test("read_only can see money and cannot write", () => {
  yes("read_only", "can_view_financials");
  for (const capability of [
    "can_edit_financials",
    "can_edit_items",
    "can_add_photos",
    "can_log_picks",
    "can_move_bins",
    "can_receive",
    "can_adjust_counts",
    "can_manage_catalog",
    "can_manage_users",
    "can_manage_integrations",
    "can_edit_settings",
    "can_allocate_cogs",
  ] as const) {
    no("read_only", capability);
  }
});

test("a pricing officer sees money and can allocate cost without becoming a sixth role", () => {
  const clerk = caps("warehouse_clerk", true);
  assert.equal(hasCapability(clerk, "can_view_financials"), true);
  assert.equal(hasCapability(clerk, "can_allocate_cogs"), true);
  assert.equal(hasCapability(clerk, "can_edit_financials"), false);
  assert.equal(hasCapability(clerk, "can_edit_items"), false);
  assert.equal(hasCapability(caps("admin", true), "can_allocate_cogs"), true);
  assert.equal(hasCapability(caps("staff"), "can_allocate_cogs"), false);
});

test("pending accounts and unknown roles get no capabilities", () => {
  const pending = capabilitiesFor({ role: "admin", status: "pending", pricingOfficer: true, authOn: true });
  assert.equal(pending.size, 0);
  const disabled = capabilitiesFor({ role: "staff", status: "disabled", authOn: true });
  assert.equal(disabled.size, 0);
  assert.equal(caps(null).size, 0);
  assert.equal(caps("owner").size, 0);
});

test("sign-in off leaves the open app able to edit", () => {
  const open = capabilitiesFor({ role: null, authOn: false });
  assert.equal(hasCapability(open, "can_edit_financials"), true);
  assert.equal(hasCapability(open, "can_edit_items"), true);
  assert.equal(hasCapability(open, "can_allocate_cogs"), true);
});

test("price columns are the financial item fields", () => {
  assert.equal(isFinancialItemField("ecommerce_price"), true);
  assert.equal(isFinancialItemField("market_price"), true);
  assert.equal(isFinancialItemField("msrp"), true);
  assert.equal(isFinancialItemField("name"), false);
  assert.equal(isFinancialItemField("manufacturer"), false);
});

test("warehouse roles are kept off settings, pricing, and admin pages", () => {
  const clerk = { role: "warehouse_clerk", status: "approved", authOn: true };
  assert.equal(routeAllowed("/admin/settings", clerk), false);
  assert.equal(routeAllowed("/admin/users", clerk), false);
  assert.equal(routeAllowed("/admin/integrations/ebay", clerk), false);
  assert.equal(routeAllowed("/admin/manufacturers", clerk), false);
  assert.equal(routeAllowed("/pricing", clerk), false);
  assert.equal(routeAllowed("/pricing/quotes", clerk), false);
  assert.equal(routeAllowed("/pricing/quotes/new", { role: "staff", status: "approved", authOn: true }), true);
  assert.equal(routeAllowed("/warehouse/pick", clerk), true);
  assert.equal(routeAllowed("/items", clerk), true);

  const officer = { ...clerk, pricingOfficer: true };
  assert.equal(routeAllowed("/pricing", officer), true);
  assert.equal(routeAllowed("/admin/settings", officer), false);

  const reader = { role: "read_only", status: "approved", authOn: true };
  assert.equal(routeAllowed("/pricing", reader), true);
  assert.equal(routeAllowed("/pricing/quotes", reader), true);
  assert.equal(routeAllowed("/admin/settings", reader), true);
  assert.equal(routeAllowed("/admin/users", reader), false);
  assert.equal(routeAllowed("/admin/integrations", reader), false);
  assert.equal(routeAllowed("/admin/manufacturers", reader), false);

  const staff = { role: "staff", status: "approved", authOn: true };
  assert.equal(routeAllowed("/admin/settings", staff), true);
  assert.equal(routeAllowed("/admin/manufacturers", staff), true);
  assert.equal(routeAllowed("/admin/integrations", staff), false);
  assert.equal(routeAllowed("/admin/users", staff), false);
  assert.equal(routeAllowed("/admin/data", staff), false);
  assert.equal(routeAllowed("/admin/data/bins", { role: "admin", status: "approved", authOn: true }), true);
});
