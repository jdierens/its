import assert from "node:assert/strict";
import test from "node:test";
import {
  conditionFromHints,
  lensNeedles,
  normalizeToken,
  rankLensMatches,
  suggestedItemName,
  type LensCandidate,
  type LensReading,
} from "./rank.ts";

function reading(patch: Partial<LensReading> = {}): LensReading {
  return {
    manufacturer: "Samsung",
    partNumbers: ["M393A4K40DB3-CWE"],
    model: "M393A4K40DB3-CWE",
    itemType: "Product",
    taxonomy: "Memory",
    specs: [],
    specCodes: ["S12345"],
    conditionHints: "",
    rawText: "",
    confidence: 0.8,
    ...patch,
  };
}

function candidate(patch: Partial<LensCandidate> = {}): LensCandidate {
  return {
    id: "1",
    sku: "107075",
    name: "32GB DDR4",
    partNumber: "",
    oemPartNumber: "",
    model: "",
    manufacturerName: "",
    taxonomyName: "",
    specCode: "",
    quantity: 2,
    skuSimilarity: 0,
    partSimilarity: 0,
    oemSimilarity: 0,
    modelSimilarity: 0,
    specSimilarity: 0,
    ...patch,
  };
}

test("a normalized part number outranks a fuzzy model", () => {
  const hits = rankLensMatches(reading(), [
    candidate({
      id: "fuzzy",
      sku: "200",
      name: "Other",
      model: "M393A4K40",
      modelSimilarity: 0.62,
    }),
    candidate({
      id: "exact",
      sku: "107075",
      name: "Samsung 32GB",
      partNumber: "M393A4K40DB3-CWE",
      manufacturerName: "Samsung",
      taxonomyName: "Memory",
      quantity: 4,
    }),
  ]);
  assert.equal(hits[0]?.id, "exact");
  assert.equal(hits[0]?.reasons[0], "Part number matches M393A4K40DB3-CWE");
  assert.equal(hits[0]?.reasons.includes("Manufacturer Samsung"), true);
  assert.equal(hits[0]?.reasons.includes("Taxonomy Memory"), true);
  assert.ok((hits[0]?.confidence ?? 0) > (hits[1]?.confidence ?? 0));
  assert.equal(hits[0]?.quantity, 4);
});

test("sku, oem part number, and spec code are exact matches", () => {
  const hits = rankLensMatches(
    reading({ partNumbers: ["107132"], model: "", specCodes: ["SR3A1"], manufacturer: "", taxonomy: "" }),
    [
      candidate({ id: "sku", sku: "107132", name: "By SKU" }),
      candidate({ id: "oem", sku: "9", name: "By OEM", oemPartNumber: "107132" }),
      candidate({ id: "spec", sku: "8", name: "By spec", specCode: "SR3A1" }),
    ],
  );
  assert.deepEqual(hits.map((hit) => hit.id), ["sku", "oem", "spec"]);
  assert.match(hits[0]?.reasons[0] ?? "", /SKU matches 107132/);
  assert.match(hits[1]?.reasons[0] ?? "", /OEM part number/);
  assert.match(hits[2]?.reasons[0] ?? "", /Spec code matches SR3A1/);
});

test("nearby numeric SKUs are not fuzzy matches", () => {
  const hits = rankLensMatches(reading({ partNumbers: ["107132"], model: "", specCodes: [], manufacturer: "", taxonomy: "" }), [
    candidate({ id: "near", sku: "107130", name: "Neighbor", skuSimilarity: 0.86 }),
    candidate({ id: "same", sku: "107132", name: "Same" }),
  ]);
  assert.deepEqual(hits.map((hit) => hit.id), ["same"]);
});

test("dashes do not hide a part number, and a weak fuzzy match is left out", () => {
  assert.equal(normalizeToken("m393a4k40db3-cwe"), "M393A4K40DB3CWE");
  const hits = rankLensMatches(reading({ manufacturer: "", taxonomy: "" }), [
    candidate({ id: "dashed", sku: "1", partNumber: "M393A4K40DB3CWE" }),
    candidate({ id: "weak", sku: "2", model: "DDR", modelSimilarity: 0.2 }),
  ]);
  assert.deepEqual(hits.map((hit) => hit.id), ["dashed"]);
});

test("needles stay short and the suggested name prefers manufacturer and model", () => {
  const needles = lensNeedles({
    partNumbers: ["ABC-123", "abc123", "XY"],
    model: "ProLiant",
    specCodes: ["S2600"],
  });
  assert.deepEqual(needles, ["ABC-123", "ProLiant", "S2600"]);
  assert.equal(suggestedItemName(reading()), "Samsung M393A4K40DB3-CWE");
  assert.equal(suggestedItemName(reading({ manufacturer: "", model: "" })), "M393A4K40DB3-CWE");
  assert.equal(conditionFromHints("factory sealed"), "New");
  assert.equal(conditionFromHints("pulled from a server"), "Used");
});
