import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  consignmentFollowsReceipt,
  projectReceiptApplyDecision,
  projectReceiptApplySummary,
  savedReceiptConsigned,
} from "@/lib/projectReceiptApply";

const sql = readFileSync(new URL("../supabase/migrations/20261102190000_receipt_project_owner.sql", import.meta.url), "utf8");

describe("project receipt owner prompt", () => {
  it("asks only when this project already has another receiving line", () => {
    assert.equal(projectReceiptApplyDecision({ project: "AZSIM", otherLineCount: 2, changed: true }), "prompt");
    assert.equal(projectReceiptApplyDecision({ project: " AZSIM ", otherLineCount: 1, changed: true }), "prompt");
    assert.equal(projectReceiptApplyDecision({ project: "AZSIM", otherLineCount: 0, changed: true }), "save");
    assert.equal(projectReceiptApplyDecision({ project: "AZSIM", otherLineCount: -1, changed: true }), "save");
    assert.equal(projectReceiptApplyDecision({ project: "AZSIM", otherLineCount: Number.NaN, changed: true }), "save");
    assert.equal(projectReceiptApplyDecision({ project: "", otherLineCount: 4, changed: true }), "save");
    assert.equal(projectReceiptApplyDecision({ project: "   ", otherLineCount: 4, changed: true }), "save");
    assert.equal(projectReceiptApplyDecision({ project: null, otherLineCount: 4, changed: true }), "save");
    assert.equal(projectReceiptApplyDecision({ project: "AZSIM", otherLineCount: 4, changed: false }), "unchanged");
  });

  it("keeps the vendor question and the consignment question separate", () => {
    const vendor = projectReceiptApplySummary({ field: "vendor", project: "AZSIM6930", vendorName: " Acme " });
    const consigned = projectReceiptApplySummary({ field: "consignment", project: "AZSIM6930", consigned: true });
    const owned = projectReceiptApplySummary({ field: "consignment", project: "AZSIM6930", consigned: false });
    assert.match(vendor, /Apply Acme to the other receipts on AZSIM6930/);
    assert.match(vendor, /keeps that vendor/);
    assert.doesNotMatch(vendor, /consign/i);
    assert.match(consigned, /Apply consigned to the other receipts on AZSIM6930/);
    assert.match(consigned, /keeps that consignment/);
    assert.doesNotMatch(consigned, /Acme|vendor/i);
    assert.match(owned, /Apply not consigned to the other receipts on AZSIM6930/);
    assert.equal(
      projectReceiptApplyDecision({ project: "AZSIM6930", otherLineCount: 3, changed: true }),
      "prompt",
    );
  });

  it("treats a blank purchase order as consigned and leaves an explicit flag alone when it already matches", () => {
    assert.equal(savedReceiptConsigned(null), true);
    assert.equal(savedReceiptConsigned("  "), true);
    assert.equal(savedReceiptConsigned("po-1"), false);
    assert.equal(consignmentFollowsReceipt(true, null), true);
    assert.equal(consignmentFollowsReceipt(false, ""), false);
    assert.equal(consignmentFollowsReceipt(false, "po-1"), true);
    assert.equal(consignmentFollowsReceipt(true, " po-1 "), false);
  });
});

describe("receipt project owner migration", () => {
  it("updates only the receipt vendor or consignment, and only lines on that project", () => {
    assert.match(sql, /its\.receipt_owner/);
    assert.match(sql, /public\.apply_receipt_owner/);
    assert.match(sql, /public\.receipt_effective_project/);
    assert.match(sql, /p_apply_project/);
    assert.match(sql, /vendor_id = v_new_vendor/);
    assert.match(sql, /ownership = v_new_ownership/);
    assert.match(sql, /p_field = 'vendor'/);
    assert.match(sql, /p_field = 'consignment'/);
    assert.match(sql, /grant execute on function public\.apply_receipt_owner/);
    assert.match(sql, /to service_role/);
    assert.doesNotMatch(sql, /update public\.bin_cycles/);
    assert.doesNotMatch(sql, /update public\.stock_units/);
  });
});
