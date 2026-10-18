import assert from "node:assert/strict";
import test from "node:test";
import { formatQboTime, fromQbo, preserveVendorLocalFields, toQboBody } from "./map.ts";

const customerRead = {
  DisplayName: "King's Groceries",
  CompanyName: "King Groceries",
  GivenName: "James",
  MiddleName: "B",
  FamilyName: "King",
  Title: "Mr",
  Suffix: "Jr",
  Notes: "Here are other details.",
  PrimaryEmailAddr: { Address: "jdrew@myemail.com" },
  PrimaryPhone: { FreeFormNumber: "(555) 555-5555" },
  BillAddr: {
    Line1: "123 Main Street",
    City: "Mountain View",
    CountrySubDivisionCode: "CA",
    PostalCode: "94042",
    Country: "USA",
  },
  ShipAddr: {
    Line1: "123 Main Street",
    City: "Mountain View",
    CountrySubDivisionCode: "CA",
    PostalCode: "94042",
  },
  ResaleNum: "91-1847510",
  Active: true,
  Id: "1",
  SyncToken: "0",
  MetaData: { LastUpdatedTime: "2014-09-12T10:00:00-07:00" },
};

const vendorRead = {
  PrimaryEmailAddr: { Address: "dbradley@myemail.com" },
  PrimaryPhone: { FreeFormNumber: "(650) 555-2342" },
  DisplayName: "Dianne's Auto Shop",
  FamilyName: "Bradley",
  TaxIdentifier: "99-5688293",
  CompanyName: "Dianne's Auto Shop",
  BillAddr: {
    City: "Millbrae",
    Country: "U.S.A",
    Line3: "29834 Mustang Ave.",
    Line2: "Dianne Bradley",
    Line1: "Dianne's Auto Shop",
    PostalCode: "94030",
    CountrySubDivisionCode: "CA",
  },
  GivenName: "Dianne",
  Active: true,
  Id: 56,
  SyncToken: 0,
  MetaData: { LastUpdatedTime: "2015-07-28T12:30:00-07:00" },
};

test("maps the Intuit customer example onto a row", () => {
  const row = fromQbo("customer", customerRead);
  assert.equal(row.display_name, "King's Groceries");
  assert.equal(row.company_name, "King Groceries");
  assert.equal(row.given_name, "James");
  assert.equal(row.family_name, "King");
  assert.equal(row.primary_email, "jdrew@myemail.com");
  assert.equal(row.phone, "(555) 555-5555");
  assert.equal(row.notes, "Here are other details.");
  assert.equal(row.tax_id, "91-1847510");
  assert.equal(row.active, true);
  assert.equal(row.qbo_id, "1");
  assert.equal(row.qbo_sync_token, "0");
  assert.equal(row.qbo_last_updated, "2014-09-12T10:00:00-07:00");
  assert.deepEqual(row.billing_address, {
    line1: "123 Main Street",
    line2: null,
    city: "Mountain View",
    countrySubDivisionCode: "CA",
    postalCode: "94042",
    country: "USA",
  });
  assert.equal(row.shipping_address?.line1, "123 Main Street");
  assert.equal(row.shipping_address?.country, null);
});

test("maps the Intuit vendor example and keeps a numeric id", () => {
  const row = fromQbo("vendor", vendorRead);
  assert.equal(row.display_name, "Dianne's Auto Shop");
  assert.equal(row.tax_id, "99-5688293");
  assert.equal(row.primary_email, "dbradley@myemail.com");
  assert.equal(row.phone, "(650) 555-2342");
  assert.equal(row.notes, null);
  assert.equal(row.shipping_address, null);
  assert.equal(row.qbo_id, "56");
  assert.equal(row.qbo_sync_token, "0");
  assert.equal(row.billing_address?.line1, "Dianne's Auto Shop");
  assert.equal(row.billing_address?.line2, "Dianne Bradley, 29834 Mustang Ave.");
  assert.equal(row.billing_address?.city, "Millbrae");
});

test("inactive customers and a missing email stay empty", () => {
  const row = fromQbo("customer", {
    DisplayName: "Closed Account",
    Active: false,
    Id: "9",
    SyncToken: "2",
  });
  assert.equal(row.active, false);
  assert.equal(row.primary_email, null);
  assert.equal(row.phone, null);
  assert.equal(row.billing_address, null);
  assert.equal(row.tax_id, null);
});

test("customer create body uses ResaleNum and omits vendor fields", () => {
  const row = fromQbo("customer", customerRead);
  const body = toQboBody("customer", row, "create");
  assert.equal(body.DisplayName, "King's Groceries");
  assert.equal(body.Active, true);
  assert.equal(body.ResaleNum, "91-1847510");
  assert.equal(body.Notes, "Here are other details.");
  assert.equal("TaxIdentifier" in body, false);
  assert.equal("Id" in body, false);
  assert.equal("sparse" in body, false);
  assert.deepEqual(body.PrimaryEmailAddr, { Address: "jdrew@myemail.com" });
  assert.deepEqual(body.PrimaryPhone, { FreeFormNumber: "(555) 555-5555" });
  assert.deepEqual(body.BillAddr, {
    Line1: "123 Main Street",
    City: "Mountain View",
    CountrySubDivisionCode: "CA",
    PostalCode: "94042",
    Country: "USA",
  });
});

test("vendor update sends SyncToken and does not send notes", () => {
  const row = fromQbo("vendor", vendorRead);
  const kept = preserveVendorLocalFields("vendor", row, {
    notes: "Local account note",
    shipping_address: {
      line1: "Dock 4",
      line2: null,
      city: "Millbrae",
      countrySubDivisionCode: "CA",
      postalCode: "94030",
      country: "U.S.A",
    },
  });
  assert.equal(kept.notes, "Local account note");
  assert.equal(kept.shipping_address?.line1, "Dock 4");

  const body = toQboBody("vendor", kept, "update");
  assert.equal(body.Id, "56");
  assert.equal(body.SyncToken, "0");
  assert.equal(body.sparse, true);
  assert.equal(body.TaxIdentifier, "99-5688293");
  assert.equal("Notes" in body, false);
  assert.equal("ShipAddr" in body, false);
  assert.equal("ResaleNum" in body, false);
});

test("a cleared company name is sent as empty on update", () => {
  const row = fromQbo("customer", { ...customerRead, CompanyName: "  " });
  const body = toQboBody("customer", row, "update");
  assert.equal(body.CompanyName, "");
  assert.equal("PrimaryEmailAddr" in body, true);
});

test("formats a CDC timestamp without milliseconds", () => {
  assert.equal(formatQboTime(new Date("2015-11-10T00:00:00.000Z")), "2015-11-10T00:00:00-00:00");
});
