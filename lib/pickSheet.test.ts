import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  explainPickEdit,
  finishBlockMessage,
  formatPickQty,
  isStockPickLine,
  omitPickTicketSku,
  pickSheetPlace,
  lineRemaining,
  parsePickQty,
  isShippedPickStatus,
  pickCatchUpNote,
  pickFinishStatus,
  pickSaveState,
  PICK_SAVE_SAVED,
  PICK_SAVE_SAVING,
  PICK_SAVE_UNSAVED,
  pickOwnership,
  pickQtyError,
  pickQueueFromJson,
  pickQueueLabel,
  pickSheetEditable,
  pickSheetFromJson,
  pickTargetForBin,
  pickWritableStatus,
  pickedAfterShipNote,
  pickedQuantity,
  shippedOrderNeedsPick,
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

  it("enables finish only when the open pick can be saved", () => {
    assert.deepEqual(pickSaveState({ editable: true, pickStatus: "open", blocked: false, finishing: false }), {
      dirty: true,
      hint: PICK_SAVE_UNSAVED,
    });
    assert.deepEqual(pickSaveState({ editable: true, pickStatus: "open", blocked: false, finishing: true }), {
      dirty: true,
      hint: PICK_SAVE_SAVING,
    });
    assert.deepEqual(pickSaveState({ editable: true, pickStatus: "open", blocked: true, finishing: false }), {
      dirty: false,
      hint: PICK_SAVE_SAVED,
    });
    assert.deepEqual(pickSaveState({ editable: true, pickStatus: "picked", blocked: false, finishing: false }), {
      dirty: false,
      hint: PICK_SAVE_SAVED,
    });
    assert.deepEqual(pickSaveState({ editable: true, pickStatus: "short", blocked: false, finishing: false }), {
      dirty: false,
      hint: PICK_SAVE_SAVED,
    });
    assert.deepEqual(pickSaveState({ editable: false, pickStatus: "open", blocked: false, finishing: false }), {
      dirty: false,
      hint: PICK_SAVE_SAVED,
    });
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
    assert.equal(sheet.lines[0].picked, 1);
    assert.equal(sheet.lines[0].picks[0].serials[0].serial, "KIOXIA-1");
    assert.equal(sheet.lines[0].picks[0].serials[0].coo, null);
    assert.equal(sheet.lines[0].itemCoo, null);
    assert.equal(sheet.skipped[0].sku, "4343");
    assert.equal(sheet.allowReplacement, false);
    assert.equal(sheet.lines[0].plannedSku, "106683");
    assert.equal(sheet.lines[0].replaced, false);
    assert.equal(sheet.orderReference, "PO-1");
    assert.equal("customerPo" in sheet, false);
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
    assert.equal(queue[0].orderReference, null);
  });

  it("uses the sales order list reference on the sheet and the queue", () => {
    const base = {
      order_id: "edefb794-d601-4f39-99bc-cefd0fd67d00",
      so_number: 27767,
      status: "picking",
      customer: "Example",
      customer_po: "PO-1",
      pick_list_id: null,
      pick_status: null,
      staging_bin: null,
      staging: [],
      finish_block: null,
      handoff: null,
      lines: [],
      skipped: [],
      orphans: [],
    };
    assert.equal(
      pickSheetFromJson({ ...base, ebay_order_id: "12-03456-78901" }).orderReference,
      "12-03456-78901",
    );
    assert.equal(pickSheetFromJson({ ...base, ebay_order_id: "  " }).orderReference, "PO-1");
    assert.equal(pickSheetFromJson({ ...base, customer_po: null, ebay_order_id: null }).orderReference, null);
    const queue = pickQueueFromJson([
      {
        order_id: base.order_id,
        so_number: 27767,
        status: "approved",
        customer: "Example",
        customer_po: "",
        ebay_order_id: " 12-03456-78901 ",
        order_date: null,
        pick_status: null,
        staging_bin: null,
        ordered: 1,
        picked: 0,
      },
    ]);
    assert.equal(queue[0].orderReference, "12-03456-78901");
  });
});

describe("pick order reference migration", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261029020000_pick_order_reference.sql", import.meta.url),
    "utf8",
  );

  it("adds the eBay order id to the pick sheet and the pick queue only", () => {
    assert.match(sql, /p\.proname = 'sales_order_pick_sheet'/);
    assert.match(sql, /p\.proname = 'list_pick_queue'/);
    assert.match(sql, /''ebay_order_id'', v_order\.ebay_order_id/);
    assert.match(sql, /''ebay_order_id'', o\.ebay_order_id/);
    assert.equal(sql.includes("list_pack_queue"), false);
    assert.equal(sql.includes("sales_order_pack_sheet"), false);
    assert.equal(sql.includes("list_ship_queue"), false);
  });
});

