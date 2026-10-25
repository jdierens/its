import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ebayIncotermsFromSetting, ebayPaymentTermsFromSetting, initialEbayText } from "./ebayOrderDefaults.ts";

describe("eBay payment terms and Incoterms settings", () => {
  it("uses PIA when the terms setting is blank", () => {
    assert.equal(ebayPaymentTermsFromSetting(null), "PIA");
    assert.equal(ebayPaymentTermsFromSetting("  "), "PIA");
    assert.equal(ebayPaymentTermsFromSetting("Payment In Advance"), "PIA");
    assert.equal(ebayPaymentTermsFromSetting("pia"), "PIA");
    assert.equal(ebayPaymentTermsFromSetting("Net30"), "Net30");
  });

  it("uses FOB when the Incoterms setting is blank or not a sales-order code", () => {
    assert.equal(ebayIncotermsFromSetting(null), "FOB");
    assert.equal(ebayIncotermsFromSetting(""), "FOB");
    assert.equal(ebayIncotermsFromSetting("nope"), "FOB");
    assert.equal(ebayIncotermsFromSetting("fob"), "FOB");
    assert.equal(ebayIncotermsFromSetting("EXW"), "EXW");
  });

  it("prefills only an eBay order whose field is empty", () => {
    assert.equal(initialEbayText({ stored: "Net30", ebay: true, setting: "PIA" }), "Net30");
    assert.equal(initialEbayText({ stored: "", ebay: true, setting: "PIA" }), "PIA");
    assert.equal(initialEbayText({ stored: " ", ebay: true, setting: "FOB" }), "FOB");
    assert.equal(initialEbayText({ stored: "", ebay: false, setting: "FOB" }), "");
    assert.equal(initialEbayText({ stored: "DAP", ebay: false, setting: "FOB" }), "DAP");
  });
});
