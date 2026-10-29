import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contactFromEmail, contactFromPoText, mergeBlankContact } from "./orderContact.ts";

describe("sales order contact", () => {
  it("reads a person, email, and phone from a customer PO", () => {
    const contact = contactFromPoText(`
      Purchase order 44021
      Contact: Ada Buyer
      Email: ada.buyer@example.com
      Phone: (702) 555-0100
    `);
    assert.deepEqual(contact, {
      person: "Ada Buyer",
      email: "ada.buyer@example.com",
      phone: "(702) 555-0100",
    });
  });

  it("accepts attention and leaves a missing phone blank", () => {
    const contact = contactFromPoText("Attn: Jordan Lee\nBuyer email: jordan@example.com");
    assert.equal(contact.person, "Jordan Lee");
    assert.equal(contact.email, "jordan@example.com");
    assert.equal(contact.phone, "");
  });

  it("uses the email display name, then the local-part, then the body", () => {
    const named = contactFromEmail({
      from: "Ada Buyer <ada@example.com>",
      body: "Thanks,\nAda\nTel: 702-555-0199",
    });
    assert.equal(named.person, "Ada Buyer");
    assert.equal(named.email, "ada@example.com");
    assert.equal(named.phone, "702-555-0199");

    const local = contactFromEmail({ from: "ada.buyer@example.com" });
    assert.equal(local.person, "ada.buyer");
    assert.equal(local.email, "ada.buyer@example.com");
  });

  it("does not replace a contact the order already has", () => {
    const merged = mergeBlankContact(
      { person: "Kept", email: "", phone: "702-555-0100" },
      { person: "Ada Buyer", email: "ada@example.com", phone: "702-555-0199" },
    );
    assert.deepEqual(merged, { person: "Kept", email: "ada@example.com", phone: "702-555-0100" });
  });
});
