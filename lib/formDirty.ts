export const LEAVE_WITHOUT_SAVING = "You have unsaved changes. Leave without saving?";

/** Quote request back, swipe, and in-app links. OK leaves and discards. Cancel stays. */
export const LEAVE_QUOTE_UNSAVED = "This quote has unsaved changes. Leave and discard them?";

export const HISTORY_GUARD_KEY = "itsUnsaved";
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

export function withHistoryGuard(state: unknown): Record<string, unknown> {
  const base = state && typeof state === "object" ? { ...(state as Record<string, unknown>) } : {};
  base[HISTORY_GUARD_KEY] = true;
  return base;
}

export function hasHistoryGuard(state: unknown): boolean {
  return Boolean(state && typeof state === "object" && (state as Record<string, unknown>)[HISTORY_GUARD_KEY] === true);
}

/**
 * Browser back, forward, and a trackpad swipe are history traversals.
 * Cancel the traversal when the quote is dirty and the person stays.
 * A push, such as Save opening the new quote, is not a traversal.
 */
export function shouldCancelTraverse(input: {
  dirty: boolean;
  navigationType: string | undefined;
  cancelable: boolean;
  leaveConfirmed: boolean;
}): boolean {
  if (!input.dirty || !input.cancelable || input.leaveConfirmed) return false;
  return input.navigationType === "traverse";
}

/** First back removes a same-page sentinel. Staying puts it back. Leaving steps back once more. */
export function sentinelBackAction(input: { dirty: boolean; leaveConfirmed: boolean }): "restore-sentinel" | "leave-previous" | "ignore" {
  if (!input.dirty) return "ignore";
  return input.leaveConfirmed ? "leave-previous" : "restore-sentinel";
}

export type NavigateEventLike = Event & {
  navigationType?: string;
  cancelable: boolean;
};

export type NavigationLike = {
  addEventListener: (type: "navigate", listener: (event: NavigateEventLike) => void) => void;
  removeEventListener: (type: "navigate", listener: (event: NavigateEventLike) => void) => void;
};

export function readNavigationApi(target: object): NavigationLike | null {
  if (!("navigation" in target)) return null;
  const nav = (target as { navigation?: unknown }).navigation;
  if (!nav || typeof nav !== "object") return null;
  const candidate = nav as Partial<NavigationLike>;
  if (typeof candidate.addEventListener !== "function" || typeof candidate.removeEventListener !== "function") return null;
  return candidate as NavigationLike;
}

type GuardHistory = {
  readonly state: unknown;
  pushState: (state: unknown, title: string, url: string) => void;
  back: () => void;
};

/**
 * Warn before back or a trackpad swipe discards a dirty quote.
 * Chromium can cancel the traversal. Other browsers get a same-page history
 * sentinel so the first back can be undone.
 */
export function bindUnsavedBackGuard(input: {
  isDirty: () => boolean;
  confirmLeave: () => boolean;
  history: GuardHistory;
  locationHref: () => string;
  addPopState: (listener: () => void) => void;
  removePopState: (listener: () => void) => void;
  navigation: NavigationLike | null;
  armSentinel: boolean;
}): () => void {
  const navigation = input.navigation;
  if (navigation) {
    const onNavigate = (event: NavigateEventLike) => {
      if (!input.isDirty() || event.navigationType !== "traverse" || !event.cancelable) return;
      if (input.confirmLeave()) return;
      event.preventDefault();
    };
    navigation.addEventListener("navigate", onNavigate);
    return () => navigation.removeEventListener("navigate", onNavigate);
  }

  if (!input.armSentinel) return () => undefined;

  const here = input.locationHref();
  input.history.pushState(withHistoryGuard(input.history.state), "", here);
  let leaving = false;
  const onPop = () => {
    if (leaving || !input.isDirty()) return;
    const action = sentinelBackAction({ dirty: true, leaveConfirmed: input.confirmLeave() });
    if (action === "restore-sentinel") {
      input.history.pushState(withHistoryGuard(input.history.state), "", here);
      return;
    }
    leaving = true;
    input.history.back();
  };
  input.addPopState(onPop);
  return () => {
    input.removePopState(onPop);
    if (!leaving && input.locationHref() === here && hasHistoryGuard(input.history.state)) input.history.back();
  };
}

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
