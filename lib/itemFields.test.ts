import assert from "node:assert/strict";
import test from "node:test";
import {
  conditionNoteAfterChange,
  countryLabel,
  htsError,
  normalizeLabel,
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

test("country option shows the alpha-3 code and the name", () => {
  assert.equal(countryLabel("USA", "United States of America"), "USA — United States of America");
});
