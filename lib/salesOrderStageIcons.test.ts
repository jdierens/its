import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  emptySalesOrderStageInput,
  qboInvoiceAmountsMatch,
  qboInvoiceVoided,
  salesOrderStageIcons,
  type QboInvoiceFacts,
  type SalesOrderStageIconId,
  type SalesOrderStageInput,
  type SalesOrderStageTone,
} from "./salesOrderStageIcons.ts";

function input(partial: Partial<SalesOrderStageInput> = {}): SalesOrderStageInput {
  return { ...emptySalesOrderStageInput("draft"), ...partial };
}

function qbo(partial: Partial<QboInvoiceFacts> & Pick<QboInvoiceFacts, "saleAmount">): QboInvoiceFacts {
  return { present: true, totalAmount: partial.saleAmount, ...partial };
}

function tone(stages: ReturnType<typeof salesOrderStageIcons>, id: SalesOrderStageIconId): SalesOrderStageTone {
  const stage = stages.find((row) => row.id === id);
  if (!stage) throw new Error(`missing ${id}`);
  return stage.tone;
}

function title(stages: ReturnType<typeof salesOrderStageIcons>, id: SalesOrderStageIconId): string {
  const stage = stages.find((row) => row.id === id);
  if (!stage) throw new Error(`missing ${id}`);
  return stage.title;
}

