import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  applyReceiveSerialPaste,
  collectReceiveUnits,
  cooProblem,
  receiveSerialFailure,
  relocationOrder,
  resizeUnitRows,
  rowsToPaste,
  unitsToRelocate,
} from "@/lib/stockUnits";

const sql = readFileSync(new URL("../supabase/migrations/20261027230000_stock_units.sql", import.meta.url), "utf8");

describe("receive unit capture", () => {
  it("skips blank rows and keeps a country without a serial", () => {
    const result = collectReceiveUnits({
      qty: 3,
      sku: "106683",
      hasItem: true,
      rows: [
        { serial: "  SN-1 ", coo: "usa" },
        { serial: "", coo: "" },
        { serial: "", coo: "cn" },
      ],
      paste: "",
      pasteCoo: "",
    });
    assert.deepEqual(result, {
      ok: true,
      units: [
        { serial: "SN-1", coo: "USA" },
        { serial: null, coo: "CN" },
      ],
    });
  });

  it("reads a paste of serials and applies the default country unless a line sets one", () => {
    const result = collectReceiveUnits({
      qty: 12,
      sku: "106683",
      hasItem: true,
      rows: [],
      paste: "SN-1\nSN-2, chn\nSN-3,\tMX",
      pasteCoo: "usa",
    });
    assert.deepEqual(result, {
      ok: true,
      units: [
        { serial: "SN-1", coo: "USA" },
        { serial: "SN-2", coo: "CHN" },
        { serial: "SN-3", coo: "MX" },
      ],
    });
  });

  it("rejects a duplicate serial, a SKU, a bin code, and more identities than the quantity", () => {
    assert.equal(
      collectReceiveUnits({
        qty: 2,
        sku: "106683",
        hasItem: true,
        rows: [
          { serial: "SN-1", coo: "" },
          { serial: "sn-1", coo: "" },
        ],
        paste: "",
        pasteCoo: "",
      }).ok,
      false,
    );
    assert.deepEqual(
      collectReceiveUnits({
        qty: 1,
        sku: "106683",
        hasItem: true,
        rows: [{ serial: "106683", coo: "" }],
        paste: "",
        pasteCoo: "",
      }),
      { ok: false, message: "That scan is the SKU, not a serial." },
    );
    assert.deepEqual(
      collectReceiveUnits({
        qty: 1,
        sku: "106683",
        hasItem: true,
        rows: [{ serial: "20000-B", coo: "" }],
        paste: "",
        pasteCoo: "",
      }),
      { ok: false, message: "That scan is a bin code, not a serial." },
    );
    const extra = collectReceiveUnits({
      qty: 9,
      sku: "106683",
      hasItem: true,
      rows: [],
      paste: Array.from({ length: 10 }, (_, index) => `SN-${index}`).join("\n"),
      pasteCoo: "",
    });
    assert.equal(extra.ok, false);
    assert.equal(cooProblem("United States"), "Use a 2- or 3-letter country code.");
    assert.equal(cooProblem(""), null);
  });

  it("does not accept serials on a receipt that has no item", () => {
    assert.deepEqual(
      collectReceiveUnits({
        qty: 1,
        sku: "",
        hasItem: false,
        rows: [{ serial: "SN-1", coo: "USA" }],
        paste: "",
        pasteCoo: "",
      }),
      { ok: false, message: "Choose an item before entering serials." },
    );
  });

  it("turns a Sheets column, a TSV row, and a grid into one stock unit per serial", () => {
    const column = ["V8H8GBDR", "V8HD2PXR", "V8HBEMXR", "V8HD2NNR", "V8HD5XZR"].join("\n");
    const fromColumn = applyReceiveSerialPaste(`${column}\n`, "USA");
    assert.equal(fromColumn.type, "apply");
    if (fromColumn.type !== "apply") return;
    assert.equal(fromColumn.qty, "5");
    assert.equal(fromColumn.paste, "");
    const columnUnits = collectReceiveUnits({
      qty: Number(fromColumn.qty),
      sku: "106683",
      hasItem: true,
      rows: fromColumn.rows,
      paste: fromColumn.paste,
      pasteCoo: "USA",
    });
    assert.equal(columnUnits.ok, true);
    if (!columnUnits.ok) return;
    assert.deepEqual(
      columnUnits.units.map((unit) => unit.serial),
      ["V8H8GBDR", "V8HD2PXR", "V8HBEMXR", "V8HD2NNR", "V8HD5XZR"],
    );
    assert.deepEqual(columnUnits.units[0], { serial: "V8H8GBDR", coo: "USA" });

    const grid = applyReceiveSerialPaste("  V8H8GBDR \t V8HD2PXR  \r\n\tV8HBEMXR\t\r\n", "usa");
    assert.equal(grid.type, "apply");
    if (grid.type !== "apply") return;
    assert.equal(grid.qty, "3");
    assert.deepEqual(
      grid.rows.map((row) => row.serial),
      ["V8H8GBDR", "V8HD2PXR", "V8HBEMXR"],
    );
    const gridUnits = collectReceiveUnits({
      qty: Number(grid.qty),
      sku: "106683",
      hasItem: true,
      rows: grid.rows,
      paste: "",
      pasteCoo: "",
    });
    assert.deepEqual(gridUnits, {
      ok: true,
      units: [
        { serial: "V8H8GBDR", coo: "USA" },
        { serial: "V8HD2PXR", coo: "USA" },
        { serial: "V8HBEMXR", coo: "USA" },
      ],
    });

    const wide = collectReceiveUnits({
      qty: 12,
      sku: "106683",
      hasItem: true,
      rows: [],
      paste: "SN-1\tSN-2\t\tSN-3\r\nSN-4, chn\n\nSN-5\t",
      pasteCoo: "usa",
    });
    assert.deepEqual(wide, {
      ok: true,
      units: [
        { serial: "SN-1", coo: "USA" },
        { serial: "SN-2", coo: "USA" },
        { serial: "SN-3", coo: "USA" },
        { serial: "SN-4", coo: "CHN" },
        { serial: "SN-5", coo: "USA" },
      ],
    });
  });

  it("sets the quantity to a long column and still refuses a duplicate or more serials than pieces", () => {
    const serials = Array.from({ length: 27 }, (_, index) => `V8HD${String(index).padStart(4, "0")}`);
    const plan = applyReceiveSerialPaste(`\uFEFF${serials.join("\n")}\n`, "USA");
    assert.equal(plan.type, "apply");
    if (plan.type !== "apply") return;
    assert.equal(plan.qty, "27");
    assert.deepEqual(plan.rows, []);
    assert.equal(plan.paste, serials.join("\n"));
    const units = collectReceiveUnits({
      qty: Number(plan.qty),
      sku: "106683",
      hasItem: true,
      rows: [],
      paste: plan.paste,
      pasteCoo: "USA",
    });
    assert.equal(units.ok, true);
    if (!units.ok) return;
    assert.equal(units.units.length, 27);
    assert.deepEqual(units.units[0], { serial: "V8HD0000", coo: "USA" });
    assert.deepEqual(units.units[26], { serial: "V8HD0026", coo: "USA" });

    assert.deepEqual(applyReceiveSerialPaste("V8H8GBDR\n", "USA"), { type: "fill", serial: "V8H8GBDR", coo: null });
    assert.deepEqual(applyReceiveSerialPaste("SN-2, chn\r\n", "USA"), { type: "fill", serial: "SN-2", coo: "chn" });
    assert.deepEqual(applyReceiveSerialPaste("V8H8GBDR", "USA"), { type: "default" });
    assert.deepEqual(applyReceiveSerialPaste("\n\t\n", "USA"), { type: "ignore" });

    const duplicate = collectReceiveUnits({
      qty: 12,
      sku: "106683",
      hasItem: true,
      rows: [],
      paste: "SN-1\nSN-1\n",
      pasteCoo: "",
    });
    assert.deepEqual(duplicate, { ok: false, message: "That serial is already in this receipt." });
    const tooMany = collectReceiveUnits({
      qty: 9,
      sku: "106683",
      hasItem: true,
      rows: [],
      paste: Array.from({ length: 10 }, (_, index) => `SN-${index}`).join("\n"),
      pasteCoo: "",
    });
    assert.deepEqual(tooMany, { ok: false, message: "Enter at most one serial for each piece." });
    const lowered = collectReceiveUnits({
      qty: 5,
      sku: "106683",
      hasItem: true,
      rows: [],
      paste: "SN-1\nSN-2\nSN-3\nSN-4\nSN-5\nSN-6",
      pasteCoo: "USA",
    });
    assert.deepEqual(lowered, { ok: false, message: "Enter at most one serial for each piece." });
    const fewer = collectReceiveUnits({
      qty: 5,
      sku: "106683",
      hasItem: true,
      rows: [],
      paste: "SN-1\nSN-2",
      pasteCoo: "USA",
    });
    assert.deepEqual(fewer, {
      ok: true,
      units: [
        { serial: "SN-1", coo: "USA" },
        { serial: "SN-2", coo: "USA" },
      ],
    });
  });

  it("returns the database sentence for a serial that cannot be received", () => {
    assert.equal(
      receiveSerialFailure({ message: "That serial is already recorded for this item.", code: "22023" }),
      "That serial is already recorded for this item.",
    );
    assert.equal(
      receiveSerialFailure({
        message: 'duplicate key value violates unique constraint "stock_units_item_serial_idx"',
        code: "23505",
      }),
      "That serial is already recorded for this item.",
    );
    assert.equal(
      receiveSerialFailure(
        new Error(
          "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.",
        ),
      ),
      "The receipt was not saved.",
    );
    assert.equal(receiveSerialFailure({ message: "Enter a whole number of at least 1." }), "Enter a whole number of at least 1.");
  });

  it("keeps typed countries when the item default changes and prefills empty rows", () => {
    const resized = resizeUnitRows(
      [
        { serial: "SN-1", coo: "USA" },
        { serial: "", coo: "CHN" },
      ],
      3,
      "MEX",
      "USA",
    );
    assert.deepEqual(resized, [
      { serial: "SN-1", coo: "MEX" },
      { serial: "", coo: "CHN" },
      { serial: "", coo: "MEX" },
    ]);
    assert.equal(rowsToPaste(resized), "SN-1, MEX\nCHN\nMEX");
  });
});

