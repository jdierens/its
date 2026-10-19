export const LEAVE_WITHOUT_SAVING = "You have unsaved changes. Leave without saving?";
export const SAVE_BEFORE_LABEL = "Save changes first so the label matches?";
export const SAVE_BEFORE_TAXONOMY =
  "Save changes first so the taxonomy change uses the saved item?";

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = canonicalize(record[key]);
    return out;
  }
  return value;
}

export function isDirty(current: unknown, baseline: unknown): boolean {
  return JSON.stringify(canonicalize(current)) !== JSON.stringify(canonicalize(baseline));
}

export type ShortcutEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
};

export function isSaveShortcut(event: ShortcutEvent): boolean {
  if (event.isComposing || event.altKey || event.shiftKey) return false;
  if (event.key.toLowerCase() !== "s") return false;
  return event.metaKey || event.ctrlKey;
}

export type LeaveClick = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
};

export type LeaveAnchor = {
  href: string | null;
  target: string | null;
  download: boolean;
};

export function isGuardedNavigation(event: LeaveClick, anchor: LeaveAnchor | null): boolean {
  if (!anchor || event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target === "_blank" || anchor.download) return false;
  const href = anchor.href?.trim() ?? "";
  if (!href || href.startsWith("#")) return false;
  const lower = href.toLowerCase();
  if (lower.startsWith("mailto:") || lower.startsWith("tel:") || lower.startsWith("javascript:")) {
    return false;
  }
  return true;
}