describe("sales order stage icons", () => {
  it("leaves a draft neutral, including a numbered draft that was never approved", () => {
    const stages = salesOrderStageIcons(input());
    for (const stage of stages) assert.equal(stage.tone, "neutral", stage.id);
    assert.equal(title(stages, "invoiced"), "Invoiced");
  });

  it("turns approved green once status leaves draft", () => {
    const stages = salesOrderStageIcons(input({ status: "approved" }));
    assert.equal(tone(stages, "approved"), "done");
    assert.equal(tone(stages, "picked"), "neutral");
    assert.equal(tone(stages, "cancelled"), "neutral");
  });

  it("turns pick yellow when a pickable order shipped without a pick, and pack yellow without a pack", () => {
    const stages = salesOrderStageIcons(input({ status: "shipped", hasPickableLines: true, picked: false, packed: false }));
    assert.equal(tone(stages, "approved"), "done");
    assert.equal(tone(stages, "picked"), "gap");
    assert.equal(title(stages, "picked"), "Shipped without picking");
    assert.equal(tone(stages, "packed"), "gap");
    assert.equal(title(stages, "packed"), "Shipped without packing");
    assert.equal(tone(stages, "shipped"), "done");
    assert.equal(tone(stages, "invoiced"), "neutral");
  });

  it("keeps pick neutral when the shipped order has no stock lines to pick", () => {
    const stages = salesOrderStageIcons(input({ status: "shipped", hasPickableLines: false, hasShipment: true }));
    assert.equal(tone(stages, "picked"), "neutral");
    assert.equal(tone(stages, "packed"), "gap");
    assert.equal(tone(stages, "shipped"), "done");
  });

  it("keeps pick green when the pick was finished, and does not warn a shipped order that was packed", () => {
    const stages = salesOrderStageIcons(input({ status: "shipped", hasPickableLines: true, picked: true, packed: true }));
    assert.equal(tone(stages, "picked"), "done");
    assert.equal(tone(stages, "packed"), "done");
    assert.equal(tone(stages, "shipped"), "done");
    assert.equal(tone(stages, "invoiced"), "neutral");
  });

  it("turns pack yellow when the order shipped from a shipment row without a pack", () => {
    const stages = salesOrderStageIcons(input({ status: "draft", hasShipment: true, hasPickableLines: true }));
    assert.equal(tone(stages, "approved"), "gap");
    assert.equal(title(stages, "approved"), "Shipped without approval");
    assert.equal(tone(stages, "packed"), "gap");
    assert.equal(tone(stages, "shipped"), "done");
  });

  it("turns earlier icons yellow when a matching QuickBooks invoice exists and those stages did not", () => {
    const stages = salesOrderStageIcons(
      input({
        status: "approved",
        hasPickableLines: true,
        total: 100,
        qbo: qbo({ saleAmount: 100, totalAmount: 100 }),
      }),
    );
    assert.equal(tone(stages, "invoiced"), "done");
    assert.equal(tone(stages, "shipped"), "gap");
    assert.equal(title(stages, "shipped"), "Invoiced without shipping");
    assert.equal(tone(stages, "packed"), "gap");
    assert.equal(title(stages, "packed"), "Invoiced without packing");
    assert.equal(tone(stages, "picked"), "gap");
    assert.equal(title(stages, "picked"), "Invoiced without picking");
    assert.equal(tone(stages, "paid"), "bad");
    assert.equal(title(stages, "paid"), "Unpaid");
  });

  it("turns the invoice icon red when the QuickBooks sale amount disagrees", () => {
    const stages = salesOrderStageIcons(
      input({
        status: "shipped",
        hasPickableLines: true,
        picked: true,
        packed: true,
        total: 80,
        qbo: qbo({ saleAmount: 100, totalAmount: 100 }),
      }),
    );
    assert.equal(tone(stages, "invoiced"), "bad");
    assert.equal(title(stages, "invoiced"), "QuickBooks invoice does not match this sales order");
  });

  it("turns the invoice icon red when the QuickBooks total is $0 and the sales order is not", () => {
    const stages = salesOrderStageIcons(
      input({
        status: "shipped",
        picked: true,
        packed: true,
        total: 100,
        qbo: qbo({ saleAmount: 0, totalAmount: 0 }),
      }),
    );
    assert.equal(tone(stages, "invoiced"), "bad");
    assert.equal(title(stages, "invoiced"), "QuickBooks invoice total is $0");
  });

  it("turns the invoice icon green only when the QuickBooks sale amount matches the line total", () => {
    const stages = salesOrderStageIcons(
      input({
        status: "shipped",
        hasPickableLines: true,
        picked: true,
        packed: true,
        total: 100,
        qbo: qbo({ saleAmount: 100.004, totalAmount: 120 }),
      }),
    );
    assert.equal(tone(stages, "invoiced"), "done");
    assert.equal(title(stages, "invoiced"), "Invoiced");
  });

  it("stays neutral when no QuickBooks invoice row exists, even after shipping", () => {
    const stages = salesOrderStageIcons(input({ status: "shipped", qbo: { present: false, saleAmount: 0, totalAmount: 0 } }));
    assert.equal(tone(stages, "invoiced"), "neutral");
    assert.equal(title(stages, "invoiced"), "Invoiced");
  });

  it("shows cancelled on its own and paints fulfillment that already happened red", () => {
    const stages = salesOrderStageIcons(
      input({
        status: "cancelled",
        approvedAt: true,
        hasPickableLines: true,
        picked: true,
        packed: false,
        hasShipment: true,
        total: 100,
        qbo: qbo({ saleAmount: 100, totalAmount: 100 }),
      }),
    );
    assert.equal(tone(stages, "cancelled"), "done");
    assert.equal(tone(stages, "approved"), "done");
    assert.equal(tone(stages, "picked"), "bad");
    assert.equal(title(stages, "picked"), "Picked on a cancelled order");
    assert.equal(tone(stages, "packed"), "neutral");
    assert.equal(tone(stages, "shipped"), "bad");
    assert.equal(tone(stages, "invoiced"), "bad");
    assert.equal(title(stages, "invoiced"), "Invoiced on a cancelled order");
  });

  it("leaves pick, pack, ship, and invoice neutral when a cancelled order never reached them", () => {
    const stages = salesOrderStageIcons(input({ status: "cancelled", approvedAt: true }));
    assert.equal(tone(stages, "cancelled"), "done");
    assert.equal(tone(stages, "approved"), "done");
    assert.equal(tone(stages, "picked"), "neutral");
    assert.equal(tone(stages, "packed"), "neutral");
    assert.equal(tone(stages, "shipped"), "neutral");
    assert.equal(tone(stages, "invoiced"), "neutral");
  });

  it("places Paid beside Invoiced and leaves an unpaid draft gray", () => {
    const stages = salesOrderStageIcons(input());
    assert.deepEqual(
      stages.map((stage) => stage.id),
      ["approved", "picked", "packed", "shipped", "invoiced", "paid", "cancelled"],
    );
    assert.equal(tone(stages, "paid"), "neutral");
    assert.equal(title(stages, "paid"), "Paid");
  });

  it("turns Paid red when an invoice is unpaid, the order is awaiting payment, or a prepay order has left draft", () => {
    const invoiced = salesOrderStageIcons(
      input({ status: "shipped", total: 100, qbo: qbo({ saleAmount: 100 }) }),
    );
    assert.equal(tone(invoiced, "paid"), "bad");
    assert.equal(title(invoiced, "paid"), "Unpaid");
    const waiting = salesOrderStageIcons(input({ status: "awaiting_payment" }));
    assert.equal(tone(waiting, "paid"), "bad");
    const prepay = salesOrderStageIcons(
      input({ status: "approved", payment: { amount: null, status: "unpaid", dated: false, requirement: "prepay" } }),
    );
    assert.equal(tone(prepay, "paid"), "bad");
    const draftPrepay = salesOrderStageIcons(
      input({ payment: { amount: null, status: "unpaid", dated: false, requirement: "prepay" } }),
    );
    assert.equal(tone(draftPrepay, "paid"), "neutral");
  });

  it("turns Paid green when the recorded amount matches the QuickBooks invoice to the cent", () => {
    const stages = salesOrderStageIcons(
      input({
        status: "shipped",
        total: 80,
        qbo: qbo({ saleAmount: 100.004 }),
        payment: { amount: 100, status: "unpaid", dated: true, requirement: "terms" },
      }),
    );
    assert.equal(tone(stages, "paid"), "done");
    assert.equal(title(stages, "paid"), "Paid");
    assert.equal(tone(stages, "shipped"), "done");
  });

  it("turns Paid yellow when the amount differs, when only part was recorded, or when there is no invoice yet", () => {
    const mismatch = salesOrderStageIcons(
      input({
        status: "shipped",
        total: 100,
        qbo: qbo({ saleAmount: 100 }),
        payment: { amount: 80, status: "paid", dated: true, requirement: "terms" },
      }),
    );
    assert.equal(tone(mismatch, "paid"), "gap");
    assert.equal(title(mismatch, "paid"), "Payment does not match this invoice");
    const partial = salesOrderStageIcons(
      input({
        status: "shipped",
        total: 100,
        qbo: qbo({ saleAmount: 100 }),
        payment: { amount: null, status: "partial", dated: true, requirement: "prepay" },
      }),
    );
    assert.equal(tone(partial, "paid"), "gap");
    assert.equal(title(partial, "paid"), "Partial payment");
    const early = salesOrderStageIcons(
      input({
        status: "approved",
        payment: { amount: 50, status: "unpaid", dated: true, requirement: "terms" },
      }),
    );
    assert.equal(tone(early, "paid"), "gap");
    assert.equal(title(early, "paid"), "Payment recorded without a QuickBooks invoice");
    assert.equal(tone(early, "shipped"), "neutral");
  });

  it("treats a paid eBay order with no payment amount as the buyer total", () => {
    const matched = salesOrderStageIcons(
      input({
        status: "shipped",
        total: 100,
        qbo: qbo({ saleAmount: 100 }),
        payment: { amount: null, status: "paid", dated: true, requirement: "prepay" },
      }),
    );
    assert.equal(tone(matched, "paid"), "done");
    const short = salesOrderStageIcons(
      input({
        status: "shipped",
        total: 90,
        qbo: qbo({ saleAmount: 100 }),
        payment: { amount: null, status: "paid", dated: true, requirement: "prepay" },
      }),
    );
    assert.equal(tone(short, "paid"), "gap");
    assert.equal(title(short, "paid"), "Payment does not match this invoice");
  });

  it("turns a recorded payment on a cancelled order red and leaves an unpaid cancellation gray", () => {
    const recorded = salesOrderStageIcons(
      input({
        status: "cancelled",
        total: 100,
        qbo: qbo({ saleAmount: 100 }),
        payment: { amount: 100, status: "paid", dated: true, requirement: "terms" },
      }),
    );
    assert.equal(tone(recorded, "paid"), "bad");
    assert.equal(title(recorded, "paid"), "Payment on a cancelled order");
    const unpaid = salesOrderStageIcons(input({ status: "cancelled", approvedAt: true }));
    assert.equal(tone(unpaid, "paid"), "neutral");
  });

  it("matches the QuickBooks sale amount to the cent and flags a voided total", () => {
    assert.equal(qboInvoiceAmountsMatch(10, 10), true);
    assert.equal(qboInvoiceAmountsMatch(10, 10.004), true);
    assert.equal(qboInvoiceAmountsMatch(10, 10.02), false);
    assert.equal(qboInvoiceAmountsMatch(null, 0), true);
    assert.equal(qboInvoiceVoided(100, 0), true);
    assert.equal(qboInvoiceVoided(0, 0), false);
    assert.equal(qboInvoiceVoided(100, 100), false);
  });
});

