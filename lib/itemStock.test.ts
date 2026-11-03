import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { itemEntriesFromJson, onHandFromRpc, stockRpcMissing } from "@/lib/itemStock";

describe("item on hand", () => {
  it("reads the integer the for-sale function returns", () => {
    assert.equal(onHandFromRpc(168), 168);
    assert.equal(onHandFromRpc(0), 0);
    assert.equal(onHandFromRpc("14"), 14);
    assert.equal(onHandFromRpc(12.9), 12);
    assert.equal(onHandFromRpc(null), 0);
    assert.equal(onHandFromRpc("nope"), 0);
    assert.equal(onHandFromRpc(Number.NaN), 0);
  });

  it("treats a missing stock function as not deployed", () => {
    assert.equal(stockRpcMissing(null), false);
    assert.equal(stockRpcMissing({ code: "PGRST202", message: "missing" }), true);
    assert.equal(stockRpcMissing({ message: "Could not find the function public.list_item_entries in the schema cache" }), true);
    assert.equal(stockRpcMissing({ message: "permission denied" }), false);
  });
});

describe("item entries", () => {
  it("keeps a signed quantity and drops a row with no id", () => {
    const rows = itemEntriesFromJson([
      {
        id: "event:1",
        occurred_at: "2026-11-03T12:00:00Z",
        initials: "JD",
        what: "Received",
        from_place: "AZSIM6930",
        bin: "Box 10002-C",
        qty: 14,
      },
      {
        id: "event:2",
        occurred_at: "2026-11-03T13:00:00Z",
        initials: "OP",
        what: "Adjusted",
        from_place: "Corrects a receipt",
        bin: "Box 10002-C",
        qty: -4,
      },
      { what: "Moved" },
      "nope",
    ]);
    assert.deepEqual(rows, [
      {
        id: "event:1",
        occurredAt: "2026-11-03T12:00:00Z",
        initials: "JD",
        what: "Received",
        fromPlace: "AZSIM6930",
        bin: "Box 10002-C",
        qty: 14,
      },
      {
        id: "event:2",
        occurredAt: "2026-11-03T13:00:00Z",
        initials: "OP",
        what: "Adjusted",
        fromPlace: "Corrects a receipt",
        bin: "Box 10002-C",
        qty: -4,
      },
    ]);
    assert.deepEqual(itemEntriesFromJson({ id: "event:1" }), []);
  });

  it("does not read items.quantity for the on-hand figure", () => {
    const source = readFileSync(new URL("../components/ItemForm.tsx", import.meta.url), "utf8");
    assert.equal(source.includes("item.quantity"), false);
    assert.match(source, /fetchItemOnHand/);
    assert.match(source, /ItemEntries/);
  });
});
