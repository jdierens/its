import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentPartyName } from "./documentPartyName.ts";

describe("document party name", () => {
  it("drops a trailing QuickBooks customer or vendor mark", () => {
    assert.equal(documentPartyName("Acme (C)"), "Acme");
    assert.equal(documentPartyName("Acme (V)"), "Acme");
    assert.equal(documentPartyName("  Acme (C)"), "Acme");
    assert.equal(documentPartyName("Acme  (V)"), "Acme");
    assert.equal(documentPartyName("Acme (C) "), "Acme");
    assert.equal(documentPartyName("Acme(V)"), "Acme");
    assert.equal(documentPartyName("Acme (c)"), "Acme");
    assert.equal(documentPartyName("Acme (C) (V)"), "Acme");
  });

  it("leaves the stored name alone when the mark is not trailing", () => {
    assert.equal(documentPartyName("Decker IT Lösungen"), "Decker IT Lösungen");
    assert.equal(documentPartyName("Acme (C) Labs"), "Acme (C) Labs");
    assert.equal(documentPartyName("Acme (Customer)"), "Acme (Customer)");
    assert.equal(documentPartyName("Acme (CV)"), "Acme (CV)");
    assert.equal(documentPartyName("(C)"), "");
  });
});
