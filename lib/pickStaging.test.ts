import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { stagingBinCode, stagingDisplay, stagingLabel } from "./pickSheet.ts";

const sql = readFileSync(
  new URL("../supabase/migrations/20261028183000_pick_staging_choice.sql", import.meta.url),
  "utf8",
);

function body(name: string): string {
  const start = sql.indexOf(`function public.${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
}

describe("staging label", () => {
  it("names the order without inventing a bin code", () => {
    assert.equal(stagingLabel(27767), "staging bin SO27767");
    assert.equal(stagingLabel(null), "staging bin");
    assert.equal(stagingBinCode("staging bin SO27767"), null);
    assert.equal(stagingBinCode("20018-b"), "20018-B");
    assert.equal(stagingBinCode("20111-P"), "20111-P");
    assert.equal(stagingBinCode("18-B"), null);
    assert.equal(
      stagingDisplay({ soNumber: 27767, stagingBin: null, picking: true }),
      "staging bin SO27767",
    );
    assert.equal(
      stagingDisplay({ soNumber: 27767, stagingBin: "20111-B", picking: true }),
      "20111-B",
    );
    assert.equal(stagingDisplay({ soNumber: 27767, stagingBin: null, picking: false }), "");
  });
});

describe("staging migration", () => {
  it("does not mint a bin when a pick opens or when the target is chosen", () => {
    assert.match(sql, /Picking does not create a bin number/);
    assert.match(sql, /format\('staging bin SO%s', v_number\)/);
    assert.equal(body("open_sales_order_pick").includes("so_create_staging_bin"), false);
    assert.equal(body("so_pick_target_bin").includes("so_create_staging_bin"), false);
    assert.match(body("assign_pick_staging_bin"), /No bin with that code/);
    assert.match(body("pick_sales_order_line"), /issue_picked_units/);
    assert.match(sql, /bin_counter/);
    assert.equal(sql.includes("next_number"), false);
  });
});
