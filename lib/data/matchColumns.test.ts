import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRememberedMapping,
  autoMatch,
  missingRequired,
  normalizeHeader,
  sampleValues,
  unmappedHeaders,
} from "./matchColumns.ts";
import { mappingColumns } from "./registry.ts";
import { BINS_TABLE } from "./registry.ts";

const columns = mappingColumns(BINS_TABLE);

test("headers match ITS fields by normalized name and synonym", () => {
  assert.equal(normalizeHeader("\uFEFFBin #"), "bin");
  assert.equal(normalizeHeader("Bin_code"), "bin code");
  const headers = ["Bin #", "Shelf", "Comment", "Type", "Color"];
  const mapping = autoMatch(headers, columns);
  assert.equal(mapping.code, "Bin #");
  assert.equal(mapping.location, "Shelf");
  assert.equal(mapping.note, "Comment");
  assert.equal(mapping.type, "Type");
  assert.deepEqual(unmappedHeaders(headers, mapping), ["Color"]);
  assert.deepEqual(missingRequired(columns, mapping), []);
  assert.deepEqual(sampleValues([["1234", "HWS.01.02.03", "a", "Box", "blue"], ["1234", "HWS.00.00.00", "b", "Box", ""]], headers, "Bin #"), [
    "1234",
  ]);
});

test("container maps to code when no closer bin header is present", () => {
  const mapping = autoMatch(["Container", "Loc"], columns);
  assert.equal(mapping.code, "Container");
  assert.equal(mapping.location, "Loc");
  assert.equal(mapping.note, null);
});

test("a remembered mapping is reused when the source column is in this file", () => {
  const headers = ["Bin code", "Location", "Notes"];
  const auto = autoMatch(headers, columns);
  const remembered = applyRememberedMapping(headers, auto, {
    code: "Bin code",
    location: null,
    note: "Notes",
    type: "Missing",
  });
  assert.equal(remembered.code, "Bin code");
  assert.equal(remembered.location, null);
  assert.equal(remembered.note, "Notes");
  assert.equal(remembered.type, null);
  assert.deepEqual(
    missingRequired(columns, { ...remembered, code: null }).map((column) => column.key),
    ["code"],
  );
});
