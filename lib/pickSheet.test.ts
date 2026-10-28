import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  finishBlockMessage,
  formatPickQty,
  isStockPickLine,
  omitPickTicketSku,
  pickSheetPlace,
  lineRemaining,
  parsePickQty,
  pickFinishStatus,
  pickOwnership,
  pickQtyError,
  pickQueueFromJson,
  pickSheetFromJson,
  pickTargetForBin,
  serialAttachError,
  serialProblem,
  sheetProgress,
  stagingLayer,
} from "./pickSheet.ts";

describe("stock lines", () => {
  it("picks product and kit package lines and skips freight and service", () => {
    assert.equal(isStockPickLine({ lineKind: "product", itemType: "Product", itemId: "a" }), true);
    assert.equal(isStockPickLine({ lineKind: "kit", itemType: "Kit/Package", itemId: "a" }), true);
    assert.equal(isStockPickLine({ lineKind: "product", itemType: "Kit/Package", itemId: "a" }), true);
    assert.equal(isStockPickLine({ lineKind: "freight", itemType: "Service", itemId: "freight" }), false);
    assert.equal(isStockPickLine({ lineKind: "product", itemType: "Service", itemId: "4343" }), false);
    assert.equal(isStockPickLine({ lineKind: "fee", itemType: "Product", itemId: "a" }), false);
    assert.equal(isStockPickLine({ lineKind: "service", itemType: "Product", itemId: "a" }), false);
    assert.equal(isStockPickLine({ lineKind: "product", itemType: "Non-inventory", itemId: "a" }), false);
    assert.equal(isStockPickLine({ lineKind: "product", itemType: "Product", itemId: null }), false);
    assert.equal(pickSheetPlace({ lineKind: "service", itemType: "Service" }), "omit");
    assert.equal(pickSheetPlace({ lineKind: "product", itemType: "Service" }), "omit");
    assert.equal(pickSheetPlace({ lineKind: "freight", itemType: "Service" }), "omit");
    assert.equal(pickSheetPlace({ lineKind: "fee", itemType: "Product" }), "omit");
    assert.equal(pickSheetPlace({ lineKind: "product", itemType: "Non-inventory" }), "omit");
    assert.equal(pickSheetPlace({ lineKind: "product", itemType: "Product" }), "pick");
    assert.equal(omitPickTicketSku("4343"), true);
    assert.equal(omitPickTicketSku(" 4343 "), true);
    assert.equal(omitPickTicketSku("106683"), false);
  });
});

describe("staging ownership", () => {
  it("keeps AZSIM6930 and records it as consigned", () => {
    assert.deepEqual(stagingLayer("AZSIM6930", null), { project: "AZSIM6930", ownership: "consigned" });
    assert.equal(pickOwnership("  AZSIM6930  ", null), "consigned");
  });

  it("keeps an explicit ownership and treats a blank project as owned", () => {
    assert.deepEqual(stagingLayer("AZSIM6930", "owned"), { project: "AZSIM6930", ownership: "owned" });
    assert.deepEqual(stagingLayer(null, null), { project: null, ownership: "owned" });
    assert.deepEqual(stagingLayer("  ", "consigned"), { project: null, ownership: "consigned" });
  });
});

describe("pick quantity", () => {
  it("splits one order line across bins without passing what is left", () => {
    assert.equal(lineRemaining(2, 0), 2);
    assert.equal(lineRemaining(2, 1), 1);
    assert.deepEqual(sheetProgress([{ ordered: 2, picked: 1 }]), { ordered: 2, picked: 1 });
    assert.equal(pickQtyError(1, 33, 2), null);
    assert.equal(parsePickQty("2", 51, 2).ok, true);
    assert.equal(pickQtyError(3, 51, 2), "Only 2 still to pick.");
    assert.equal(pickQtyError(40, 33, 40), "Only 33 are in that bin.");
    assert.equal(parsePickQty("0", 33, 2).ok, false);
  });

  it("uses a bin scan for the first line that still needs that bin", () => {
    const lines = [
      {
        allocationId: "done",
        remaining: 0,
        bins: [{ binId: "b1", reference: "20000-B", qty: 33 }],
      },
      {
        allocationId: "open",
        remaining: 2,
        bins: [
          { binId: "b1", reference: "20000-B", qty: 33 },
          { binId: "b2", reference: "20007-B", qty: 51 },
        ],
      },
    ];
    assert.deepEqual(pickTargetForBin(lines, "20000-b"), { allocationId: "open", binId: "b1", qty: 2 });
    assert.equal(pickTargetForBin(lines, "106683"), null);
    assert.equal(formatPickQty(2), "2");
  });
});

