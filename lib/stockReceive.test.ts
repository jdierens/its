import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RACKING_PATTERN,
  SHELVES_PATTERN,
  assignNewBinLocation,
  closesCycle,
  consolidationTargets,
  cycleOpens,
  initialsFromPerson,
  keepExistingCycleDefault,
  keepExistingLocation,
  locationCodeError,
  locationTypeInputError,
  matchingLocationTypes,
  nextFreeBinError,
  parseReceivingBinCode,
  recordNewCycleDefault,
  typedBinCodeError,
  type PutawayDefaults,
} from "@/lib/stockReceive";

const types = [
  { prefix: "HWS", pattern: SHELVES_PATTERN },
  { prefix: "HWR", pattern: RACKING_PATTERN },
  { prefix: "LAB", pattern: "^LAB-.+$" },
];

describe("receiving bin codes", () => {
  it("accepts a five-digit code and rejects a longer or padded one", () => {
    assert.deepEqual(parseReceivingBinCode(" 20014-b "), {
      number: 20014,
      type: "B",
      reference: "20014-B",
    });
    assert.equal(parseReceivingBinCode("020000-P"), null);
    assert.equal(parseReceivingBinCode("20000-X"), null);
    assert.equal(parseReceivingBinCode("00000-B"), null);
    assert.equal(typedBinCodeError("20014-C", "B"), "A bin code is five digits, a hyphen, and B, C, or P.");
    assert.equal(typedBinCodeError("20014-B", "B"), null);
  });

  it("refuses a next number that is not five digits", () => {
    assert.equal(nextFreeBinError(20000), null);
    assert.equal(nextFreeBinError(99999), null);
    assert.match(nextFreeBinError(100000) ?? "", /five digits/);
    assert.match(nextFreeBinError(999) ?? "", /five digits/);
  });
});

describe("location types", () => {
  it("matches the seeded shelves and racking patterns and a later type", () => {
    assert.equal(locationCodeError("HWS.00.00.00", types), null);
    assert.equal(locationCodeError("hwr.01.04.06.n", types), null);
    assert.equal(locationCodeError("HWR.00.00.00", types), null);
    assert.equal(locationCodeError("LAB-1", types), null);
    assert.match(locationCodeError("HWS.1", types) ?? "", /No location type/);
    assert.match(locationCodeError("OFFICE", types) ?? "", /No location type/);
  });

  it("refuses a code that matches more than one type", () => {
    const ambiguous = [
      { prefix: "HWS", pattern: "^HWS.+$" },
      { prefix: "H", pattern: "^HWS.+$" },
    ];
    assert.equal(matchingLocationTypes("HWS.00.00.00", ambiguous).length, 2);
    assert.match(locationCodeError("HWS.00.00.00", ambiguous) ?? "", /More than one/);
  });

  it("checks a new type before it is saved", () => {
    assert.equal(
      locationTypeInputError({
        name: "Office lab",
        prefix: "lab",
        pattern: "^LAB-.+$",
      }),
      null,
    );
    assert.match(
      locationTypeInputError({ name: "Office lab", prefix: "LAB", pattern: "LAB-.+" }) ?? "",
      /start with \^/,
    );
  });
});

describe("bin cycles", () => {
  it("opens on an empty bin, joins while quantity remains, and closes at zero", () => {
    assert.equal(cycleOpens(0), true);
    assert.equal(cycleOpens(3), false);
    assert.equal(closesCycle(0), true);
    assert.equal(closesCycle(2), false);
  });

  it("suggests only an open bin that already holds the SKU on this project", () => {
    const rows = [
      { reference: "20014-B", qty: 4, project: "AZSIM", status: "open" as const },
      { reference: "20015-B", qty: 0, project: "AZSIM", status: "open" as const },
      { reference: "20016-B", qty: 2, project: "OTHER", status: "open" as const },
      { reference: "20017-B", qty: 2, project: "AZSIM", status: "closed" as const },
      { reference: "20018-C", qty: 1, project: null, status: "open" as const },
    ];
    assert.deepEqual(
      consolidationTargets(rows, "AZSIM").map((row) => row.reference),
      ["20014-B"],
    );
    assert.deepEqual(
      consolidationTargets(rows, "").map((row) => row.reference),
      ["20018-C"],
    );
  });
});

describe("put-away defaults", () => {
  const seeded: PutawayDefaults = { B: "HWS.00.00.00", C: "HWS.00.00.00", P: "HWR.00.00.00" };

  it("gives a new bin and a new cycle the current setting and leaves existing rows", () => {
    const next: PutawayDefaults = { ...seeded, B: "LAB-1" };
    assert.equal(assignNewBinLocation(next, "B"), "LAB-1");
    assert.equal(recordNewCycleDefault(next, "B"), "LAB-1");
    assert.equal(assignNewBinLocation(seeded, "P"), "HWR.00.00.00");
    assert.equal(keepExistingLocation("HWS.03.01.02"), "HWS.03.01.02");
    assert.equal(keepExistingCycleDefault("HWS.00.00.00"), "HWS.00.00.00");
  });
});

describe("initials", () => {
  it("uses the name, then the email", () => {
    assert.equal(initialsFromPerson("Jan Dierens", "jan@example.com"), "JD");
    assert.equal(initialsFromPerson(null, "ada.lovelace@example.com"), "ADALOVELACE");
    assert.equal(initialsFromPerson("  ", ""), "OP");
  });
});
