import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ebaySalesRepFromSetting, initialSalesRep, normalizeSalesRep } from "./ebaySalesRep.ts";

describe("eBay sales rep setting", () => {
  it("keeps two letters and treats anything else as empty", () => {
    assert.equal(normalizeSalesRep("mt"), "MT");
    assert.equal(normalizeSalesRep(" AB "), "AB");
    assert.equal(normalizeSalesRep(""), null);
    assert.equal(normalizeSalesRep("M"), null);
    assert.equal(normalizeSalesRep("ABC"), null);
  });

  it("uses MT when the setting is missing or blank", () => {
    assert.equal(ebaySalesRepFromSetting(null), "MT");
    assert.equal(ebaySalesRepFromSetting(""), "MT");
    assert.equal(ebaySalesRepFromSetting("nope"), "MT");
    assert.equal(ebaySalesRepFromSetting("jd"), "JD");
  });

  it("prefills only an eBay order that has no sales rep", () => {
    assert.equal(initialSalesRep({ stored: "AB", ebay: true, setting: "MT" }), "AB");
    assert.equal(initialSalesRep({ stored: "", ebay: true, setting: "JD" }), "JD");
    assert.equal(initialSalesRep({ stored: "", ebay: true, setting: "" }), "MT");
    assert.equal(initialSalesRep({ stored: "", ebay: false, setting: "MT" }), "");
  });
});
