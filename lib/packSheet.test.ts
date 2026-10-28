import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { NAV_GROUPS, pageMetaFor } from "./nav.ts";
import { packAccessForRole } from "./packAccess.ts";
import {
  formatBinSize,
  isPackLine,
  packCompleteBlock,
  packagingTypeError,
  packagingTypeMeasures,
  packQtyError,
  packQueueFromJson,
  packRoom,
  packSheetFromJson,
  parsePackQty,
  parsePackWeight,
  shipQueueFromJson,
  shippingBinLabel,
  type PackBinCheck,
} from "./packSheet.ts";

const sql = readFileSync(new URL("../supabase/migrations/20261028233000_sales_order_packing.sql", import.meta.url), "utf8");

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
    assert.equal(sheet.bins[0]?.weightLb, null);
    assert.equal(sheet.finishBlock, "Line 1 106683 still has 3 to pack.");
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
