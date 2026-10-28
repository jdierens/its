import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { pickSheetPlace } from "./pickSheet.ts";
import {
  fulfillItemId,
  pickFulfillment,
  replacementChoiceAllowed,
  replacementPickAllowed,
  replacementProblem,
  replacementSettingValue,
} from "./skuReplacement.ts";

const sql = readFileSync(
  new URL("../supabase/migrations/20261028073000_so_sku_replacement.sql", import.meta.url),
  "utf8",
);

const planned = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const replacement = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const product = (id: string, generic = false) => ({ id, itemType: "Product", generic });

describe("replacement setting", () => {
  it("stays off unless the stored value is explicitly on", () => {
    assert.equal(replacementPickAllowed(null), false);
    assert.equal(replacementPickAllowed(""), false);
    assert.equal(replacementPickAllowed("false"), false);
    assert.equal(replacementPickAllowed("off"), false);
    assert.equal(replacementPickAllowed("TRUE"), true);
    assert.equal(replacementPickAllowed(" yes "), true);
    assert.equal(replacementSettingValue(false), "false");
    assert.equal(replacementSettingValue(true), "true");
  });
});

describe("replacement at approval and pick", () => {
  it("lets approval map 106683 to 107021 while the pick setting is off", () => {
    assert.equal(
      replacementProblem({
        context: "approval",
        settingOn: false,
        plannedItemId: planned,
        currentActualItemId: null,
        nextItemId: replacement,
        nextItem: product(replacement),
        pickedQty: 0,
        reason: "Different grade",
      }),
      null,
    );
    assert.equal(fulfillItemId(planned, replacement), replacement);
    assert.equal(fulfillItemId(planned, null), planned);
    assert.equal(fulfillItemId(planned, planned), planned);
  });

  it("blocks a pick-time replacement when the setting is off and allows it when on", () => {
    const blocked = pickFulfillment({
      settingOn: false,
      plannedItemId: planned,
      actualItemId: null,
      requestedItemId: replacement,
      requestedItem: product(replacement),
      pickedQty: 0,
      reason: "Different grade",
    });
    assert.deepEqual(blocked, { ok: false, message: "Replacement SKU during pick is off." });

    const allowed = pickFulfillment({
      settingOn: true,
      plannedItemId: planned,
      actualItemId: null,
      requestedItemId: replacement,
      requestedItem: product(replacement),
      pickedQty: 0,
      reason: "Micron to Samsung",
    });
    assert.deepEqual(allowed, { ok: true, itemId: replacement });
  });

  it("keeps an approval replacement when pick later omits a new SKU", () => {
    const kept = pickFulfillment({
      settingOn: false,
      plannedItemId: planned,
      actualItemId: replacement,
      requestedItemId: null,
      requestedItem: null,
      pickedQty: 0,
      reason: "",
    });
    assert.deepEqual(kept, { ok: true, itemId: replacement });
  });

  it("rejects a generic, a service, a missing reason, and a change after a pick", () => {
    assert.equal(
      replacementProblem({
        context: "pick",
        settingOn: true,
        plannedItemId: planned,
        currentActualItemId: null,
        nextItemId: replacement,
        nextItem: product(replacement, true),
        pickedQty: 0,
        reason: "Physical part",
      }),
      "A generic part cannot be the replacement.",
    );
    assert.equal(
      replacementProblem({
        context: "approval",
        settingOn: false,
        plannedItemId: planned,
        currentActualItemId: null,
        nextItemId: replacement,
        nextItem: { id: replacement, itemType: "Service", generic: false },
        pickedQty: 0,
        reason: "Not stock",
      }),
      "Replace with a product SKU.",
    );
    assert.equal(
      replacementProblem({
        context: "pick",
        settingOn: true,
        plannedItemId: planned,
        currentActualItemId: null,
        nextItemId: replacement,
        nextItem: product(replacement),
        pickedQty: 0,
        reason: "  ",
      }),
      "Enter a reason for the replacement.",
    );
    assert.equal(
      replacementProblem({
        context: "pick",
        settingOn: true,
        plannedItemId: planned,
        currentActualItemId: null,
        nextItemId: replacement,
        nextItem: product(replacement),
        pickedQty: 1,
        reason: "Different grade",
      }),
      "Undo the pick before changing the SKU.",
    );
    assert.equal(replacementChoiceAllowed({ itemType: "Product", generic: false }), true);
    assert.equal(replacementChoiceAllowed({ itemType: "Service", generic: false }), false);
    assert.equal(replacementChoiceAllowed({ itemType: "Product", generic: true }), false);
  });
});

describe("pick sheet services", () => {
  it("omits service, freight, and non-stock lines from the pick ticket", () => {
    assert.equal(pickSheetPlace({ lineKind: "product", itemType: "Product" }), "pick");
    assert.equal(pickSheetPlace({ lineKind: "kit", itemType: "Kit/Package" }), "pick");
    assert.equal(pickSheetPlace({ lineKind: "service", itemType: "Service" }), "omit");
    assert.equal(pickSheetPlace({ lineKind: "service", itemType: "Product" }), "omit");
    assert.equal(pickSheetPlace({ lineKind: "product", itemType: "Service" }), "omit");
    assert.equal(pickSheetPlace({ lineKind: "freight", itemType: "Service" }), "omit");
    assert.equal(pickSheetPlace({ lineKind: "fee", itemType: "Product" }), "omit");
    assert.equal(pickSheetPlace({ lineKind: "product", itemType: "Non-inventory" }), "omit");
  });
});

describe("replacement migration", () => {
  it("stores the setting off, gates pick, and debits the fulfilled SKU", () => {
    assert.match(sql, /allow_replacement_sku_during_pick/);
    assert.match(sql, /values \('allow_replacement_sku_during_pick', 'false'\)/);
    assert.match(sql, /Replacement SKU during pick is off/);
    assert.match(sql, /so_line_allocations_actual_item_id_fkey/);
    assert.match(sql, /Enter a reason for the replacement/);
    assert.match(sql, /A generic part cannot be the replacement/);
    assert.match(sql, /Replace with a product SKU/);
    assert.match(sql, /when p_kind = 'service' then 'omit'/);
    assert.match(sql, /p_item_type = 'Service' and p_kind is distinct from 'freight'/);
    assert.match(sql, /coalesce\(a\.actual_item_id, a\.item_id\)/);
    assert.match(sql, /adjust_bin_cycle_qty\(v_source_cycle, p_from, v_item, -p_qty\)/);
    assert.match(sql, /relocate_stock_units/);
  });
});
