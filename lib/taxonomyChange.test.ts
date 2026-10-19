import assert from "node:assert/strict";
import test from "node:test";
import {
  notesWithLostValues,
  planTaxonomyChange,
  replaceSkuShortCode,
  skuEmbedsShortCode,
  taxonomyChangeLabel,
  type ItemFieldValue,
  type TaxonomyFieldLink,
} from "./taxonomyChange.ts";

const memory: TaxonomyFieldLink[] = [
  { id: "cap", name: "capacity_gb", required: false, sortOrder: 1 },
  { id: "family", name: "family", required: false, sortOrder: 2 },
  { id: "form", name: "form_factor", required: false, sortOrder: 3 },
  { id: "rank", name: "ranking", required: false, sortOrder: 4 },
  { id: "speed", name: "speed", required: true, sortOrder: 5 },
];

const disk: TaxonomyFieldLink[] = [
  { id: "form", name: "form_factor", required: false, sortOrder: 1 },
  { id: "iface", name: "interface", required: false, sortOrder: 2 },
  { id: "size", name: "size", required: true, sortOrder: 4 },
];

const values: ItemFieldValue[] = [
  { attributeId: "cap", name: "capacity_gb", value: "32" },
  { attributeId: "family", name: "family", value: "DDR5" },
  { attributeId: "form", name: "form_factor", value: "registered DIMM" },
  { attributeId: "rank", name: "ranking", value: "   " },
  { attributeId: "speed", name: "speed", value: "4800" },
];

test("shared fields are kept and only valued fields that the new taxonomy lacks are lost", () => {
  const plan = planTaxonomyChange(memory, disk, values);
  assert.deepEqual(
    plan.kept.map((field) => `${field.name}=${field.value}`),
    ["form_factor=registered DIMM"],
  );
  assert.deepEqual(
    plan.lost.map((field) => `${field.name}=${field.value}`),
    ["capacity_gb=32", "family=DDR5", "speed=4800"],
  );
  assert.equal(plan.lost.some((field) => field.name === "ranking"), false);
  assert.deepEqual(
    plan.added.map((field) => `${field.name}:${field.required}`),
    ["interface:false", "size:true"],
  );
});

test("the confirm label counts removed values", () => {
  assert.equal(taxonomyChangeLabel(0), "Change taxonomy");
  assert.equal(taxonomyChangeLabel(1), "Change taxonomy and remove 1 value");
  assert.equal(taxonomyChangeLabel(3), "Change taxonomy and remove 3 values");
});

test("lost values can be appended to notes", () => {
  const lost = [{ name: "capacity_gb", value: "32" }, { name: "speed", value: "4800" }];
  assert.equal(notesWithLostValues("", lost), "capacity_gb: 32\nspeed: 4800");
  assert.equal(notesWithLostValues("Already noted.", lost), "Already noted.\ncapacity_gb: 32\nspeed: 4800");
  assert.equal(notesWithLostValues("Already noted.", []), "Already noted.");
});

test("a sku is rewritten only when it contains the short code as its own token", () => {
  assert.equal(skuEmbedsShortCode("107075", "MEM"), false);
  assert.equal(skuEmbedsShortCode("MEMORY", "MEM"), false);
  assert.equal(skuEmbedsShortCode("MEM-107075", "MEM"), true);
  assert.equal(skuEmbedsShortCode("107075MEM", "mem"), true);
  assert.equal(replaceSkuShortCode("MEM-107075", "MEM", "HDD"), "HDD-107075");
  assert.equal(replaceSkuShortCode("107075mem", "MEM", "hdd"), "107075HDD");
  assert.equal(replaceSkuShortCode("107075", "MEM", "HDD"), "107075");
  assert.equal(replaceSkuShortCode("MEMORY", "MEM", "HDD"), "MEMORY");
});
