import assert from "node:assert/strict";
import test from "node:test";
import {
  conditionNoteAfterChange,
  countryLabel,
  countryResolutionMessage,
  htsError,
  isItemType,
  itemTypeOrDefault,
  resolveCountry,
  unitOrDefault,
  normalizeLabel,
  type CountryCode,
} from "./itemFields.ts";

test("manufacturer lookup ignores case and repeated spaces", () => {
  assert.equal(normalizeLabel("SK Hynix"), normalizeLabel("SK  hynix"));
  assert.notEqual(normalizeLabel("SK Hynix"), normalizeLabel("Hynix"));
});

test("HTS accepts dotted digits up to 10 and rejects the rest", () => {
  assert.equal(htsError(""), null);
  assert.equal(htsError("8471.30.0100"), null);
  assert.match(htsError("8471.30.01001") ?? "", /10 digits/);
  assert.match(htsError("8471-30") ?? "", /digits/);
});

test("changing condition clears a note that no longer fits", () => {
  assert.equal(conditionNoteAfterChange("New", "refurbished"), "");
  assert.equal(conditionNoteAfterChange("New", "Factory Sealed"), "Factory Sealed");
  assert.equal(conditionNoteAfterChange("Used", "Factory Sealed"), "");
  assert.equal(conditionNoteAfterChange("Used", "pulled from a server"), "pulled from a server");
});

test("item type accepts the four names and treats anything else as Product", () => {
  assert.equal(isItemType("Kit/Package"), true);
  assert.equal(isItemType("Non-inventory"), true);
  assert.equal(isItemType("Inventory"), false);
  assert.equal(itemTypeOrDefault(null), "Product");
  assert.equal(itemTypeOrDefault("Service"), "Service");
});

test("unit defaults to Piece and keeps a known name", () => {
  assert.equal(unitOrDefault(null), "Piece");
  assert.equal(unitOrDefault("lbs"), "Lbs");
  assert.equal(unitOrDefault("Box"), "Piece");
  assert.equal(unitOrDefault("Each", ["Each", "Piece"]), "Each");
});

test("country option shows the alpha-3 code and the name", () => {
  assert.equal(countryLabel("USA", "United States of America"), "USA — United States of America");
});

const COUNTRIES: CountryCode[] = [
  { alpha3: "IND", alpha2: "IN", name: "India" },
  { alpha3: "IDN", alpha2: "ID", name: "Indonesia" },
  { alpha3: "USA", alpha2: "US", name: "United States of America" },
];

test("a country name or code resolves to alpha-3", () => {
  assert.deepEqual(resolveCountry("", COUNTRIES), { status: "empty" });
  assert.deepEqual(resolveCountry("   ", COUNTRIES), { status: "empty" });
  assert.deepEqual(resolveCountry("IND", COUNTRIES), { status: "match", alpha3: "IND" });
  assert.deepEqual(resolveCountry("ind", COUNTRIES), { status: "match", alpha3: "IND" });
  assert.deepEqual(resolveCountry("IN", COUNTRIES), { status: "match", alpha3: "IND" });
  assert.deepEqual(resolveCountry("India", COUNTRIES), { status: "match", alpha3: "IND" });
  assert.deepEqual(resolveCountry("  INDIA  ", COUNTRIES), { status: "match", alpha3: "IND" });
  assert.deepEqual(resolveCountry("IND — India", COUNTRIES), { status: "match", alpha3: "IND" });
  assert.deepEqual(resolveCountry("IND - India", COUNTRIES), { status: "match", alpha3: "IND" });
  assert.deepEqual(resolveCountry("United States of America", COUNTRIES), { status: "match", alpha3: "USA" });
  assert.deepEqual(resolveCountry("Ind", COUNTRIES), { status: "match", alpha3: "IND" });
  assert.deepEqual(resolveCountry("ia", COUNTRIES), { status: "ambiguous", query: "ia" });
  assert.deepEqual(resolveCountry("Narnia", COUNTRIES), { status: "none", query: "Narnia" });
  assert.match(countryResolutionMessage({ status: "none", query: "INDIA" }) ?? "", /No country matches INDIA/);
  assert.equal(countryResolutionMessage({ status: "ambiguous", query: "ia" }), "Choose a country from the list.");
  assert.equal(countryResolutionMessage({ status: "match", alpha3: "IND" }), null);
});
