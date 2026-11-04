import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PULLED_FROM,
  actionForResolvedSerial,
  declineUnknownSerials,
  mergeSerialReports,
  pullFromLabel,
  pulledAllocationForUnknowns,
  serialAddTarget,
  serialRowFrom,
  unknownSerialPrompt,
} from "./pickSerialConfirm.ts";

const sql = readFileSync(
  new URL("../supabase/migrations/20261029170000_pick_unknown_serials.sql", import.meta.url),
  "utf8",
);

describe("unknown serial confirmation", () => {
  it("names the x/y counts and asks before adding Pulled serials", () => {
    assert.match(unknownSerialPrompt(2, 5), /2\/5 unknown serial numbers/);
    assert.match(unknownSerialPrompt(2, 5), /Add these as Pulled\?/);
    assert.match(unknownSerialPrompt(5, 5), /All 5\/5 unknown serial numbers/);
    assert.match(unknownSerialPrompt(1, 1), /1\/1 unknown serial number/);
    assert.match(unknownSerialPrompt(1, 4), /1\/4 unknown serial number/);
  });

  it("leaves declined serials out and keeps the ones already accepted", () => {
    const declined = declineUnknownSerials({
      accepted: 3,
      failures: [{ serial: "BAD", message: "That serial is not on this line." }],
      unknown: ["NEW-1", "NEW-2"],
    });
    assert.equal(declined.accepted, 3);
    assert.deepEqual(declined.unknown, []);
    assert.deepEqual(
      declined.failures.map((row) => row.serial),
      ["BAD", "NEW-1", "NEW-2"],
    );
    assert.equal(declined.failures[1]?.message, "That serial is not in inventory.");

    const confirmed = mergeSerialReports(
      { accepted: 3, failures: [], unknown: [] },
      { accepted: 2, failures: [], unknown: [] },
    );
    assert.equal(confirmed.accepted, 5);
    assert.deepEqual(confirmed.unknown, []);
  });

  it("shows Pulled when a pick has no source bin", () => {
    assert.equal(pullFromLabel(null), PULLED_FROM);
    assert.equal(pullFromLabel("  "), PULLED_FROM);
    assert.equal(pullFromLabel("20009-B"), "20009-B");
  });
});

describe("serial-only pull", () => {
  const pull = {
    serial: "V8H8GBDR",
    allocationId: "alloc-1",
    binId: "bin-1",
    reference: "20009-B",
    coo: "USA",
  };

  it("attaches a known serial to an open pull from its bin", () => {
    assert.deepEqual(
      actionForResolvedSerial({
        pull,
        remaining: 2,
        picks: [{ id: "pick-1", fromBin: "20009-B", qty: 1, serials: [] }],
      }),
      { type: "attach", pickId: "pick-1" },
    );
  });

  it("builds a pull from the bin when none is open, and another when that pull is full", () => {
    assert.deepEqual(
      actionForResolvedSerial({ pull, remaining: 2, picks: [] }),
      { type: "pick", allocationId: "alloc-1", binId: "bin-1" },
    );
    assert.deepEqual(
      actionForResolvedSerial({
        pull,
        remaining: 1,
        picks: [{ id: "full", fromBin: "20009-B", qty: 1, serials: ["V8H8GBDR"] }],
      }),
      { type: "pick", allocationId: "alloc-1", binId: "bin-1" },
    );
    assert.deepEqual(
      actionForResolvedSerial({
        pull,
        remaining: 0,
        picks: [{ id: "full", fromBin: "20009-B", qty: 1, serials: ["V8H8GBDR"] }],
      }),
      { type: "fail", message: "This pick already has a serial for each piece." },
    );
  });

  it("uses the row the serials were pasted on, or the only open line", () => {
    const lines = [
      { allocationId: "a", ordered: 2, picked: 2 },
      { allocationId: "b", ordered: 1, picked: 0 },
    ];
    assert.equal(pulledAllocationForUnknowns({ allocationId: "a", lines }), "a");
    assert.equal(pulledAllocationForUnknowns({ allocationId: null, lines }), "b");
    assert.equal(
      pulledAllocationForUnknowns({
        allocationId: null,
        lines: [
          { allocationId: "a", ordered: 2, picked: 0 },
          { allocationId: "b", ordered: 1, picked: 0 },
        ],
      }),
      null,
    );
    assert.equal(
      pulledAllocationForUnknowns({
        allocationId: null,
        lines: [
          {
            allocationId: "a",
            ordered: 2,
            picked: 2,
            picks: [{ qty: 2, serials: ["ONE"] }],
          },
        ],
      }),
      "a",
    );
  });
});

describe("serial + after a bin was picked", () => {
  const picks = [
    { id: "older", fromBin: "10001-C", qty: 1, serials: [] as string[] },
    { id: "latest", fromBin: "10049-C", qty: 1, serials: [] as string[] },
  ];

  it("adds the serial onto the bin just picked, without a lookup", () => {
    assert.deepEqual(serialAddTarget({ picks }), { ok: true, pickId: "latest", fromBin: "10049-C" });
    assert.equal(
      serialRowFrom({
        active: null,
        fromBin: "10049-C",
        bins: [
          { reference: "10001-C", location: "HWS.00.00.00" },
          { reference: "10049-C", location: "HWS.00.00.00" },
        ],
      }),
      "10049-C · HWS.00.00.00",
    );
  });

  it("says to pick a quantity when every slot already has a serial", () => {
    assert.deepEqual(
      serialAddTarget({ picks: [{ id: "full", fromBin: "10049-C", qty: 1, serials: ["SN1"] }] }),
      { ok: false, message: "Pick a quantity from a bin above before adding a serial." },
    );
    assert.equal(serialRowFrom({ active: null, fromBin: null, bins: [] }), "");
  });

  it("uses the looked-up bin when Enter already named one", () => {
    assert.deepEqual(serialAddTarget({ picks, preferredBin: "10001-C" }), {
      ok: true,
      pickId: "older",
      fromBin: "10001-C",
    });
    assert.deepEqual(serialAddTarget({ picks, preferredBin: "20000-B" }), {
      ok: false,
      message: "Pick a quantity from 20000-B before adding this serial.",
    });
    assert.equal(
      serialRowFrom({
        active: { reference: "20000-B", location: null },
        fromBin: "10049-C",
        bins: [],
      }),
      "20000-B",
    );
  });
});

describe("pulled serial migration", () => {
  it("issues an unknown serial as Pulled and does not add a column", () => {
    assert.match(sql, /No new columns/);
    assert.match(sql, /status = 'issued'/);
    assert.match(sql, /bin_scan/);
    assert.match(sql, /'Pulled'/);
    assert.match(sql, /function public.record_pulled_serial/);
    assert.match(sql, /function public.record_pick_serial/);
    assert.match(sql, /grant execute on function public.record_pulled_serial\(uuid, uuid, text, text, uuid, text\) to service_role/);
    assert.match(sql, /bin_scan = ''Pulled''/);
    assert.doesNotMatch(sql, /grant .+ to anon/);
    assert.doesNotMatch(sql, /alter table/);
  });
});
