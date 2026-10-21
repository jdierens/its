import assert from "node:assert/strict";
import test from "node:test";
import {
  descriptionSnippet,
  escapeLike,
  labelLikeOr,
  labelLookupChoice,
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

test("like wildcards in the query are escaped and the filter stays one value", () => {
  assert.equal(escapeLike("100%_a\\b"), "100\\%\\_a\\\\b");
  assert.equal(
    labelLikeOr(`100%_a,b"c`),
    `sku.ilike."%100\\%\\_a,b""c%",name.ilike."%100\\%\\_a,b""c%",description.ilike."%100\\%\\_a,b""c%"`,
  );
});

test("exact SKU selects immediately, including while typing", () => {
  assert.equal(labelLookupChoice({ submitted: false, exact: true, matchCount: 8, truncated: true }), "select");
});

test("a SKU prefix that matches one row waits for Enter", () => {
  assert.equal(labelLookupChoice({ submitted: false, exact: false, matchCount: 1, truncated: false }), "list");
  assert.equal(labelLookupChoice({ submitted: true, exact: false, matchCount: 1, truncated: false }), "select");
});

test("several matches stay a list, and a capped result is not treated as the only row", () => {
  assert.equal(labelLookupChoice({ submitted: true, exact: false, matchCount: 4, truncated: false }), "list");
  assert.equal(labelLookupChoice({ submitted: true, exact: false, matchCount: 1, truncated: true }), "list");
  assert.equal(labelLookupChoice({ submitted: true, exact: false, matchCount: 0, truncated: false }), "empty");
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
