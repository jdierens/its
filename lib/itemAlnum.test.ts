import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ITEM_LIST_TEXT_COLUMNS } from "./itemListSearch.ts";
import {
  ALNUM_CONTAINED_MIN,
  ITEM_ALNUM_COLUMNS,
  alnumContains,
  alnumDigitsOnly,
  alnumFieldContains,
  alnumQueryContains,
  attributeAlnumQueryContains,
  normalizeAlnum,
} from "./itemAlnum.ts";
import { alnumSearchUnavailable } from "./itemAlnumSearch.ts";

const CARD = "CARD\\NIC\\E30\\100G_2Q\\LP-FH\\MCX516A-CDAT";

test("punctuation drops out and case folds", () => {
  assert.equal(normalizeAlnum("MCX-516A-CDAT"), "mcx516acdat");
  assert.equal(normalizeAlnum(CARD), "cardnice30100g2qlpfhmcx516acdat");
  assert.equal(normalizeAlnum("  mcX_516a/cdat  "), "mcx516acdat");
  assert.equal(normalizeAlnum("---"), "");
});

test("MCX-516A-CDAT finds the stored card name, and the letters-only query finds it too", () => {
  assert.equal(alnumFieldContains(CARD, "MCX-516A-CDAT"), true);
  assert.equal(alnumFieldContains(CARD, "MCX516ACDAT"), true);
  assert.equal(alnumContains("MCX516A-CDAT", "MCX-516A-CDAT"), true);
  assert.equal(alnumContains("MCX-516A-CDAT", "MCX516A-CDAT"), true);
  assert.equal(alnumFieldContains("CARD\\NIC\\E30\\100G_2Q\\LP-FH\\MCX516A-CDAT_FSB", "MCX-516A-CDAT"), true);
  assert.equal(alnumFieldContains("CARD\\NIC\\E30\\100G_2Q\\LP-FH\\MCX516A-CCAT", "MCX-516A-CDAT"), false);
  assert.equal(alnumContains("MCX516A-CCAT", "MCX516ACDAT"), false);
});

test("a longer query contains a shorter stored part, and a tiny fragment does not", () => {
  assert.equal(alnumQueryContains("MCX516A-CDAT", `prefix-${CARD}`), true);
  assert.equal(alnumQueryContains("CDAT", "MCX-516A-CDAT"), true);
  assert.equal(alnumQueryContains("MC", "MCX-516A-CDAT"), false);
  assert.equal(alnumFieldContains("MCX516A-CDAT", "MC"), false);
  assert.equal(ALNUM_CONTAINED_MIN, 3);
});

const DRIVE = "STO\\SSD\\M0960N4\\MZ1L2960HCJR-00A07";
const DRIVE_QUERY = "MZ1L2960HCJR-00A07";

test("MZ1L2960HCJR-00A07 finds the drive name and not a digits-only attribute", () => {
  assert.equal(alnumFieldContains(DRIVE, DRIVE_QUERY), true);
  assert.equal(alnumDigitsOnly("96.0"), true);
  assert.equal(alnumDigitsOnly("0.96"), true);
  assert.equal(attributeAlnumQueryContains("96.0", DRIVE_QUERY), false);
  assert.equal(attributeAlnumQueryContains("0.96", DRIVE_QUERY), false);
  assert.equal(alnumFieldContains("96.0", "960"), true);
  assert.equal(alnumFieldContains("CPU\\6740E\\Q4VV", DRIVE_QUERY), false);
  assert.equal(attributeAlnumQueryContains("MCX516A-CDAT", `prefix-${CARD}`), true);
  assert.equal(attributeAlnumQueryContains("LGA4710", "board-LGA-4710-kit"), true);
});

test("item find columns are the punctuation-insensitive columns", () => {
  assert.deepEqual([...ITEM_LIST_TEXT_COLUMNS], [...ITEM_ALNUM_COLUMNS]);
});

test("a missing lookup is ignored and another database error is not", () => {
  assert.equal(alnumSearchUnavailable({ code: "PGRST202", message: "Could not find the function" }), true);
  assert.equal(
    alnumSearchUnavailable({
      message: "Could not find the function public.item_ids_matching_alnum in the schema cache",
    }),
    true,
  );
  assert.equal(alnumSearchUnavailable({ code: "42703", message: 'column "name_alnum" does not exist' }), true);
  assert.equal(alnumSearchUnavailable({ code: "57014", message: "canceling statement due to statement timeout" }), false);
});

test("the migration normalizes the same columns the app searches", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261025230000_item_alnum_search.sql", import.meta.url), "utf8");
  assert.match(sql, /regexp_replace\(p_value, '\[\^a-zA-Z0-9\]', '', 'g'\)/);
  assert.match(sql, /char_length\(n\.value\) >= 3/);
  for (const column of ITEM_ALNUM_COLUMNS) {
    assert.match(sql, new RegExp(`${column}_alnum`));
    assert.match(sql, new RegExp(`'${column}'`));
  }
  assert.match(sql, /value_alnum/);
  assert.match(sql, /grant execute on function public\.item_ids_matching_alnum/);
  const tightened = readFileSync(
    new URL("../supabase/migrations/20261026004000_item_alnum_attribute_reverse.sql", import.meta.url),
    "utf8",
  );
  assert.match(tightened, /NOT APPLIED/);
  assert.match(tightened, /saved\.value_alnum ~ '\[a-z\]'/);
  assert.match(tightened, /saved\.value_alnum like '%' \|\| n\.value \|\| '%'/);
  assert.equal(tightened.includes("i.name_alnum ~ '[a-z]'"), false);
});
