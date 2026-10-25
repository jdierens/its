import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RECENT_ORIGIN_LIMIT, distinctRecentOrigins, filterRecentOrigins } from "@/lib/receivingOrigins";

describe("originating system list", () => {
  it("keeps distinct systems, the newest spelling, and skips blanks", () => {
    const names = distinctRecentOrigins([
      { origin_description: "  " },
      { origin_description: "820GH-TNR2" },
      { origin_description: "\t820GH-TNR2" },
      { origin_description: null },
      { origin: "HLS-2H" },
      { origin_description: "hls-2h" },
      { origin_description: "VAST  HPE 2U4N" },
    ]);
    assert.deepEqual(names, ["820GH-TNR2", "HLS-2H", "VAST  HPE 2U4N"]);
  });

  it("puts a newly typed system first and does not duplicate it", () => {
    const next = distinctRecentOrigins([
      { origin_description: "NewRack" },
      { origin_description: "HLS-2H" },
      { origin_description: "newrack" },
      { origin_description: "GNR" },
    ]);
    assert.deepEqual(next, ["NewRack", "HLS-2H", "GNR"]);
  });

  it("stops at the list cap", () => {
    const rows = Array.from({ length: RECENT_ORIGIN_LIMIT + 5 }, (_, index) => ({
      origin_description: `System ${index}`,
    }));
    assert.equal(distinctRecentOrigins(rows).length, RECENT_ORIGIN_LIMIT);
    assert.equal(distinctRecentOrigins(rows)[0], "System 0");
  });

  it("filters as the clerk types and still allows a system that is not listed", () => {
    const systems = ["HLS-2H", "820GH-TNR2", "DL360 Gen10"];
    assert.deepEqual(filterRecentOrigins(systems, ""), systems);
    assert.deepEqual(filterRecentOrigins(systems, "  gen10 "), ["DL360 Gen10"]);
    assert.deepEqual(filterRecentOrigins(systems, "brand new"), []);
  });
});
