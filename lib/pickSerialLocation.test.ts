import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeIlike,
  formatPullFrom,
  pullCue,
  resolveSerialPull,
  type KnownSerialUnit,
  type SerialPullLine,
} from "./pickSerialLocation.ts";

const line: SerialPullLine = {
  allocationId: "alloc-1",
  sku: "106683",
  remaining: 2,
  bins: [{ binId: "bin-1", reference: "20000-B", qty: 33 }],
};

function unit(overrides: Partial<KnownSerialUnit> = {}): KnownSerialUnit {
  return {
    serial: "KIOXIA-1",
    sku: "106683",
    onOrder: true,
    status: "in_stock",
    binId: "bin-1",
    reference: "20000-B",
    location: "HWS.00.00.00",
    coo: "USA",
    ...overrides,
  };
}

describe("serial pull location", () => {
  it("fills the bin and location for a known unit on an open line", () => {
    const result = resolveSerialPull({ serial: " kioxia-1 ", units: [unit()], lines: [line] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.pull.allocationId, "alloc-1");
    assert.equal(result.pull.binId, "bin-1");
    assert.equal(result.pull.reference, "20000-B");
    assert.equal(result.pull.location, "HWS.00.00.00");
    assert.equal(result.pull.serial, "KIOXIA-1");
    assert.equal(result.pull.coo, "USA");
    assert.equal(formatPullFrom(result.pull.reference, result.pull.location), "20000-B · HWS.00.00.00");
    assert.equal(pullCue(result.pull), "Pulling KIOXIA-1 from 20000-B · HWS.00.00.00.");
  });

  it("keeps a blank location blank instead of inventing one", () => {
    const result = resolveSerialPull({
      serial: "KIOXIA-1",
      units: [unit({ location: null, coo: null })],
      lines: [line],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.pull.location, null);
    assert.equal(formatPullFrom(result.pull.reference, result.pull.location), "20000-B");
  });

  it("fails when the serial is unknown, off the order, or not in a bin", () => {
    assert.equal(resolveSerialPull({ serial: "  ", units: [], lines: [line] }).ok, false);
    assert.deepEqual(resolveSerialPull({ serial: "MISSING", units: [], lines: [line] }), {
      ok: false,
      message: "That serial is not in inventory.",
    });
    assert.deepEqual(
      resolveSerialPull({ serial: "KIOXIA-1", units: [unit({ onOrder: false, sku: "999" })], lines: [line] }),
      { ok: false, message: "That serial is not on this pick." },
    );
    assert.deepEqual(
      resolveSerialPull({
        serial: "KIOXIA-1",
        units: [unit({ status: "issued", binId: null, reference: null, location: null })],
        lines: [line],
      }),
      { ok: false, message: "That serial is not in a bin." },
    );
    assert.deepEqual(
      resolveSerialPull({
        serial: "KIOXIA-1",
        units: [unit({ binId: "bin-9", reference: "20009-B", location: "HWR.01.02.00" })],
        lines: [line],
      }),
      { ok: false, message: "That serial is in 20009-B · HWR.01.02.00, which is not open on this pick." },
    );
  });

  it("stays on the line the operator scanned into", () => {
    const other: SerialPullLine = {
      allocationId: "alloc-2",
      sku: "106683",
      remaining: 1,
      bins: [{ binId: "bin-1", reference: "20000-B", qty: 4 }],
    };
    const preferred = resolveSerialPull({
      serial: "KIOXIA-1",
      units: [unit()],
      lines: [{ ...line, remaining: 0 }, other],
      allocationId: "alloc-1",
    });
    assert.equal(preferred.ok, true);
    if (!preferred.ok) return;
    assert.equal(preferred.pull.allocationId, "alloc-1");

    const open = resolveSerialPull({
      serial: "KIOXIA-1",
      units: [unit()],
      lines: [{ ...line, remaining: 0 }, other],
    });
    assert.equal(open.ok, true);
    if (!open.ok) return;
    assert.equal(open.pull.allocationId, "alloc-2");
  });

  it("rejects one serial that matches two items on the pick", () => {
    const result = resolveSerialPull({
      serial: "KIOXIA-1",
      units: [unit(), unit({ sku: "200", binId: "bin-2", reference: "20007-B" })],
      lines: [line, { ...line, allocationId: "alloc-2", sku: "200" }],
    });
    assert.deepEqual(result, { ok: false, message: "That serial matches more than one item on this pick." });
  });

  it("escapes like wildcards in a serial", () => {
    assert.equal(escapeIlike("100%_A\\B"), "100\\%\\_A\\\\B");
  });
});
