/** app_settings key. Not a credential. Off unless an admin stores a true value. */
export const REPLACEMENT_PICK_SETTING_KEY = "allow_replacement_sku_during_pick";

const REPLACEMENT_ON = new Set(["true", "1", "yes", "on"]);

/** Missing, blank, and every value other than true/1/yes/on stay off. */
export function replacementPickAllowed(value: string | null | undefined): boolean {
  return REPLACEMENT_ON.has((value ?? "").trim().toLowerCase());
}

export function replacementSettingValue(on: boolean): string {
  return on ? "true" : "false";
}

export type ReplacementChoice = {
  id: string;
  itemType: string;
  generic: boolean;
};

/** The SKU stock, picks, and stock units move. Null actual means the planned item. */
export function fulfillItemId(plannedItemId: string, actualItemId: string | null | undefined): string {
  if (actualItemId && actualItemId !== plannedItemId) return actualItemId;
  return plannedItemId;
}

export type ReplacementContext = "approval" | "pick";

/**
 * Whether a planned SKU may become a different fulfilled SKU.
 * Approval is always allowed. Pick is allowed only when the setting is on.
 * A line that already has a pick stays on the SKU that pick moved.
 */
export function replacementProblem(input: {
  context: ReplacementContext;
  settingOn: boolean;
  plannedItemId: string;
  currentActualItemId: string | null;
  nextItemId: string | null;
  nextItem: ReplacementChoice | null;
  pickedQty: number;
  reason: string;
}): string | null {
  const current = fulfillItemId(input.plannedItemId, input.currentActualItemId);
  const next = input.nextItemId ? fulfillItemId(input.plannedItemId, input.nextItemId) : input.plannedItemId;
  if (next === current) return null;
  if (input.context === "pick" && !input.settingOn) return "Replacement SKU during pick is off.";
  if (input.pickedQty > 0) return "Undo the pick before changing the SKU.";
  if (next === input.plannedItemId) return null;
  if (!input.nextItem || input.nextItem.id !== next) return "That part does not exist.";
  if (input.nextItem.itemType !== "Product") return "Replace with a product SKU.";
  if (input.nextItem.generic) return "A generic part cannot be the replacement.";
  if (!input.reason.trim()) return "Enter a reason for the replacement.";
  return null;
}

/**
 * Item a pick debits. Omitting the request keeps the SKU already chosen,
 * including a replacement saved at approval while the pick setting is off.
 */
export function pickFulfillment(input: {
  settingOn: boolean;
  plannedItemId: string;
  actualItemId: string | null;
  requestedItemId: string | null;
  requestedItem: ReplacementChoice | null;
  pickedQty: number;
  reason: string;
}): { ok: true; itemId: string } | { ok: false; message: string } {
  const current = fulfillItemId(input.plannedItemId, input.actualItemId);
  if (input.requestedItemId == null || input.requestedItemId === current) {
    return { ok: true, itemId: current };
  }
  const problem = replacementProblem({
    context: "pick",
    settingOn: input.settingOn,
    plannedItemId: input.plannedItemId,
    currentActualItemId: input.actualItemId,
    nextItemId: input.requestedItemId,
    nextItem: input.requestedItem,
    pickedQty: input.pickedQty,
    reason: input.reason,
  });
  if (problem) return { ok: false, message: problem };
  return { ok: true, itemId: fulfillItemId(input.plannedItemId, input.requestedItemId) };
}

export function replacementChoiceAllowed(item: { itemType: string; generic: boolean }): boolean {
  return item.itemType === "Product" && !item.generic;
}
