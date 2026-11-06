import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { NAV_GROUPS, pageMetaFor } from "./nav.ts";
import { packAccessForRole } from "./packAccess.ts";
import {
  defaultPackAssignQty,
  duplicatePackBlock,
  explainPackEdit,
  formatBinSize,
  isPackLine,
  isShippedPackStatus,
  orderHasPackSerials,
  PACK_ADD_QTY,
  PACK_SAVE_SAVED,
  PACK_SAVE_SAVING,
  PACK_SAVE_UNSAVED,
  packAssignQtyText,
  packCatchUpNote,
  packCompleteBlock,
  packageContentChips,
  packageRowStatus,
  packagingTypeError,
  packagingTypeMeasures,
  packedAfterShipNote,
  packContentLabel,
  packFinishVisible,
  packQtyError,
  packQueueFromJson,
  packQueueLabel,
  packRoom,
  packSaveState,
  packSerialMatch,
  packSheetEditable,
  packSheetFromJson,
  shippedOrderNeedsPack,
  packAssignmentLabel,
  parsePackQty,
  parsePackWeight,
  shipQueueFromJson,
  shippingBinLabel,
  unpackedRemainder,
  type PackBinCheck,
  type PackLine,
} from "./packSheet.ts";

const sql = readFileSync(new URL("../supabase/migrations/20261028233000_sales_order_packing.sql", import.meta.url), "utf8");
const shippedSql = readFileSync(new URL("../supabase/migrations/20261102143000_pack_shipped_orders.sql", import.meta.url), "utf8");
const packSheetUi = readFileSync(new URL("../components/PackSheet.tsx", import.meta.url), "utf8");
const editSql = readFileSync(new URL("../supabase/migrations/20261106010000_pack_edit_after_finish.sql", import.meta.url), "utf8");
const rowSql = readFileSync(new URL("../supabase/migrations/20261106150000_pack_row_packages.sql", import.meta.url), "utf8");

describe("what gets packed", () => {
  it("packs picked product and kit lines and leaves services, freight, and unpicked lines out", () => {
    assert.equal(isPackLine({ lineKind: "product", itemType: "Product", picked: 2, sku: "106683" }), true);
    assert.equal(isPackLine({ lineKind: "kit", itemType: "Kit/Package", picked: 1, sku: "KIT" }), true);
    assert.equal(isPackLine({ lineKind: "product", itemType: "Product", picked: 0, sku: "106683" }), false);
    assert.equal(isPackLine({ lineKind: "service", itemType: "Service", picked: 1, sku: "4343" }), false);
    assert.equal(isPackLine({ lineKind: "product", itemType: "Service", picked: 1, sku: "4343" }), false);
    assert.equal(isPackLine({ lineKind: "freight", itemType: "Service", picked: 1, sku: "4343" }), false);
    assert.equal(isPackLine({ lineKind: "fee", itemType: "Product", picked: 1, sku: "FEE" }), false);
    assert.equal(isPackLine({ lineKind: "product", itemType: "Non-inventory", picked: 1, sku: "NOTE" }), false);
  });
});

describe("pack complete", () => {
  const box = (weight: number | null, height = 12): PackBinCheck => ({
    number: 1,
    kind: "box",
    weightLb: weight,
    heightIn: height,
  });

  it("splits one picked line across a box and a pallet and still requires both weights", () => {
    const line = { lineNo: 1, sku: "106683", picked: 5, packed: 0 };
    const pallet: PackBinCheck = { number: 2, kind: "pallet", weightLb: null, heightIn: null };
    assert.equal(packRoom(5, 0, 0), 5);
    assert.equal(packQtyError(3, 5), null);
    assert.equal(parsePackQty("3", 5).ok, true);
    assert.equal(packQtyError(6, 5), "Only 5 can go in that bin.");
    assert.equal(packCompleteBlock([line], []), "Add a shipping bin before packing can be finished.");

    line.packed = 2;
    assert.equal(packRoom(5, 2, 0), 3);
    assert.equal(
      packCompleteBlock([line], [box(4)]),
      "Line 1 106683 still has 3 to pack.",
    );

    line.packed = 5;
    assert.equal(packCompleteBlock([line], [box(4), pallet]), "Pallet 2 needs a height.");
    pallet.heightIn = 48;
    assert.equal(packCompleteBlock([line], [box(null, 12), pallet]), "Box 1 needs a weight.");
    assert.equal(packCompleteBlock([line], [box(0, 12), pallet]), "Box 1 needs a weight.");
    assert.equal(packCompleteBlock([line], [box(6.5), pallet]), "Pallet 2 needs a weight.");
    pallet.weightLb = 210;
    assert.equal(packCompleteBlock([line], [box(6.5), pallet]), null);
    assert.equal(shippingBinLabel("pallet", 2), "Pallet 2");
    assert.equal(packAssignmentLabel("box", 1, 8), "8 in Box 1");
    assert.equal(packAssignmentLabel("pallet", 2, 3), "3 in Pallet 2");
    assert.equal(formatBinSize({ lengthIn: 48, widthIn: 40, heightIn: 48 }), "48 × 40 × 48 in");

    line.packed = 6;
    assert.equal(packCompleteBlock([line], [box(6.5), pallet]), "Line 1 106683 has more packed than picked.");
  });

  it("does not finish an order that has nothing picked", () => {
    assert.equal(
      packCompleteBlock([{ lineNo: 1, sku: "106683", picked: 0, packed: 0 }], []),
      "Nothing was picked, so there is nothing to pack.",
    );
  });

  it("keeps a second line open after the first line is fully in a bin", () => {
    assert.equal(
      packCompleteBlock(
        [
          { lineNo: 1, sku: "106683", picked: 2, packed: 2 },
          { lineNo: 2, sku: "107021", picked: 4, packed: 1 },
        ],
        [box(8)],
      ),
      "Line 2 107021 still has 3 to pack.",
    );
  });
});

