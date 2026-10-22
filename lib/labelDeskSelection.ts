import { labelLookupChoice } from "@/lib/labelLookup";
import type { LabelItem } from "@/lib/types";

/** Text placed in the field when a row is chosen. An empty SKU uses the name. */
export function labelShownText(item: LabelItem): string {
  return item.sku || item.name;
}

/**
 * A field commit that repeats the text already in state must not clear the list.
 * Blur publishes that text before a click, and clearing the list removes the row
 * that was clicked, so Print never receives an item.
 */
export function labelCommitAction(input: {
  value: string;
  typed: string;
  held: string | null;
  identifier: string;
}): "ignore" | "edit" {
  if (input.value !== input.typed) return "ignore";
  if (input.held !== null && input.held === input.value) return "ignore";
  if (input.value === input.identifier) return "ignore";
  return "edit";
}

/** Enter picks the highlighted row already on screen, including a single match. */
export function labelHighlightedChoice(input: {
  identifier: string;
  settledQuery: string;
  matches: readonly LabelItem[];
  active: number;
}): LabelItem | null {
  const query = input.identifier.trim();
  if (input.matches.length === 0 || input.settledQuery !== query) return null;
  if (input.active < 0 || input.active >= input.matches.length) return null;
  return input.matches[input.active] ?? null;
}

export type LabelSearchOutcome =
  | { type: "select"; item: LabelItem }
  | { type: "list"; matches: LabelItem[]; truncated: boolean }
  | { type: "empty" }
  | { type: "missing" };

/** Exact SKU and a submitted single row select. Several rows stay a list. */
export function labelSearchOutcome(input: {
  submitted: boolean;
  exact: LabelItem | null;
  matches: LabelItem[];
  truncated: boolean;
}): LabelSearchOutcome {
  const choice = labelLookupChoice({
    submitted: input.submitted,
    exact: Boolean(input.exact),
    matchCount: input.matches.length,
    truncated: input.truncated,
  });
  if (choice === "select") {
    const item = input.exact ?? input.matches[0];
    if (!item) return { type: "missing" };
    return { type: "select", item };
  }
  if (choice === "empty") return { type: "empty" };
  return { type: "list", matches: input.matches, truncated: input.truncated };
}

export function labelPrintProblem(input: { hasItem: boolean; templateReady: boolean }): string | null {
  if (!input.hasItem) return "Select an item before printing.";
  if (!input.templateReady) return "The label is not ready to print yet.";
  return null;
}
