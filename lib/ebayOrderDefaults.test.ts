import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ebayIncotermsFromSetting, ebayPaymentTermsFromSetting, initialEbayText } from "./ebayOrderDefaults.ts";

describe("eBay payment terms and Incoterms settings", () => {
  it("uses Payment In Advance when the terms setting is blank", () => {
    assert.equal(ebayPaymentTermsFromSetting(null), "Payment In Advance");
    assert.equal(ebayPaymentTermsFromSetting("  "), "Payment In Advance");
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
    assert.equal(initialEbayText({ stored: "Net30", ebay: true, setting: "Payment In Advance" }), "Net30");
    assert.equal(initialEbayText({ stored: "", ebay: true, setting: "Payment In Advance" }), "Payment In Advance");
    assert.equal(initialEbayText({ stored: " ", ebay: true, setting: "FOB" }), "FOB");
    assert.equal(initialEbayText({ stored: "", ebay: false, setting: "FOB" }), "");
    assert.equal(initialEbayText({ stored: "DAP", ebay: false, setting: "FOB" }), "DAP");
  });
});
