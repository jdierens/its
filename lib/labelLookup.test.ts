import assert from "node:assert/strict";
import test from "node:test";
import {
  LABEL_RESULT_CAP,
  descriptionSnippet,
  escapeLike,
  labelLikeOr,
  labelLookupChoice,
  labelMatchLimit,
  labelResultApplies,
  labelTaxonomyFields,
  sortLabelMatches,
} from "./labelLookup.ts";
import type { LabelItem } from "./types.ts";

function item(patch: Partial<LabelItem>): LabelItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sku: "107132",
    name: "Drive",
    description: "",
    shortCode: "HDD",
    ...patch,
  };
}

test("a label search cap stays at 25 unless a larger limit is asked for", () => {
  assert.equal(labelMatchLimit(undefined), LABEL_RESULT_CAP);
  assert.equal(labelMatchLimit(Number.NaN), LABEL_RESULT_CAP);
  assert.equal(labelMatchLimit(0), LABEL_RESULT_CAP);
  assert.equal(labelMatchLimit(200.9), 200);
});

test("taxonomy codes come from the embedded row", () => {
  assert.deepEqual(labelTaxonomyFields({ short_code: "ssd", long_code: "dsk/ssd", name: "SSD" }), {
    shortCode: "SSD",
    longCode: "DSK/SSD",
    taxonomyName: "SSD",
  });
  assert.deepEqual(labelTaxonomyFields(null), { shortCode: null, longCode: null, taxonomyName: null });
});

test("like wildcards in the query are escaped and the filter stays one value", () => {
  assert.equal(escapeLike("100%_a\\b"), "100\\%\\_a\\\\b");
  assert.equal(
    labelLikeOr(`100%_a,b"c`),
    `sku.ilike."%100\\%\\_a,b""c%",name.ilike."%100\\%\\_a,b""c%",description.ilike."%100\\%\\_a,b""c%"`,
  );
});

test("a live label result is dropped once the field has moved on", () => {
  assert.equal(labelResultApplies("CPU\\PLAT", "CPU", false), false);
  assert.equal(labelResultApplies("CPU", "CPU", false), true);
  assert.equal(labelResultApplies("CPU\\PLAT", "CPU", true), true);
});

test("exact SKU selects immediately, including while typing", () => {
  assert.equal(labelLookupChoice({ submitted: false, exact: true, matchCount: 8, truncated: true }), "select");
});

test("a SKU prefix that matches one row waits for Enter", () => {
  assert.equal(labelLookupChoice({ submitted: false, exact: false, matchCount: 1, truncated: false }), "list");
  assert.equal(labelLookupChoice({ submitted: true, exact: false, matchCount: 1, truncated: false }), "select");
});

test("receiving selects the only row without Enter, and still waits when more rows may exist", () => {
  assert.equal(
    labelLookupChoice({ submitted: false, exact: false, matchCount: 1, truncated: false, loneSelects: true }),
    "select",
  );
  assert.equal(
    labelLookupChoice({ submitted: false, exact: false, matchCount: 1, truncated: true, loneSelects: true }),
    "list",
  );
  assert.equal(
    labelLookupChoice({ submitted: false, exact: false, matchCount: 2, truncated: false, loneSelects: true }),
    "list",
  );
});

test("several matches stay a list, and a capped result is not treated as the only row", () => {
  assert.equal(labelLookupChoice({ submitted: true, exact: false, matchCount: 4, truncated: false }), "list");
  assert.equal(labelLookupChoice({ submitted: true, exact: false, matchCount: 1, truncated: true }), "list");
  assert.equal(labelLookupChoice({ submitted: true, exact: false, matchCount: 0, truncated: false }), "empty");
});

test("a hyphenated query ranks the name that stores the part without those hyphens", () => {
  const sorted = sortLabelMatches(
    [
      item({ id: "ccat", sku: "102847", name: "CARD\\NIC\\E30\\100G_2Q\\LP-FH\\MCX516A-CCAT" }),
      item({ id: "short", sku: "999", name: "CDAT" }),
      item({ id: "fsb", sku: "107109", name: "CARD\\NIC\\E30\\100G_2Q\\LP-FH\\MCX516A-CDAT_FSB" }),
      item({ id: "cdat", sku: "106823", name: "CARD\\NIC\\E30\\100G_2Q\\LP-FH\\MCX516A-CDAT" }),
    ],
    "MCX-516A-CDAT",
  );
  assert.deepEqual(sorted.map((row) => row.sku), ["106823", "107109", "999", "102847"]);
});

test("matches put the SKU hit ahead of a name or description hit", () => {
  const sorted = sortLabelMatches(
    [
      item({ id: "2", sku: "200", name: "SRM7C tray", description: "" }),
      item({ id: "3", sku: "300", name: "Cable", description: "uses SRM7C" }),
      item({ id: "1", sku: "SRM7C", name: "Rail", description: "" }),
    ],
    "srm7c",
  );
  assert.deepEqual(sorted.map((row) => row.sku), ["SRM7C", "200", "300"]);
});

test("the description snippet is one line", () => {
  assert.equal(descriptionSnippet("  rail \n kit  "), "rail kit");
  assert.equal(descriptionSnippet("a".repeat(90)).endsWith("…"), true);
  assert.equal(descriptionSnippet("a".repeat(90)).length <= 80, true);
});
