import assert from "node:assert/strict";
import test from "node:test";
import {
  isDirty,
  isGuardedNavigation,
  isSaveShortcut,
  LEAVE_WITHOUT_SAVING,
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
});