describe("finished pick still shows its quantity", () => {
  it("keeps the picked total when the line and its pick rows agree", () => {
    assert.equal(pickedQuantity(1, [{ qty: 1 }]), 1);
    assert.equal(pickedQuantity(0, []), 0);
  });

  it("uses the pick rows when the reported line total is behind them", () => {
    assert.equal(pickedQuantity(0, [{ qty: 1 }]), 1);
    const sheet = pickSheetFromJson({
      order_id: "ad72aa0c-8117-4972-b25e-59e632d934be",
      so_number: 27783,
      status: "shipped",
      customer: "eBay Customer",
      customer_po: null,
      ebay_order_id: "24-15361-91829",
      pick_list_id: "2c2b49ba-f952-4f84-9d3b-ee37fddf9629",
      pick_status: "picked",
      staging_bin: null,
      staging: [],
      finish_block: null,
      handoff: "Picked into the staging bin. Packing is next.",
      lines: [
        {
          allocation_id: "a9707195-64e3-4bf3-b540-b28d402336fd",
          line_no: 1,
          sku: "106823",
          name: "NIC",
          ordered: 1,
          picked: 0,
          short: false,
          bins: [],
          picks: [
            {
              id: "f0d41eac-237f-4a0f-b2a3-b0354d67c8be",
              from_bin: "10049-C",
              qty: 1,
              project: "AZSIM6930",
              ownership: "consigned",
              serials: [],
            },
          ],
        },
      ],
      skipped: [],
      orphans: [],
    });
    assert.equal(sheet.pickStatus, "picked");
    assert.equal(sheet.status, "shipped");
    assert.equal(sheet.lines[0].picked, 1);
    assert.equal(sheet.lines[0].picks[0].qty, 1);
    assert.deepEqual(sheetProgress(sheet.lines), { ordered: 1, picked: 1 });
  });
});

describe("editing a finished pick", () => {
  it("stays editable after finish on a shipped order and locks once packing starts", () => {
    assert.equal(pickSheetEditable({ canPick: true, status: "shipped", pickStatus: "picked" }), true);
    assert.equal(pickSheetEditable({ canPick: true, status: "partially_shipped", pickStatus: "short" }), true);
    assert.equal(pickSheetEditable({ canPick: true, status: "picking", pickStatus: "picked" }), true);
    assert.equal(pickSheetEditable({ canPick: true, status: "picking", pickStatus: "open" }), true);
    assert.equal(pickSheetEditable({ canPick: false, status: "shipped", pickStatus: "picked" }), false);
    for (const status of ["packing", "packed", "invoiced", "closed", "cancelled"]) {
      assert.equal(pickSheetEditable({ canPick: true, status, pickStatus: "picked" }), false, status);
    }
  });

  it("names the migration when a finished list still refuses the save", () => {
    assert.match(
      explainPickEdit("This pick sheet is already finished."),
      /20261104061116_pick_edit_after_finish\.sql/,
    );
    assert.equal(explainPickEdit("Enter a serial."), "Enter a serial.");
  });
});

