import assert from "node:assert/strict";
import test from "node:test";
import { isMemoryTaxonomy, memoryAttributeSlot, memorySlotRank, type MemorySlot } from "./itemFormDensity.ts";

test("memory attributes line up as family, speed, capacity, ranking, form factor", () => {
  const names = ["form factor", "voltage", "ranking", "capacity_gb", "speed", "Family"];
  const lead = names
    .map((name, index) => ({ name, index, slot: memoryAttributeSlot(name) }))
    .filter((row): row is { name: string; index: number; slot: MemorySlot } => row.slot !== null)
    .sort((a, b) => memorySlotRank(a.slot) - memorySlotRank(b.slot) || a.index - b.index)
    .map((row) => row.slot);
  assert.deepEqual(lead, ["family", "speed", "capacity", "ranking", "form_factor"]);
  assert.equal(memoryAttributeSlot("capacity"), "capacity");
  assert.equal(memoryAttributeSlot("form_factor"), "form_factor");
  assert.equal(memoryAttributeSlot("voltage"), null);
});

test("the memory row is the MEM short code", () => {
  assert.equal(isMemoryTaxonomy("MEM"), true);
  assert.equal(isMemoryTaxonomy(" mem "), true);
  assert.equal(isMemoryTaxonomy("NIC"), false);
  assert.equal(isMemoryTaxonomy(null), false);
});
