import assert from "node:assert/strict";
import test from "node:test";
import {
  bindUnsavedBackGuard,
  hasHistoryGuard,
  isDirty,
  isGuardedNavigation,
  isSaveShortcut,
  LEAVE_QUOTE_UNSAVED,
  LEAVE_WITHOUT_SAVING,
  readNavigationApi,
  sentinelBackAction,
  shouldCancelTraverse,
  withHistoryGuard,
} from "./formDirty.ts";

test("a form is clean when the values match the loaded snapshot", () => {
  const loaded = { sku: "107075", notes: "", attrs: { speed: "4800", family: "DDR5" } };
  assert.equal(isDirty({ attrs: { family: "DDR5", speed: "4800" }, notes: "", sku: "107075" }, loaded), false);
});

test("editing and then reverting clears the dirty flag", () => {
  const loaded = { name: "Samsung DIMM", quantity: "1" };
  assert.equal(isDirty({ name: "Samsung DIMM 32GB", quantity: "1" }, loaded), true);
  assert.equal(isDirty({ name: "Samsung DIMM", quantity: "1" }, loaded), false);
});

test("nested contact addresses compare by value", () => {
  const loaded = { displayName: "Ada", billingAddress: { city: "Henderson", line1: "" } };
  assert.equal(
    isDirty({ displayName: "Ada", billingAddress: { line1: "", city: "Las Vegas" } }, loaded),
    true,
  );
  assert.equal(
    isDirty({ billingAddress: { city: "Henderson", line1: "" }, displayName: "Ada" }, loaded),
    false,
  );
});

test("Ctrl or Cmd+S is the save shortcut", () => {
  assert.equal(
    isSaveShortcut({ key: "s", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }),
    true,
  );
  assert.equal(
    isSaveShortcut({ key: "S", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    true,
  );
  assert.equal(
    isSaveShortcut({ key: "s", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }),
    false,
  );
  assert.equal(
    isSaveShortcut({ key: "s", metaKey: false, ctrlKey: true, altKey: true, shiftKey: false }),
    false,
  );
  assert.equal(
    isSaveShortcut({ key: "s", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }),
    false,
  );
  assert.equal(
    isSaveShortcut({
      key: "s",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: true,
    }),
    false,
  );
});

test("same-tab links are guarded and new tabs, downloads, and hashes are not", () => {
  const click = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };
  assert.equal(isGuardedNavigation(click, { href: "/items", target: null, download: false }), true);
  assert.equal(
    isGuardedNavigation(click, { href: "/labels?sku=1", target: "_blank", download: false }),
    false,
  );
  assert.equal(isGuardedNavigation(click, { href: "/items.csv", target: null, download: true }), false);
  assert.equal(isGuardedNavigation(click, { href: "#notes", target: null, download: false }), false);
  assert.equal(isGuardedNavigation(click, null), false);
  assert.equal(
    isGuardedNavigation({ ...click, metaKey: true }, { href: "/items", target: null, download: false }),
    false,
  );
  assert.equal(LEAVE_WITHOUT_SAVING.includes("unsaved"), true);
  assert.equal(LEAVE_QUOTE_UNSAVED.includes("discard"), true);
});

test("browser back on a dirty quote can stay or leave", () => {
  assert.equal(shouldCancelTraverse({ dirty: true, navigationType: "traverse", cancelable: true, leaveConfirmed: false }), true);
  assert.equal(shouldCancelTraverse({ dirty: true, navigationType: "traverse", cancelable: true, leaveConfirmed: true }), false);
  assert.equal(shouldCancelTraverse({ dirty: false, navigationType: "traverse", cancelable: true, leaveConfirmed: false }), false);
  assert.equal(shouldCancelTraverse({ dirty: true, navigationType: "push", cancelable: true, leaveConfirmed: false }), false);
  assert.equal(shouldCancelTraverse({ dirty: true, navigationType: "traverse", cancelable: false, leaveConfirmed: false }), false);
  assert.equal(sentinelBackAction({ dirty: true, leaveConfirmed: false }), "restore-sentinel");
  assert.equal(sentinelBackAction({ dirty: true, leaveConfirmed: true }), "leave-previous");
  assert.equal(sentinelBackAction({ dirty: false, leaveConfirmed: true }), "ignore");
  const guarded = withHistoryGuard({ __NA: true });
  assert.equal(guarded.__NA, true);
  assert.equal(hasHistoryGuard(guarded), true);
  assert.equal(hasHistoryGuard({ __NA: true }), false);
  assert.equal(readNavigationApi({}), null);
});

test("a trackpad back restores the quote unless leaving is confirmed", () => {
  const entries: { url: string; state: unknown }[] = [
    { url: "https://example.test/pricing/quotes", state: null },
    { url: "https://example.test/pricing/quotes/new", state: { __NA: true } },
  ];
  let index = 1;
  const pops: (() => void)[] = [];
  const history = {
    get state() {
      return entries[index]?.state;
    },
    pushState(state: unknown, _title: string, url: string) {
      entries.push({ url, state });
      index = entries.length - 1;
    },
    back() {
      index -= 1;
      for (const listener of [...pops]) listener();
    },
  };
  let stay = true;
  const release = bindUnsavedBackGuard({
    isDirty: () => true,
    confirmLeave: () => !stay,
    history,
    locationHref: () => entries[index]?.url ?? "",
    addPopState: (listener) => pops.push(listener),
    removePopState: (listener) => {
      const at = pops.indexOf(listener);
      if (at >= 0) pops.splice(at, 1);
    },
    navigation: null,
    armSentinel: true,
  });
  assert.equal(entries.length, 3);
  assert.equal(hasHistoryGuard(entries[2]?.state), true);
  index = 1;
  pops[0]?.();
  assert.equal(hasHistoryGuard(history.state), true);
  assert.equal(entries.at(-1)?.url, "https://example.test/pricing/quotes/new");
  stay = false;
  const beforeLeave = entries.length;
  index = beforeLeave - 2;
  pops[0]?.();
  assert.ok(index < beforeLeave - 2);
  release();
});

test("a cancelable back swipe is prevented when the quote stays dirty", () => {
  type Swipe = { navigationType: string; cancelable: boolean; preventDefault: () => void };
  const prevented: Swipe[] = [];
  const listeners: ((event: Swipe) => void)[] = [];
  const navigation = {
    addEventListener(_type: "navigate", listener: (event: Swipe) => void) {
      listeners.push(listener);
    },
    removeEventListener(_type: "navigate", listener: (event: Swipe) => void) {
      const at = listeners.indexOf(listener);
      if (at >= 0) listeners.splice(at, 1);
    },
  };
  const release = bindUnsavedBackGuard({
    isDirty: () => true,
    confirmLeave: () => false,
    history: { state: null, pushState() {}, back() {} },
    locationHref: () => "https://example.test/pricing/quotes/new",
    addPopState() {},
    removePopState() {},
    navigation,
    armSentinel: true,
  });
  const event: Swipe = {
    navigationType: "traverse",
    cancelable: true,
    preventDefault() {
      prevented.push(event);
    },
  };
  listeners[0]?.(event);
  assert.equal(prevented.length, 1);
  release();
  assert.equal(listeners.length, 0);
});