describe("shipped orders that still need a pick", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261104183000_pick_shipped_orders.sql", import.meta.url),
    "utf8",
  );

  function branch(marker: string): string {
    const start = sql.indexOf(marker);
    assert.notEqual(start, -1, marker);
    const elseAt = sql.indexOf("\n  else", start);
    assert.notEqual(elseAt, -1, marker);
    return sql.slice(start, elseAt);
  }

  it("lets shipped and partially shipped orders record a pick and leaves every other status closed", () => {
    assert.equal(pickWritableStatus("approved"), true);
    assert.equal(pickWritableStatus("picking"), true);
    assert.equal(pickWritableStatus("shipped"), true);
    assert.equal(pickWritableStatus("partially_shipped"), true);
    for (const status of ["draft", "packing", "packed", "cancelled", "invoiced", "closed"]) {
      assert.equal(pickWritableStatus(status), false, status);
      assert.equal(isShippedPickStatus(status), false, status);
      assert.equal(pickCatchUpNote(status), null, status);
      assert.equal(pickedAfterShipNote(status, "picked"), null, status);
    }

    assert.equal(shippedOrderNeedsPick("shipped", null), true);
    assert.equal(shippedOrderNeedsPick("shipped", "open"), true);
    assert.equal(shippedOrderNeedsPick("partially_shipped", null), true);
    assert.equal(shippedOrderNeedsPick("shipped", "picked"), false);
    assert.equal(shippedOrderNeedsPick("shipped", "short"), false);
    assert.equal(shippedOrderNeedsPick("picking", null), false);
    assert.equal(shippedOrderNeedsPick("invoiced", null), false);
    assert.equal(shippedOrderNeedsPick("cancelled", "open"), false);

    assert.equal(
      pickCatchUpNote("shipped"),
      "This order already shipped. Picking records the bins and leaves the ship record in place.",
    );
    assert.match(pickCatchUpNote("partially_shipped") ?? "", /partially shipped/);
    assert.equal(pickCatchUpNote("picking"), null);
    assert.equal(pickedAfterShipNote("shipped", "picked"), "Picked. This order stays shipped.");
    assert.equal(pickedAfterShipNote("shipped", "short"), "Short pick is recorded. This order stays shipped.");
    assert.equal(
      pickedAfterShipNote("partially_shipped", "picked"),
      "Picked. This order stays partially shipped.",
    );
    assert.equal(pickQueueLabel("shipped", "open"), "Shipped");
    assert.equal(pickQueueLabel("partially_shipped", null), "Partially shipped");
    assert.equal(pickQueueLabel("picking", "open"), "Picking");
    assert.equal(pickQueueLabel("approved", null), "Approved");
  });

  it("opens and finishes a shipped pick without moving status, ship date, or shipments", () => {
    assert.match(sql, /Apply by hand/);
    assert.match(sql, /Deploying does not run this file/);
    assert.match(sql, /p_status in \('approved', 'picking', 'shipped', 'partially_shipped'\)/);
    assert.match(sql, /Same inventory movement|same movement|same functions as a pick/i);
    assert.doesNotMatch(sql, /insert into public\.inventory_movements/i);
    assert.doesNotMatch(sql, /ship_date\s*=/);
    assert.doesNotMatch(sql, /(?:update|insert|delete)\s+(?:from\s+)?public\.so_shipments/i);
    assert.doesNotMatch(sql, /grant execute on function public\.so_picking_writable/);
    assert.doesNotMatch(sql, /grant .+ to anon/);

    const opened = branch("-- shipped catch-up open");
    assert.match(opened, /v_status,\s*\n\s*v_status/);
    assert.match(opened, /Picking after shipping\. Status stays/);
    assert.doesNotMatch(opened, /update public\.sales_orders/);
    assert.doesNotMatch(opened, /status = 'picking'/);
    const openElse = sql.slice(sql.indexOf("\n  else", sql.indexOf("-- shipped catch-up open")));
    assert.match(openElse.slice(0, 500), /status = 'picking'/);

    const finished = branch("-- shipped catch-up finish");
    assert.match(finished, /v_order_status,\s*\n\s*v_order_status/);
    assert.match(finished, /Picked after shipping\. Status stays/);
    assert.doesNotMatch(finished, /update public\.sales_orders/);
    assert.doesNotMatch(finished, /status = 'picking'/);
    assert.match(sql, /update public\.so_pick_lists/);
    assert.match(sql, /'picking',\s*\n\s*'picking'/);
  });

  it("keeps saving a pick on the normal inventory path and lists the catch-up on the queues", () => {
    assert.match(
      sql,
      /not public\.so_picking_writable\(\(select status from public\.sales_orders where id = p_order for update\)\)/,
    );
    assert.match(sql, /not public\.so_picking_writable\(v_status\)/);
    assert.match(sql, /pick_sales_order_line/);
    assert.match(sql, /record_pulled_serial/);
    assert.match(sql, /assign_pick_staging_bin/);
    assert.match(sql, /elsif v_status not in \('draft', 'approved', 'picking'\)/);
    assert.match(sql, /Approval still refuses a shipped order|approval still refuses a shipped order/i);

    assert.match(sql, /o\.status in \('approved', 'picking'\)/);
    assert.match(sql, /o\.status in \('shipped', 'partially_shipped'\)/);
    assert.match(sql, /coalesce\(pl\.status, 'open'\) not in \('picked', 'short'\)/);
    assert.match(sql, /'ebay_order_id', o\.ebay_order_id/);
    assert.match(sql, /o\.status = 'packing'/);
    assert.match(sql, /o\.status = 'picking' and pl\.status in \('picked', 'short'\)/);
    assert.match(sql, /o\.packed_at is null/);
    assert.match(sql, /pl\.status in \('picked', 'short'\)/);
    assert.match(sql, /grant execute on function public\.list_pick_queue\(\) to service_role/);
    assert.match(sql, /grant execute on function public\.list_pack_queue\(\) to service_role/);
    assert.match(sql, /grant execute on function public\.finish_sales_order_pick\(uuid, text, uuid\) to service_role/);
  });
});

describe("edit a finished pick list", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261104061116_pick_edit_after_finish.sql", import.meta.url),
    "utf8",
  );

  it("lets a picked or short list take corrections and reopens it when the balance breaks", () => {
    assert.match(sql, /p_status in \('open', 'picked', 'short'\)/);
    assert.match(sql, /so_pick_list_editable\(v_status\)/);
    assert.match(sql, /so_pick_list_editable\(status\)/);
    assert.match(sql, /so_pick_list_editable\(v_list_status\)/);
    for (const name of ["record_pick_serial", "remove_pick_serial", "undo_sales_order_pick", "pick_sales_order_line", "record_pulled_serial", "set_pick_short", "assign_pick_staging_bin"]) {
      assert.match(sql, new RegExp(name));
    }
    assert.match(sql, /so_sync_finished_pick_list/);
    assert.match(sql, /set status = 'open'/);
    assert.match(sql, /finished_at = null/);
    assert.doesNotMatch(sql, /grant execute on function public\.so_pick_list_editable/);
    assert.match(sql, /revoke all on function public\.so_pick_list_editable\(text\) from public, anon, authenticated/);
    assert.match(sql, /revoke all on function public\.so_sync_finished_pick_list\(\) from public, anon, authenticated/);
    assert.doesNotMatch(sql, /finish_sales_order_pick/);
  });
});
