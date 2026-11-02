import assert from "node:assert/strict";
import test from "node:test";
import { appUserChangeError, pricingOfficerRemovalError } from "./appUserRecord.ts";

const admin = { id: "admin", role: "admin", status: "approved" };
const staff = { id: "staff", role: "staff", status: "approved" };

test("only an approved admin can change a user", () => {
  const current = { id: "person", role: "read_only", status: "pending" };
  assert.equal(
    appUserChangeError({ actor: null, current, nextRole: "staff", nextStatus: "approved", otherApprovedAdmins: 1 }),
    "Only an approved admin can change users.",
  );
  assert.equal(
    appUserChangeError({ actor: staff, current, nextRole: "staff", nextStatus: "approved", otherApprovedAdmins: 1 }),
    "Only an approved admin can change users.",
  );
  assert.equal(
    appUserChangeError({ actor: admin, current, nextRole: "staff", nextStatus: "approved", otherApprovedAdmins: 1 }),
    null,
  );
});

test("an admin cannot remove their own access or the last approved admin", () => {
  assert.match(
    appUserChangeError({
      actor: admin,
      current: admin,
      nextRole: "read_only",
      nextStatus: "approved",
      otherApprovedAdmins: 2,
    }) ?? "",
    /own admin/,
  );
  assert.match(
    appUserChangeError({
      actor: admin,
      current: { id: "other", role: "admin", status: "approved" },
      nextRole: "admin",
      nextStatus: "disabled",
      otherApprovedAdmins: 0,
    }) ?? "",
    /at least one/,
  );
});

test("warehouse roles can be assigned, and an unknown role cannot", () => {
  const current = { id: "person", role: "read_only", status: "pending" };
  assert.equal(
    appUserChangeError({
      actor: admin,
      current,
      nextRole: "warehouse_manager",
      nextStatus: "approved",
      otherApprovedAdmins: 1,
    }),
    null,
  );
  assert.equal(
    appUserChangeError({
      actor: admin,
      current,
      nextRole: "warehouse_clerk",
      nextStatus: "approved",
      otherApprovedAdmins: 1,
    }),
    null,
  );
  assert.match(
    appUserChangeError({
      actor: admin,
      current,
      nextRole: "owner",
      nextStatus: "approved",
      otherApprovedAdmins: 1,
    }) ?? "",
    /Role must be/,
  );
});

test("the last approved pricing officer cannot be cleared or disabled", () => {
  assert.equal(
    pricingOfficerRemovalError({
      currentOfficer: true,
      currentStatus: "approved",
      nextOfficer: false,
      nextStatus: "approved",
      otherApprovedOfficers: 0,
    }),
    "Assign another pricing officer before removing the last one.",
  );
  assert.equal(
    pricingOfficerRemovalError({
      currentOfficer: true,
      currentStatus: "approved",
      nextOfficer: true,
      nextStatus: "disabled",
      otherApprovedOfficers: 0,
    }),
    "Assign another pricing officer before removing the last one.",
  );
  assert.equal(
    pricingOfficerRemovalError({
      currentOfficer: true,
      currentStatus: "approved",
      nextOfficer: false,
      nextStatus: "approved",
      otherApprovedOfficers: 1,
    }),
    null,
  );
  assert.equal(
    pricingOfficerRemovalError({
      currentOfficer: false,
      currentStatus: "approved",
      nextOfficer: false,
      nextStatus: "disabled",
      otherApprovedOfficers: 0,
    }),
    null,
  );
});
