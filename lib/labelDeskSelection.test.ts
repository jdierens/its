import assert from "node:assert/strict";
import test from "node:test";
import {
  labelCommitAction,
  labelHighlightedChoice,
  labelPrintProblem,
  labelSearchOutcome,
  labelShownText,
} from "./labelDeskSelection.ts";
import type { LabelItem } from "./types.ts";

function item(patch: Partial<LabelItem>): LabelItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sku: "SRM7C-1",
    name: "Rail kit",
    description: "srm7c rail",
    shortCode: "CPU",
    ...patch,
  };
}

const top = item({ id: "1", sku: "SRM7C-1", name: "Rail kit" });
const other = item({ id: "2", sku: "SRM7C-2", name: "Second rail" });

test("choosing a row shows its SKU, and a later blur of that SKU does not search again", () => {
  const shown = labelShownText(top);
  assert.equal(shown, "SRM7C-1");
  assert.equal(
    labelCommitAction({ value: shown, typed: shown, held: shown, identifier: shown }),
    "ignore",
  );
});

test("a click can land because blur of the current search does not clear the list", () => {
  assert.equal(
    labelCommitAction({ value: "srm7c", typed: "srm7c", held: null, identifier: "srm7c" }),
    "ignore",
  );
});

test("a new search string still replaces the selection", () => {
  assert.equal(
    labelCommitAction({ value: "srm7c", typed: "srm7c", held: null, identifier: "srm" }),
    "edit",
  );
  assert.equal(
    labelCommitAction({ value: "other", typed: "srm7c", held: null, identifier: "srm7c" }),
    "ignore",
  );
});

test("Enter on the highlighted row selects it, including when it is the only row", () => {
  const many = labelHighlightedChoice({
    identifier: "srm7c",
    settledQuery: "srm7c",
    matches: [top, other],
    active: 0,
  });
  assert.equal(many?.id, "1");
  const one = labelHighlightedChoice({
    identifier: "srm7c",
    settledQuery: "srm7c",
    matches: [top],
    active: 0,
  });
  assert.equal(one?.sku, "SRM7C-1");
  assert.equal(
    labelHighlightedChoice({
      identifier: "srm7c",
      settledQuery: "other",
      matches: [top],
      active: 0,
    }),
    null,
  );
});

test("an exact SKU and a submitted single match select; several matches stay a list", () => {
  const exact = labelSearchOutcome({
    submitted: false,
    exact: top,
    matches: [top, other],
    truncated: false,
  });
  assert.equal(exact.type, "select");
  if (exact.type === "select") assert.equal(exact.item.sku, "SRM7C-1");

  const single = labelSearchOutcome({
    submitted: true,
    exact: null,
    matches: [top],
    truncated: false,
  });
  assert.equal(single.type, "select");

  const list = labelSearchOutcome({
    submitted: false,
    exact: null,
    matches: [top, other],
    truncated: false,
  });
  assert.equal(list.type, "list");
});

test("printing without an item or a ready label explains why instead of doing nothing", () => {
  assert.equal(labelPrintProblem({ hasItem: false, templateReady: true }), "Select an item before printing.");
  assert.equal(labelPrintProblem({ hasItem: true, templateReady: false }), "The label is not ready to print yet.");
  assert.equal(labelPrintProblem({ hasItem: true, templateReady: true }), null);
});

test("a chosen item with no SKU shows its name", () => {
  assert.equal(labelShownText(item({ sku: "", name: "Loose rail" })), "Loose rail");
});
