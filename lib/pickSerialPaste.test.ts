import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPastedSerials,
  classifySerialPaste,
  formatSerialPasteReport,
  pickSlotForSerial,
} from "./pickSerialPaste.ts";

const column = ["V8H8GBDR", "V8HD2PXR", "V8HBEMXR", "V8HD2NNR", "V8HD5XZR"].join("\n");

describe("spreadsheet serial paste", () => {
  it("splits a Google Sheets column on newlines and drops a trailing blank line", () => {
    assert.deepEqual(classifySerialPaste(`${column}\n`), {
      type: "apply",
      serials: ["V8H8GBDR", "V8HD2PXR", "V8HBEMXR", "V8HD2NNR", "V8HD5XZR"],
    });
    assert.deepEqual(classifySerialPaste(`${column.replaceAll("\n", "\r\n")}\r\n\r\n`), {
      type: "apply",
      serials: ["V8H8GBDR", "V8HD2PXR", "V8HBEMXR", "V8HD2NNR", "V8HD5XZR"],
    });
  });

  it("splits a tab-separated row and a grid, and trims empty cells", () => {
    assert.deepEqual(classifySerialPaste("V8H8GBDR\tV8HD2PXR\t\tV8HBEMXR\t"), {
      type: "apply",
      serials: ["V8H8GBDR", "V8HD2PXR", "V8HBEMXR"],
    });
    assert.deepEqual(classifySerialPaste("  V8H8GBDR \t V8HD2PXR  \r\n\tV8HBEMXR\t\r\n"), {
      type: "apply",
      serials: ["V8H8GBDR", "V8HD2PXR", "V8HBEMXR"],
    });
  });

  it("keeps all 27 lines of a one-column paste", () => {
    const serials = Array.from({ length: 27 }, (_, index) => `V8HD${String(index).padStart(4, "0")}`);
    const plan = classifySerialPaste(`${serials.join("\n")}\n`);
    assert.equal(plan.type, "apply");
    if (plan.type !== "apply") return;
    assert.deepEqual(plan.serials, serials);
  });

  it("leaves one serial in the field so Enter can still scan it", () => {
    assert.deepEqual(classifySerialPaste("V8H8GBDR"), { type: "default" });
    assert.deepEqual(classifySerialPaste("V8H8GBDR\n"), { type: "fill", serial: "V8H8GBDR" });
    assert.deepEqual(classifySerialPaste("  V8H8GBDR  \r\n"), { type: "fill", serial: "V8H8GBDR" });
    assert.deepEqual(classifySerialPaste("\n\t\n"), { type: "ignore" });
    assert.deepEqual(classifySerialPaste("\uFEFFV8H8GBDR\r\n"), { type: "fill", serial: "V8H8GBDR" });
  });
});

describe("pick slot for a serial", () => {
  it("uses the open pick from that bin, and says when every piece already has a serial", () => {
    assert.deepEqual(
      pickSlotForSerial({
        picks: [
          { id: "full", fromBin: "20009-B", qty: 1, serials: ["A"] },
          { id: "open", fromBin: "20009-b", qty: 1, serials: [] },
          { id: "other", fromBin: "20010-B", qty: 5, serials: [] },
        ],
        reference: "20009-B",
      }),
      { ok: true, pickId: "open" },
    );
    assert.deepEqual(
      pickSlotForSerial({
        picks: [{ id: "full", fromBin: "20009-B", qty: 1, serials: ["A"] }],
        reference: "20009-B",
      }),
      { ok: false, message: "This pick already has a serial for each piece." },
    );
    assert.deepEqual(pickSlotForSerial({ picks: [], reference: "20009-B" }), {
      ok: false,
      message: "Pick a quantity from 20009-B before adding this serial.",
    });
  });
});

