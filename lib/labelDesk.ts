export const LABEL_QTY_MAX = 9999;
export const LABEL_COPIES_MAX = 99;

function digits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

/** Digits only, and never above 9999. Empty while the field is being cleared. */
export function labelQuantityDraft(value: string): string {
  const raw = digits(value);
  if (raw === "") return "";
  const n = Number(raw);
  if (n > LABEL_QTY_MAX) return String(LABEL_QTY_MAX);
  return String(n);
}

/** A blank quantity is zero. */
export function labelQuantityCommit(value: string): string {
  const draft = labelQuantityDraft(value);
  return draft === "" ? "0" : draft;
}

/** Digits only, and never above 99. Empty while the field is being cleared. */
export function labelCopiesDraft(value: string): string {
  const raw = digits(value);
  if (raw === "") return "";
  const n = Number(raw);
  if (n > LABEL_COPIES_MAX) return String(LABEL_COPIES_MAX);
  return String(n);
}

/** Copies are 1 to 99. A blank or zero becomes 1. */
export function labelCopiesCommit(value: string): string {
  const draft = labelCopiesDraft(value);
  const n = Number(draft);
  if (draft === "" || n < 1) return "1";
  return String(n);
}
