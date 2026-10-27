import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  collectReceiveUnits,
  cooProblem,
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