describe("assign quantity", () => {
  it("starts at 1 and does not submit the rest of the line unless that number was typed", () => {
    const room = packRoom(8, 0, 0);
    assert.equal(room, 8);
    assert.equal(defaultPackAssignQty(room), "1");
    assert.equal(defaultPackAssignQty(1), "1");
    assert.equal(defaultPackAssignQty(0), "");
    assert.equal(defaultPackAssignQty(0.4), "");

    const untouched = parsePackQty(packAssignQtyText(undefined, room), room);
    assert.deepEqual(untouched, { ok: true, qty: 1 });
    const explicitRemainder = parsePackQty(packAssignQtyText("8", room), room);
    assert.deepEqual(explicitRemainder, { ok: true, qty: 8 });
    const cleared = parsePackQty(packAssignQtyText("", room), room);
    assert.equal(cleared.ok, false);

    const afterOne = packRoom(8, 1, 0);
    assert.equal(packAssignQtyText(undefined, afterOne), "1");
    assert.equal(packAssignQtyText(undefined, packRoom(8, 8, 0)), "");
    assert.equal(parsePackQty("9", room).ok, false);
    assert.equal(packQtyError(1, 0), "That line is already packed.");

    assert.match(packSheetUi, /PACK_ADD_QTY/);
    assert.doesNotMatch(packSheetUi, /formatPackQty\(room\)/);
    assert.doesNotMatch(packSheetUi, /qtyText\[line\.allocationId\] \?\? \(room/);
    assert.doesNotMatch(packSheetUi, /Assign \$\{line\.sku\}/);
  });
});

describe("packaging types", () => {
  it("requires a fixed height on a box and leaves pallet height for the bin", () => {
    assert.equal(
      packagingTypeError({ name: "Medium box", kind: "box", length: "18", width: "14", height: "12" }),
      null,
    );
    assert.deepEqual(
      packagingTypeMeasures({ kind: "box", length: "18", width: "14", height: "12" }),
      { lengthIn: 18, widthIn: 14, heightIn: 12 },
    );
    assert.equal(
      packagingTypeError({ name: "Standard pallet", kind: "pallet", length: "48", width: "40", height: "" }),
      null,
    );
    assert.deepEqual(packagingTypeMeasures({ kind: "pallet", length: "48", width: "40", height: "" }), {
      lengthIn: 48,
      widthIn: 40,
      heightIn: null,
    });
    assert.equal(
      packagingTypeError({ name: "Standard pallet", kind: "pallet", length: "48", width: "40", height: "20" }),
      "A pallet height is entered when the bin is packed, not on the type.",
    );
    assert.equal(
      packagingTypeError({ name: "Flat", kind: "box", length: "12", width: "10", height: "" }),
      "A box needs a height in inches.",
    );
    assert.equal(parsePackWeight("7.25").ok, true);
    assert.equal(parsePackWeight("0").ok, false);
    assert.equal(parsePackWeight("1.234").ok, false);
  });
});

describe("pack sheet json", () => {
  it("reads bins, a split assignment, and the finish block without prices", () => {
    const sheet = packSheetFromJson({
      order_id: "edefb794-d601-4f39-99bc-cefd0fd67d00",
      so_number: 27767,
      status: "packing",
      customer: "Example",
      customer_po: "PO-1",
      pick_status: "picked",
      finish_block: "Line 1 106683 still has 3 to pack.",
      handoff: null,
      types: [{ id: "type-1", name: "Medium box", kind: "box", length_in: "18", width_in: 14, height_in: 12 }],
      bins: [
        {
          id: "bin-1",
          number: 1,
          kind: "box",
          type_id: "type-1",
          type_name: "Medium box",
          length_in: 18,
          width_in: 14,
          height_in: 12,
          weight_lb: null,
        },
      ],
      lines: [
        {
          allocation_id: "alloc-1",
          line_no: 1,
          sku: "107021",
          name: "Drive",
          planned_sku: "106683",
          replaced: true,
          picked: 5,
          packed: 2,
          assignments: [{ id: "row-1", bin_id: "bin-1", bin_number: 1, kind: "box", qty: 2 }],
        },
      ],
    });
    assert.equal(sheet.lines[0]?.packed, 2);
    assert.equal(sheet.lines[0]?.replaced, true);
    assert.deepEqual(sheet.lines[0]?.serials, []);
    assert.equal(sheet.bins[0]?.weightLb, null);
    assert.equal(sheet.finishBlock, "Line 1 106683 still has 3 to pack.");
    assert.equal(sheet.packedAt, null);
    assert.equal(sheet.editable, true);
    assert.equal(JSON.stringify(sheet).includes("price"), false);

    const queue = packQueueFromJson([
      {
        order_id: sheet.orderId,
        so_number: 27767,
        status: "packing",
        customer: "Example",
        customer_po: null,
        order_date: "2026-10-28",
        pick_status: "picked",
        picked: 5,
        packed: 2,
        bins: 1,
      },
    ]);
    assert.equal(queue[0]?.packed, 2);
    const waiting = shipQueueFromJson([
      {
        order_id: sheet.orderId,
        so_number: 27767,
        customer: "Example",
        customer_po: "PO-1",
        packed_at: "2026-10-28T18:00:00Z",
        bins: 1,
      },
    ]);
    assert.equal(waiting[0]?.bins, 1);
  });
});

describe("pack access and navigation", () => {
  it("lets the same roles pack and keeps read_only from changing bins", () => {
    assert.equal(packAccessForRole("admin", true).canPack, true);
    assert.equal(packAccessForRole("staff", true).canPack, true);
    assert.equal(packAccessForRole("warehouse_clerk", true).canPack, true);
    assert.equal(packAccessForRole("read_only", true).canPack, false);
    assert.equal(packAccessForRole(null, false).canPack, true);
  });

  it("puts packing and the shipping stub in the warehouse nav", () => {
    const warehouse = NAV_GROUPS.find((group) => group.label === "Warehouse");
    assert.equal(warehouse?.items.find((item) => item.href === "/warehouse/pack")?.label, "Packing");
    assert.equal(warehouse?.items.find((item) => item.href === "/warehouse/ship")?.label, "Shipping");
    const meta = pageMetaFor("/warehouse/pack/edefb794-d601-4f39-99bc-cefd0fd67d00");
    assert.equal(meta.title, "Pack");
    assert.equal(meta.crumbs[1]?.href, "/warehouse/pack");
  });
});

describe("shipped orders that still need a pack", () => {
  const base = {
    order_id: "5e5006b2-cc24-4a64-96fb-b9056c528133",
    so_number: 27674,
    customer: "eBay Customer",
    customer_po: null,
    pick_status: "picked",
    handoff: null,
    types: [],
    bins: [],
    lines: [
      {
        allocation_id: "alloc-1",
        line_no: 1,
        sku: "106614",
        name: "Drive",
        planned_sku: "106614",
        replaced: false,
        picked: 1,
        packed: 0,
        assignments: [],
      },
    ],
  };

  it("keeps an older shipped sheet locked until the database says packing is open", () => {
    const legacy = packSheetFromJson({
      ...base,
      status: "shipped",
      finish_block: null,
    });
    assert.equal(legacy.editable, false);
    assert.equal(legacy.packedAt, null);
    assert.equal(isShippedPackStatus(legacy.status), true);
    assert.equal(packCatchUpNote("packing"), null);
  });

  it("opens bins on a shipped order that has no packed_at and stays editable after finish", () => {
    const open = packSheetFromJson({
      ...base,
      status: "shipped",
      packed_at: null,
      editable: true,
      finish_block: "Add a shipping bin before packing can be finished.",
    });
    assert.equal(open.editable, true);
    assert.equal(open.packedAt, null);
    assert.equal(packFinishVisible({ status: open.status, packedAt: open.packedAt, finishBlock: open.finishBlock }), true);
    assert.equal(packCatchUpNote(open.status), "This order already shipped. Packing records the bins and leaves the ship record in place.");
    assert.equal(packedAfterShipNote(open.status), "Packed. This order stays shipped.");

    const done = packSheetFromJson({
      ...base,
      status: "shipped",
      packed_at: "2026-11-02T16:00:00Z",
      editable: true,
      finish_block: null,
    });
    assert.equal(done.status, "shipped");
    assert.equal(done.editable, true);
    assert.equal(done.packedAt, "2026-11-02T16:00:00Z");
    assert.equal(packFinishVisible({ status: done.status, packedAt: done.packedAt, finishBlock: done.finishBlock }), false);

    const partial = packSheetFromJson({
      ...base,
      status: "partially_shipped",
      packed_at: null,
      editable: true,
      finish_block: "Line 1 106614 still has 1 to pack.",
    });
    assert.equal(partial.editable, true);
    assert.match(packCatchUpNote(partial.status) ?? "", /partially shipped/);
    assert.equal(packedAfterShipNote(partial.status), "Packed. This order stays partially shipped.");
    assert.equal(
      packFinishVisible({ status: partial.status, packedAt: partial.packedAt, finishBlock: partial.finishBlock }),
      true,
    );
  });

  it("does not treat cancelled, invoiced, or closed as an open pack", () => {
    for (const status of ["cancelled", "invoiced", "closed"]) {
      const sheet = packSheetFromJson({
        ...base,
        status,
        packed_at: null,
        editable: false,
        finish_block: null,
      });
      assert.equal(sheet.editable, false, status);
      assert.equal(packCatchUpNote(status), null, status);
      assert.equal(isShippedPackStatus(status), false, status);
      assert.equal(
        packSheetEditable({
          canPack: true,
          status,
          packedAt: null,
          serverEditable: false,
          pickStatus: "picked",
        }),
        false,
        status,
      );
    }
  });
});

describe("editing a finished pack", () => {
  it("stays editable after finish and shows Finish again when the sheet is reopened", () => {
    assert.equal(
      packSheetEditable({
        canPack: true,
        status: "packed",
        packedAt: "2026-11-05T12:00:00Z",
        serverEditable: true,
        pickStatus: "picked",
      }),
      true,
    );
    assert.equal(
      packSheetEditable({
        canPack: true,
        status: "packed",
        packedAt: "2026-11-05T12:00:00Z",
        serverEditable: false,
        pickStatus: "picked",
      }),
      true,
    );
    assert.equal(
      packSheetEditable({
        canPack: true,
        status: "shipped",
        packedAt: "2026-11-05T12:00:00Z",
        serverEditable: false,
        pickStatus: "short",
      }),
      true,
    );
    assert.equal(
      packSheetEditable({
        canPack: true,
        status: "partially_shipped",
        packedAt: "2026-11-05T12:00:00Z",
        serverEditable: true,
        pickStatus: "picked",
      }),
      true,
    );
    assert.equal(
      packSheetEditable({
        canPack: true,
        status: "packing",
        packedAt: null,
        serverEditable: true,
        pickStatus: "picked",
      }),
      true,
    );
    assert.equal(
      packSheetEditable({
        canPack: false,
        status: "packed",
        packedAt: "2026-11-05T12:00:00Z",
        serverEditable: true,
        pickStatus: "picked",
      }),
      false,
    );
    assert.equal(
      packSheetEditable({
        canPack: true,
        status: "shipped",
        packedAt: null,
        serverEditable: false,
        pickStatus: "picked",
      }),
      false,
    );
    assert.equal(
      packSheetEditable({
        canPack: true,
        status: "shipped",
        packedAt: "2026-11-05T12:00:00Z",
        serverEditable: false,
        pickStatus: "open",
      }),
      false,
    );

    assert.equal(packFinishVisible({ status: "packing", packedAt: null, finishBlock: null }), true);
    assert.equal(packFinishVisible({ status: "packing", packedAt: null, finishBlock: "Box 1 needs a weight." }), true);
    assert.equal(packFinishVisible({ status: "shipped", packedAt: null, finishBlock: "Line 1 106614 still has 1 to pack." }), true);
    assert.equal(packFinishVisible({ status: "packed", packedAt: "2026-11-05T12:00:00Z", finishBlock: null }), false);
    assert.equal(packFinishVisible({ status: "shipped", packedAt: "2026-11-05T12:00:00Z", finishBlock: null }), false);
    assert.equal(
      packFinishVisible({
        status: "packed",
        packedAt: "2026-11-05T12:00:00Z",
        finishBlock: "Line 1 106614 still has 3 to pack.",
      }),
      true,
    );
    assert.equal(
      packFinishVisible({
        status: "shipped",
        packedAt: null,
        finishBlock: null,
      }),
      true,
    );
  });

  it("names the migration when a finished pack still refuses the save", () => {
    assert.match(
      explainPackEdit("Packing is closed on this sales order."),
      /20261106010000_pack_edit_after_finish\.sql/,
    );
    assert.equal(explainPackEdit("Enter a weight in pounds."), "Enter a weight in pounds.");
  });
});

describe("packing migration", () => {
  it("adds the packaging list, shipping bins, and the pack-complete gate", () => {
    assert.match(sql, /Apply by hand/);
    assert.match(sql, /Deploying does not run this file/);
    assert.match(sql, /create table public\.packaging_types/);
    assert.match(sql, /kind in \('box', 'pallet'\)/);
    assert.match(sql, /'packing'/);
    assert.match(sql, /packed_at/);
    assert.match(sql, /alter table public\.so_packages/);
    assert.match(sql, /so_package_contents_package_allocation_unique/);
    assert.match(sql, /Nothing was picked, so there is nothing to pack\./);
    assert.match(sql, /Add a shipping bin before packing can be finished\./);
    assert.match(sql, /has more packed than picked/);
    assert.match(sql, /still has /);
    assert.match(sql, /needs a height/);
    assert.match(sql, /needs a weight/);
    assert.match(sql, /so_pick_sheet_place/);
    assert.match(sql, /status = 'packed'/);
    assert.match(sql, /Carrier labels and rate shopping are not on this screen/);
    assert.match(sql, /alter table public\.packaging_types enable row level security/);
    assert.match(sql, /revoke all on table public\.packaging_types from public, anon, authenticated/);
    assert.match(sql, /grant select, insert, update, delete on table public\.packaging_types to service_role/);
    assert.match(sql, /grant execute on function public\.finish_sales_order_pack\(uuid, text, uuid\) to service_role/);
    assert.match(sql, /grant execute on function public\.list_ship_queue\(\) to service_role/);
    assert.doesNotMatch(sql, /grant .+ to anon/);
  });
});

describe("pack shipped orders migration", () => {
  it("lets a shipped order record bins and packed_at without leaving shipped", () => {
    assert.match(shippedSql, /Apply by hand/);
    assert.match(shippedSql, /Deploying does not run this file/);
    assert.match(shippedSql, /p_status = 'packing'/);
    assert.match(shippedSql, /p_status in \('shipped', 'partially_shipped'\)/);
    assert.match(shippedSql, /p_packed_at is null/);
    assert.match(shippedSql, /Packing is closed on this sales order/);
    assert.match(shippedSql, /so_pack_open_block/);
    assert.match(shippedSql, /'editable', v_editable/);
    assert.match(shippedSql, /'packed_at', v_order\.packed_at/);
    assert.match(shippedSql, /when v_order\.status in \('cancelled', 'closed', 'invoiced'\) then null/);

    const shippedStart = shippedSql.indexOf("if v_status in ('shipped', 'partially_shipped') then");
    const shippedBranch = shippedSql.slice(shippedStart, shippedSql.indexOf("else", shippedStart));
    assert.match(shippedBranch, /packed_at = now\(\)/);
    assert.match(shippedBranch, /v_status,\s*v_status/);
    assert.doesNotMatch(shippedBranch, /status =/);
    assert.doesNotMatch(shippedBranch, /ship_date/);
    assert.doesNotMatch(shippedSql, /(?:update|insert|delete)\s+(?:from\s+)?public\.so_shipments/i);
    assert.doesNotMatch(shippedSql, /ship_date\s*=/);
    assert.match(shippedSql, /status = 'packed'/);
    assert.match(shippedSql, /'packing',\s*'packed'/);
    assert.match(shippedSql, /grant execute on function public\.finish_sales_order_pack\(uuid, text, uuid\) to service_role/);
    assert.doesNotMatch(shippedSql, /grant .+ to anon/);
    assert.doesNotMatch(shippedSql, /grant execute on function public\.so_packing_writable/);
  });
});

describe("shipped orders on the pack queue", () => {
  it("lists a shipped order only after the pick is finished and before packed_at is set", () => {
    assert.equal(shippedOrderNeedsPack("shipped", "picked", null), true);
    assert.equal(shippedOrderNeedsPack("shipped", "short", null), true);
    assert.equal(shippedOrderNeedsPack("partially_shipped", "picked", null), true);
    assert.equal(shippedOrderNeedsPack("shipped", "open", null), false);
    assert.equal(shippedOrderNeedsPack("shipped", null, null), false);
    assert.equal(shippedOrderNeedsPack("shipped", "picked", "2026-11-02T16:00:00Z"), false);
    assert.equal(shippedOrderNeedsPack("packing", "picked", null), false);
    assert.equal(shippedOrderNeedsPack("cancelled", "picked", null), false);
    assert.equal(shippedOrderNeedsPack("invoiced", "picked", null), false);
    assert.equal(packQueueLabel("shipped"), "Shipped");
    assert.equal(packQueueLabel("partially_shipped"), "Partially shipped");
    assert.equal(packQueueLabel("packing"), "Packing");
    assert.equal(packQueueLabel("picking"), "Picked");
  });
});

describe("edit a finished pack", () => {
  function branch(marker: string, end: string): string {
    const start = editSql.indexOf(marker);
    assert.notEqual(start, -1, marker);
    const next = editSql.indexOf(end, start + marker.length);
    assert.notEqual(next, -1, `${marker} ${end}`);
    return editSql.slice(start, next);
  }

  it("keeps a finished pack writable and reopens it without un-shipping", () => {
    assert.match(editSql, /Apply by hand/);
    assert.match(editSql, /Deploying does not run this file/);
    assert.match(editSql, /fxsbpreasbdalwthyzvk/);
    assert.match(editSql, /p_status in \('packing', 'packed', 'shipped', 'partially_shipped'\)/);
    assert.doesNotMatch(
      editSql.slice(editSql.indexOf("function public.so_packing_writable"), editSql.indexOf("comment on function public.so_packing_writable")),
      /p_packed_at is null/,
    );
    assert.match(editSql, /so_reopen_finished_pack/);
    assert.match(editSql, /so_sync_finished_pack/);
    assert.match(editSql, /so_packages_sync_finished_pack/);
    assert.match(editSql, /so_package_contents_sync_finished_pack/);
    assert.match(editSql, /set status = 'packing'/);
    assert.match(editSql, /packed_at = null/);
    assert.match(editSql, /when public\.so_packing_writable\(v_order\.status, v_order\.packed_at\)/);
    assert.match(editSql, /Already finished and still complete/);
    assert.doesNotMatch(editSql, /grant execute on function public\.so_packing_writable/);
    assert.doesNotMatch(editSql, /grant execute on function public\.so_reopen_finished_pack/);
    assert.doesNotMatch(editSql, /grant execute on function public\.so_sync_finished_pack/);
    assert.match(editSql, /revoke all on function public\.so_packing_writable\(text, timestamptz\) from public, anon, authenticated/);
    assert.match(editSql, /revoke all on function public\.so_reopen_finished_pack\(uuid\) from public, anon, authenticated/);
    assert.match(editSql, /revoke all on function public\.so_sync_finished_pack\(\) from public, anon, authenticated/);
    assert.match(editSql, /grant execute on function public\.finish_sales_order_pack\(uuid, text, uuid\) to service_role/);
    assert.doesNotMatch(editSql, /grant .+ to anon/);
    assert.doesNotMatch(editSql, /ship_date\s*=/);
    assert.doesNotMatch(editSql, /(?:update|insert|delete)\s+(?:from\s+)?public\.so_shipments/i);

    const stayed = branch("-- shipped catch-up stays shipped", "\n  end if;");
    assert.match(stayed, /packed_at = null/);
    assert.doesNotMatch(stayed, /status =/);
    assert.doesNotMatch(stayed, /ship_date/);

    const finished = branch("-- shipped catch-up finish", "\n  elsif");
    assert.match(finished, /packed_at = now\(\)/);
    assert.match(finished, /v_status,\s*\n\s*v_status/);
    assert.doesNotMatch(finished, /status =/);
    assert.doesNotMatch(finished, /ship_date/);
    assert.match(editSql, /'packing',\s*\n\s*'packed'/);
  });
});

function packLine(overrides: Partial<PackLine> & Pick<PackLine, "allocationId" | "sku">): PackLine {
  return {
    lineNo: 1,
    name: "Drive",
    plannedSku: overrides.sku,
    replaced: false,
    picked: 8,
    packed: 0,
    assignments: [],
    serials: [],
    ...overrides,
  };
}

describe("package rows", () => {
  const box = {
    id: "bin-1",
    kind: "box" as const,
    number: 1,
    weightLb: 6.5,
    heightIn: 12,
  };

  it("starts a quantity at 1 and keeps the bin and the quantity apart", () => {
    assert.equal(PACK_ADD_QTY, "1");
    assert.equal(packContentLabel(8, "106683"), "8 × 106683");
    assert.equal(packAssignmentLabel("box", 1, 8), "8 in Box 1");
    assert.equal(packageRowStatus({ kind: "box", weightLb: null, heightIn: 12 }, 0), "Needs a weight");
    assert.equal(packageRowStatus({ kind: "box", weightLb: 4, heightIn: 12 }, 0), "Needs contents");
    assert.equal(packageRowStatus({ kind: "pallet", weightLb: 4, heightIn: null }, 1), "Needs a height");
    assert.equal(packageRowStatus(box, 8), "Complete");
  });

  it("shows one content chip for an item quantity, not one chip per piece", () => {
    const line = packLine({
      allocationId: "alloc-1",
      sku: "106683",
      picked: 8,
      packed: 8,
      assignments: [{ id: "row-1", binId: "bin-1", binNumber: 1, kind: "box", qty: 8 }],
    });
    const chips = packageContentChips("bin-1", [line]);
    assert.equal(chips.length, 1);
    assert.equal(chips[0]?.kind, "item");
    assert.equal(chips[0]?.label, "8 × 106683");
    assert.deepEqual(unpackedRemainder([line]), []);
  });

  it("lists serials on the package and leaves the item quantity for the pieces that have no serial", () => {
    const line = packLine({
      allocationId: "alloc-1",
      sku: "106683",
      picked: 8,
      packed: 5,
      assignments: [{ id: "row-1", binId: "bin-1", binNumber: 1, kind: "box", qty: 5 }],
      serials: [
        { id: "unit-1", serial: "SN1", packageId: "bin-1" },
        { id: "unit-2", serial: "SN2", packageId: "bin-1" },
        { id: "unit-3", serial: "SN3", packageId: null },
      ],
    });
    const chips = packageContentChips("bin-1", [line]);
    assert.deepEqual(
      chips.map((chip) => chip.label),
      ["3 × 106683", "SN1 · 106683", "SN2 · 106683"],
    );
    assert.equal(orderHasPackSerials([line]), true);
    assert.equal(orderHasPackSerials([packLine({ allocationId: "alloc-2", sku: "107021" })]), false);
    assert.deepEqual(unpackedRemainder([line]), ["3 × 106683"]);
  });

  it("resolves a serial to the picked item and refuses one that is not on the pick", () => {
    const line = packLine({
      allocationId: "alloc-1",
      sku: "106683",
      picked: 2,
      packed: 0,
      serials: [
        { id: "unit-1", serial: "SN1", packageId: null },
        { id: "unit-2", serial: "SN2", packageId: "bin-9" },
      ],
      assignments: [{ id: "row-9", binId: "bin-9", binNumber: 2, kind: "pallet", qty: 1 }],
    });
    assert.deepEqual(packSerialMatch([line], " sn1 "), {
      ok: true,
      allocationId: "alloc-1",
      serialId: "unit-1",
      sku: "106683",
    });
    assert.deepEqual(packSerialMatch([line], "SN2"), {
      ok: false,
      message: "That serial is already in Pallet 2.",
    });
    assert.deepEqual(packSerialMatch([line], "NOPE"), {
      ok: false,
      message: "That serial is not on this pick.",
    });
    assert.deepEqual(packSerialMatch([line], "  "), { ok: false, message: "Enter a serial." });

    const packed = packLine({
      allocationId: "alloc-1",
      sku: "106683",
      picked: 1,
      packed: 1,
      serials: [{ id: "unit-1", serial: "SN1", packageId: null }],
    });
    assert.equal(packSerialMatch([packed], "SN1").ok, false);
  });

  it("refuses to duplicate a package that is missing a weight, contents, or unpacked quantity", () => {
    const line = packLine({
      allocationId: "alloc-1",
      sku: "106683",
      picked: 8,
      packed: 8,
      assignments: [{ id: "row-1", binId: "bin-1", binNumber: 1, kind: "box", qty: 8 }],
    });
    assert.equal(duplicatePackBlock({ ...box, weightLb: null }, [line]), "Box 1 needs a weight before it can be duplicated.");
    assert.equal(
      duplicatePackBlock(box, [packLine({ allocationId: "alloc-1", sku: "106683" })]),
      "Box 1 needs contents before it can be duplicated.",
    );
    assert.equal(duplicatePackBlock(box, [line]), "Only 0 of 106683 can go in the next bin.");
    const open = packLine({
      ...line,
      picked: 16,
      packed: 8,
    });
    assert.equal(duplicatePackBlock(box, [open]), null);
  });

  it("keeps finish as the sticky save and leaves a finished pack editable when the sheet says so", () => {
    assert.deepEqual(
      packSaveState({ editable: true, packedAt: null, finishBlock: null, finishing: false }),
      { dirty: true, hint: PACK_SAVE_UNSAVED },
    );
    assert.deepEqual(
      packSaveState({ editable: true, packedAt: null, finishBlock: "Box 1 needs a weight.", finishing: false }),
      { dirty: false, hint: PACK_SAVE_SAVED },
    );
    assert.deepEqual(
      packSaveState({ editable: true, packedAt: "2026-11-06T00:00:00Z", finishBlock: null, finishing: false }),
      { dirty: false, hint: PACK_SAVE_SAVED },
    );
    assert.deepEqual(
      packSaveState({ editable: true, packedAt: null, finishBlock: null, finishing: true }),
      { dirty: true, hint: PACK_SAVE_SAVING },
    );

    const finished = packSheetFromJson({
      order_id: "5e5006b2-cc24-4a64-96fb-b9056c528133",
      so_number: 27784,
      status: "shipped",
      packed_at: "2026-11-06T00:00:00Z",
      editable: true,
      customer: "Example",
      customer_po: null,
      pick_status: "picked",
      finish_block: null,
      handoff: null,
      types: [],
      bins: [],
      lines: [
        {
          allocation_id: "alloc-1",
          line_no: 1,
          sku: "106683",
          name: "Drive",
          planned_sku: "106683",
          replaced: false,
          picked: 1,
          packed: 1,
          serials: [{ id: "unit-1", serial: "SN1", package_id: "bin-1" }],
          assignments: [{ id: "row-1", bin_id: "bin-1", bin_number: 1, kind: "box", qty: 1 }],
        },
      ],
    });
    assert.equal(finished.editable, true);
    assert.equal(finished.status, "shipped");
    assert.equal(finished.lines[0]?.serials[0]?.packageId, "bin-1");
    assert.equal(packedAfterShipNote(finished.status), "Packed. This order stays shipped.");
  });
});

describe("pack sheet ui", () => {
  it("packs from package rows, adds one at a time, and finishes from the sticky save", () => {
    assert.match(packSheetUi, /aria-label="Finish packing"/);
    assert.match(packSheetUi, /aria-label="Add package"/);
    assert.match(packSheetUi, /aria-label=\{`Add contents to \$\{label\}`\}/);
    assert.match(packSheetUi, /aria-label=\{`Duplicate \$\{label\}`\}/);
    assert.match(packSheetUi, /PACK_ADD_QTY/);
    assert.match(packSheetUi, /packSheetEditable\(/);
    assert.match(packSheetUi, /explainPackEdit\(/);
    assert.match(packSheetUi, /Serial — none on this pick/);
    assert.doesNotMatch(packSheetUi, /Picked lines/);
    assert.doesNotMatch(packSheetUi, /formatPackQty\(room\)/);
    assert.doesNotMatch(packSheetUi, /Assign \$\{line\.sku\}/);
  });
});

describe("pack row migration", () => {
  it("keeps a finished pack editable, copies a bin, and resolves serials from the pick", () => {
    assert.match(rowSql, /Apply by hand/);
    assert.match(rowSql, /Deploying does not run this file/);
    assert.match(rowSql, /p_status in \('packing', 'packed', 'shipped', 'partially_shipped'\)/);
    assert.match(rowSql, /packed_at does not lock the sheet/);
    assert.match(rowSql, /on delete set null/);
    assert.match(rowSql, /'serials'/);
    assert.match(rowSql, /That serial is not on this pick\./);
    assert.match(rowSql, /Does not create an item or a serial\./);
    assert.match(rowSql, /Already finished and still complete/);
    assert.match(rowSql, /when public\.so_packing_writable\(v_order\.status, v_order\.packed_at\)/);
    assert.doesNotMatch(rowSql, /Packing is already finished/);
    assert.match(rowSql, /needs a weight before it can be duplicated/);
    assert.match(rowSql, /needs contents before it can be duplicated/);
    assert.match(rowSql, /Only % of % can go in the next bin\./);
    assert.doesNotMatch(rowSql, /insert into public\.items/i);

    const writable = rowSql.slice(
      rowSql.indexOf("create or replace function public.so_packing_writable"),
      rowSql.indexOf("comment on function public.so_packing_writable"),
    );
    assert.match(writable, /'packed'/);
    assert.doesNotMatch(writable, /p_packed_at is null/);

    const shippedStart = rowSql.indexOf("if v_status in ('shipped', 'partially_shipped') then");
    const shippedBranch = rowSql.slice(shippedStart, rowSql.indexOf("\n  elsif", shippedStart));
    assert.match(shippedBranch, /packed_at = now\(\)/);
    assert.match(shippedBranch, /v_status,\s*v_status/);
    assert.doesNotMatch(shippedBranch, /status =/);
    assert.doesNotMatch(shippedBranch, /ship_date/);
    assert.doesNotMatch(rowSql, /(?:update|insert|delete)\s+(?:from\s+)?public\.so_shipments/i);
    assert.doesNotMatch(rowSql, /ship_date\s*=/);
    assert.match(rowSql, /grant execute on function public\.assign_pack_serial\(uuid, text, text, uuid\) to service_role/);
    assert.match(rowSql, /grant execute on function public\.duplicate_shipping_bin\(uuid, text, uuid\) to service_role/);
    assert.match(rowSql, /grant execute on function public\.release_pack_item_qty\(uuid, text, uuid\) to service_role/);
    assert.match(rowSql, /grant execute on function public\.remove_pack_serial\(uuid, text, uuid\) to service_role/);
    assert.doesNotMatch(rowSql, /grant .+ to anon/);
    assert.doesNotMatch(rowSql, /grant execute on function public\.so_packing_writable/);
  });
});
