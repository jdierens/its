import assert from "node:assert/strict";
import test from "node:test";
import { formatDataDate } from "./formatDate.ts";

test("formatDataDate prints MM/DD/YY and keeps the calendar day", () => {
  assert.equal(formatDataDate("2026-10-30"), "10/30/26");
  assert.equal(formatDataDate("2026-01-05"), "01/05/26");
  assert.equal(formatDataDate("2026-10-30T07:15:00.000Z"), "10/30/26");
  assert.equal(formatDataDate(" 2026-03-09 "), "03/09/26");
  assert.equal(formatDataDate(""), "");
  assert.equal(formatDataDate(null), "");
  assert.equal(formatDataDate(undefined), "");
  assert.equal(formatDataDate("not a date"), "not a date");
});