describe("apply pasted serials", () => {
  it("adds each serial and reports unknown, already assigned, wrong item, and a full pick", async () => {
    const recorded: { serial: string; coo: string | null }[] = [];
    const existing = ["V8HOLD01"];
    let picks: { id: string; fromBin: string | null; qty: number; serials: string[] }[] = [
      { id: "pick-1", fromBin: "20009-B", qty: 2, serials: [] },
    ];
    const report = await applyPastedSerials({
      serials: ["V8H8GBDR", "V8HD2PXR", "V8HOLD01", "V8HBEMXR", "V8HD2NNR", "NOT-ON-LINE"],
      sku: "106683",
      coo: "",
      existing: () => existing,
      picks: () => picks,
      lookup: async (serial) => {
        if (serial === "V8HD2PXR") throw new Error("That serial is not in inventory.");
        if (serial === "NOT-ON-LINE") throw new Error("That serial is not on this line.");
        return { serial, reference: "20009-B", coo: "USA" };
      },
      record: async (_pickId, serial, coo) => {
        recorded.push({ serial, coo });
        existing.push(serial);
        picks = [{ id: "pick-1", fromBin: "20009-B", qty: 2, serials: recorded.map((row) => row.serial) }];
      },
    });

    assert.deepEqual(recorded, [
      { serial: "V8H8GBDR", coo: "USA" },
      { serial: "V8HBEMXR", coo: "USA" },
    ]);
    assert.equal(report.accepted, 2);
    assert.deepEqual(
      report.failures.map((row) => [row.serial, row.message]),
      [
        ["V8HD2PXR", "That serial is not in inventory."],
        ["V8HOLD01", "That serial is already recorded for this item."],
        ["V8HD2NNR", "This pick already has a serial for each piece."],
        ["NOT-ON-LINE", "That serial is not on this line."],
      ],
    );
    assert.deepEqual(formatSerialPasteReport(report), {
      accepted: "Accepted 2 serials.",
      failures: [
        "4 serials were not added.",
        "V8HD2PXR: That serial is not in inventory.",
        "V8HOLD01: That serial is already recorded for this item.",
        "V8HD2NNR: This pick already has a serial for each piece.",
        "NOT-ON-LINE: That serial is not on this line.",
      ].join("\n"),
    });
  });

  it("asks for a picked quantity before it records, and keeps a typed country", async () => {
    let recorded: string | null = null;
    const missing = await applyPastedSerials({
      serials: ["V8H8GBDR", "V8HD2PXR"],
      sku: "106683",
      coo: "MEX",
      existing: () => [],
      picks: () => [],
      lookup: async (serial) => ({ serial, reference: "20009-B", coo: "JPN" }),
      record: async () => {
        throw new Error("should not record");
      },
    });
    assert.equal(missing.accepted, 0);
    assert.equal(missing.failures[0]?.message, "Pick a quantity from 20009-B before adding this serial.");
    assert.equal(missing.failures[1]?.message, "Pick a quantity from 20009-B before adding this serial.");

    const saved = await applyPastedSerials({
      serials: ["V8H8GBDR"],
      sku: "106683",
      coo: "MEX",
      existing: () => [],
      picks: () => [{ id: "pick-1", fromBin: "20009-B", qty: 1, serials: [] }],
      lookup: async (serial) => ({ serial, reference: "20009-B", coo: "JPN" }),
      record: async (_pickId, _serial, coo) => {
        recorded = coo;
      },
    });
    assert.equal(saved.accepted, 1);
    assert.equal(recorded, "MEX");
    assert.deepEqual(formatSerialPasteReport(saved), { accepted: "Accepted 1 serial.", failures: null });
  });

  it("rejects a second copy of a serial in the same paste", async () => {
    const existing: string[] = [];
    const report = await applyPastedSerials({
      serials: ["V8H8GBDR", "v8h8gbdr"],
      sku: "106683",
      coo: "",
      existing: () => existing,
      picks: () => [{ id: "pick-1", fromBin: "20009-B", qty: 5, serials: existing }],
      lookup: async (serial) => ({ serial: serial.toUpperCase(), reference: "20009-B", coo: null }),
      record: async (_pickId, serial) => {
        existing.push(serial);
      },
    });
    assert.deepEqual(existing, ["V8H8GBDR"]);
    assert.equal(report.accepted, 1);
    assert.deepEqual(report.failures, [
      { serial: "v8h8gbdr", message: "That serial is already recorded for this item." },
    ]);
  });
});