describe("unit relocation", () => {
  it("moves only the units that would otherwise exceed the quantity left behind", () => {
    assert.equal(unitsToRelocate(8, 3), 0);
    assert.equal(unitsToRelocate(2, 3), 1);
    assert.equal(unitsToRelocate(0, 3), 3);
  });

  it("moves unidentified units before serialized ones", () => {
    const ordered = relocationOrder([
      { id: "b", serial: "SN-2", createdAt: "2026-10-01" },
      { id: "a", serial: null, createdAt: "2026-10-02" },
      { id: "c", serial: "SN-1", createdAt: "2026-10-01" },
    ]);
    assert.deepEqual(
      ordered.map((row) => row.id),
      ["a", "b", "c"],
    );
  });
});

describe("stock unit migration", () => {
  it("adds the unit table, keeps bin quantity authoritative, and locks the data api down", () => {
    assert.match(sql, /Not applied here/);
    assert.match(sql, /20261027170000_sales_order_picking\.sql/);
    assert.match(sql, /create table public\.stock_units/);
    assert.match(sql, /country_of_origin text/);
    assert.match(sql, /references public\.countries \(alpha3\)/);
    assert.match(sql, /bin_contents\.qty is the on-hand quantity/);
    assert.match(sql, /serial_number is null/);
    assert.match(sql, /inventory_movements_unit_fkey/);
    assert.match(sql, /inventory_movement_units/);
    assert.match(sql, /so_units_stock_unit_fkey/);
    assert.match(sql, /alter table public\.stock_units enable row level security/);
    assert.match(sql, /revoke all on table public\.stock_units from public, anon, authenticated/);
    assert.match(sql, /grant all on table public\.stock_units to service_role/);
    assert.match(sql, /grant execute on function public\.receive_into_bin\(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, jsonb\) to service_role/);
    assert.match(sql, /grant execute on function public\.record_pick_serial\(uuid, text, text, uuid, text\) to service_role/);
    assert.match(sql, /place_received_units/);
    assert.match(sql, /relocate_stock_units/);
    assert.match(sql, /return_pick_units/);
    assert.doesNotMatch(sql, /grant .+ to anon/);
  });
});