describe("sales order stage icon chips", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  it("uses a dark imprint on a light tint for gray, green, yellow, and red in day, night, and print", () => {
    const chips: Array<[string, string]> = [
      ["--stage-neutral-bg", "#e4e4e7"],
      ["--stage-neutral-ink", "#18181b"],
      ["--stage-done-bg", "#bbf7d0"],
      ["--stage-done-ink", "#14532d"],
      ["--stage-gap-bg", "#fde68a"],
      ["--stage-gap-ink", "#713f12"],
      ["--stage-bad-bg", "#fecdd3"],
      ["--stage-bad-ink", "#9f1239"],
    ];
    for (const [name, value] of chips) {
      const found = css.match(new RegExp(`${name}:\\s*${value}`, "g"));
      assert.equal(found?.length, 3, `${name} should be ${value} in day, night, and print`);
    }
    assert.match(css, /\.so-stage-icon\.so-stage-done[\s\S]*var\(--stage-done-bg\)[\s\S]*var\(--stage-done-ink\)/);
    assert.match(css, /\.so-stage-icon\.so-stage-gap[\s\S]*var\(--stage-gap-bg\)[\s\S]*var\(--stage-gap-ink\)/);
    assert.match(css, /\.so-stage-icon\.so-stage-bad[\s\S]*var\(--stage-bad-bg\)[\s\S]*var\(--stage-bad-ink\)/);
    assert.equal(css.includes("--stage-done-bg: #166534"), false);
    assert.equal(css.includes("--stage-done-ink: #bbf7d0"), false);
    assert.equal(css.includes("--stage-neutral-ink: #fafafa"), false);
    assert.equal(css.includes("--stage-gap-ink: #fef9c3"), false);
  });
});

describe("so_invoices QuickBooks import migration", () => {
  it("adds the import columns and the unique invoice id without a data backfill", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261102080500_so_invoices_qbo_import.sql", import.meta.url), "utf8");
    assert.match(sql, /add column if not exists source/);
    assert.match(sql, /qbo_sale_amount/);
    assert.match(sql, /qbo_total_amt/);
    assert.match(sql, /qbo_fee_amount/);
    assert.match(sql, /so_invoices_source_check/);
    assert.match(sql, /so_invoices_qbo_invoice_id_unique/);
    assert.match(sql, /qbo_import/);
    assert.match(sql, /Apply by hand/);
    assert.match(sql, /Deploying does not run this file/);
    assert.equal(/insert\s+into/i.test(sql), false);
    assert.equal(/update\s+public\.so_invoices/i.test(sql), false);
  });
});