describe("serials", () => {
  it("accepts a serial and rejects a SKU, a bin code, and a duplicate", () => {
    assert.equal(serialProblem({ serial: "KIOXIA-1", sku: "106683", existing: [] }), null);
    assert.equal(serialAttachError({ serial: "KIOXIA-1", sku: "106683", existing: [], attached: 0, picked: 2 }), null);
    assert.equal(
      serialProblem({ serial: "106683", sku: "106683", existing: [] }),
      "That scan is the SKU, not a serial.",
    );
    assert.equal(
      serialProblem({ serial: "20000-B", sku: "106683", existing: [] }),
      "That scan is a bin code, not a serial.",
    );
    assert.equal(
      serialProblem({ serial: "kioxia-1", sku: "106683", existing: ["KIOXIA-1"] }),
      "That serial is already recorded for this item.",
    );
    assert.equal(
      serialAttachError({ serial: "NEXT", sku: "106683", existing: [], attached: 2, picked: 2 }),
      "This pick already has a serial for each piece.",
    );
    assert.equal(
      serialAttachError({ serial: "NEXT", sku: "106683", existing: [], attached: 0, picked: 0 }),
      "Pick a quantity before scanning a serial.",
    );
  });
});

describe("finish", () => {
  const line = (picked: number, short = false) => ({ lineNo: 1, sku: "106683", ordered: 2, picked, short });

  it("finishes when ordered equals picked and blocks a short until it is acknowledged", () => {
    assert.equal(finishBlockMessage([line(2)], 0), null);
    assert.equal(pickFinishStatus([line(2)], 0), "picked");
    assert.equal(
      finishBlockMessage([line(0)], 0),
      "Line 1 106683 is short. Acknowledge the short before finishing.",
    );
    assert.equal(pickFinishStatus([line(0, true)], 0), "short");
    assert.equal(finishBlockMessage([line(1, true)], 0), null);
    assert.equal(pickFinishStatus([line(3)], 0), null);
    assert.match(finishBlockMessage([line(3)], 0) ?? "", /more picked than ordered/);
    assert.equal(finishBlockMessage([line(2)], 1), "A pick is no longer on a line. Undo it before finishing.");
  });
});

describe("pick sheet json", () => {
  it("reads a sheet without prices", () => {
    const sheet = pickSheetFromJson({
      order_id: "edefb794-d601-4f39-99bc-cefd0fd67d00",
      so_number: 27767,
      status: "picking",
      customer: "Example",
      customer_po: "PO-1",
      pick_list_id: "list-1",
      pick_status: "open",
      staging_bin: "20111-B",
      staging: [{ reference: "20111-B", project: "AZSIM6930", ownership: "consigned", qty: 1, sku: "106683" }],
      finish_block: "Line 1 106683 is short. Acknowledge the short before finishing.",
      handoff: null,
      lines: [
        {
          allocation_id: "alloc-1",
          line_no: 1,
          sku: "106683",
          name: "SSD",
          ordered: "2.00",
          picked: 1,
          short: false,
          bins: [
            {
              bin_id: "bin-1",
              reference: "20000-B",
              location: "HWS.00.00.00",
              qty: 33,
              project: "AZSIM6930",
              ownership: "consigned",
            },
          ],
          picks: [
            {
              id: "pick-1",
              from_bin: "20000-B",
              qty: 1,
              project: "AZSIM6930",
              ownership: "consigned",
              serials: [{ id: "unit-1", serial: "KIOXIA-1" }],
            },
          ],
        },
      ],
      skipped: [{ line_no: 2, sku: "4343", name: "Freight", reason: "Freight, fee, and service lines are not picked." }],
      orphans: [],
    });
    assert.equal(sheet.soNumber, 27767);
    assert.equal(sheet.lines[0].bins[0].project, "AZSIM6930");
    assert.equal(sheet.lines[0].bins[0].ownership, "consigned");
    assert.equal(sheet.lines[0].picks[0].serials[0].serial, "KIOXIA-1");
    assert.equal(sheet.lines[0].picks[0].serials[0].coo, null);
    assert.equal(sheet.lines[0].itemCoo, null);
    assert.equal(sheet.skipped[0].sku, "4343");
    assert.equal(sheet.allowReplacement, false);
    assert.equal(sheet.lines[0].plannedSku, "106683");
    assert.equal(sheet.lines[0].replaced, false);
    assert.equal("unit_price" in (sheet as object), false);
    const queue = pickQueueFromJson([
      {
        order_id: sheet.orderId,
        so_number: 27767,
        status: "approved",
        customer: "Example",
        customer_po: null,
        order_date: "2026-10-27",
        pick_status: null,
        staging_bin: null,
        ordered: 2,
        picked: 0,
      },
    ]);
    assert.equal(queue[0].soNumber, 27767);
    assert.equal(queue[0].ordered, 2);
  });
});
