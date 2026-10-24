import assert from "node:assert/strict";
import test from "node:test";
import {
  attributeValuesEqual,
  clearSearchFilters,
  filtersFromFields,
  itemMatchesFilters,
  matchBadge,
  normalizePartNumber,
  parseAttributeSearchParams,
  seedMatchCount,
  stripMoneyFields,
  valueInRange,
  type SearchField,
} from "./itemAttributeSearch.ts";

const fields: SearchField[] = [
  { id: "cap", name: "capacity_gb", dataType: "integer", usesList: true },
  { id: "fam", name: "family", dataType: "text", usesList: true },
  { id: "speed", name: "speed", dataType: "integer", usesList: false },
];

test("part numbers normalize like price quotes", () => {
  assert.equal(normalizePartNumber(" n3k-c3064pq/10ge "), "N3KC3064PQ10GE");
  assert.equal(normalizePartNumber("EX3300-24P"), "EX330024P");
});

test("list filters are OR inside a field and AND across fields", () => {
  const parsed = parseAttributeSearchParams(
    new URLSearchParams("mode=taxonomy&tax=mem&attr.capacity_gb=64&attr.capacity_gb=32&attr.family=DDR5&page=2"),
  );
  assert.equal(parsed.tax, "MEM");
  assert.deepEqual(parsed.lists.capacity_gb, ["64", "32"]);
  const filters = filtersFromFields(fields, parsed);
  const hit = [
    { attributeId: "cap", value: "32" },
    { attributeId: "fam", value: "ddr5" },
  ];
  const miss = [
    { attributeId: "cap", value: "64" },
    { attributeId: "fam", value: "DDR4" },
  ];
  assert.equal(itemMatchesFilters(hit, filters), true);
  assert.equal(itemMatchesFilters(miss, filters), false);
  assert.equal(attributeValuesEqual("64", "64.0"), true);
});

test("a numeric field uses a min and max, and the seed ranks exact values", () => {
  const parsed = parseAttributeSearchParams(new URLSearchParams("min.speed=4800&max.speed=6400&seed.family=DDR5&seed.capacity_gb=64"));
  const filters = filtersFromFields(fields, parsed);
  assert.equal(valueInRange("5600", "4800", "6400"), true);
  assert.equal(valueInRange("3200", "4800", "6400"), false);
  assert.equal(
    itemMatchesFilters([{ attributeId: "speed", value: "5600" }], filters),
    true,
  );
  const attributes = [
    { attributeId: "fam", value: "DDR5" },
    { attributeId: "cap", value: "32" },
  ];
  assert.equal(seedMatchCount(attributes, filters.seed), 1);
  assert.equal(matchBadge(1, 2), "matches 1 of 2 fields");
  assert.equal(matchBadge(2, 0), null);
});

test("money fields are removed when the caller cannot view them", () => {
  const row = stripMoneyFields(
    { id: "1", sku: "100", msrp: "9.00", ecommerce_price: "8", name: "Module" },
    false,
  );
  assert.deepEqual(row, { id: "1", sku: "100", name: "Module" });
  const kept = stripMoneyFields({ msrp: "9.00", sku: "100" }, true);
  assert.equal(kept.msrp, "9.00");
});

test("clear drops filters and the part number and keeps the taxonomy", () => {
  const params = new URLSearchParams("mode=part&tax=MEM&part=EX3300-24P&attr.family=DDR5&seed.family=DDR5&exclude=abc&seeded=1&page=3");
  clearSearchFilters(params);
  assert.equal(params.get("mode"), "part");
  assert.equal(params.get("tax"), "MEM");
  assert.equal(params.get("part"), null);
  assert.equal(params.get("attr.family"), null);
  assert.equal(params.get("seeded"), null);
});
