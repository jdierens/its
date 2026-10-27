import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CONSIGNED_VENDOR_REQUIRED,
  readStoredVendor,
  receiveConsignment,
  receivingVendorStorageKey,
  writeStoredVendor,
} from "@/lib/consignedReceive";

const sql = readFileSync(new URL("../supabase/migrations/20261027233000_consigned_receive.sql", import.meta.url), "utf8");

describe("receive consignment", () => {
  it("requires a vendor and marks the receipt consigned when there is no purchase order", () => {
    assert.deepEqual(receiveConsignment({ purchaseOrderId: "  ", vendorId: "" }), {
      ok: false,
      message: CONSIGNED_VENDOR_REQUIRED,
    });
    assert.deepEqual(receiveConsignment({ vendorId: " vendor-1 " }), {
      ok: true,
      purchaseOrderId: null,
      vendorId: "vendor-1",
      consigned: true,
    });
  });

  it("keeps a purchase-order receipt off the consigned flag and lets the order supply the vendor", () => {
    assert.deepEqual(receiveConsignment({ purchaseOrderId: " po-1 ", vendorId: " vendor-9 " }), {
      ok: true,
      purchaseOrderId: "po-1",
      vendorId: "vendor-9",
      consigned: false,
    });
    assert.deepEqual(receiveConsignment({ purchaseOrderId: "po-1", vendorId: null }), {
      ok: true,
      purchaseOrderId: "po-1",
      vendorId: null,
      consigned: false,
    });
  });

  it("remembers the vendor beside the project on this device", () => {
    const key = receivingVendorStorageKey("its.receiving.project.JD");
    const saved = new Map<string, string>();
    const storage = {
      getItem: (name: string) => saved.get(name) ?? null,
      setItem: (name: string, value: string) => {
        saved.set(name, value);
      },
    };
    assert.equal(readStoredVendor(storage, key), null);
    writeStoredVendor(storage, key, "vendor-1");
    assert.equal(readStoredVendor(storage, key), "vendor-1");
  });
});

describe("consigned receive migration", () => {
  it("stores vendor and consigned on the receipt, the cycle, and the unit, and leaves a purchase order unmarked", () => {
    assert.match(sql, /Not applied here/);
    assert.match(sql, /20261027230000_stock_units\.sql/);
    assert.match(sql, /add column if not exists vendor_id uuid references public\.vendors \(id\)/);
    assert.match(sql, /ownership is null or ownership in \('owned', 'consigned'\)/);
    assert.match(sql, /A receipt without a purchase order is consigned/);
    assert.match(sql, /v_ownership := 'consigned'/);
    assert.match(sql, /v_ownership := null/);
    assert.match(sql, /That vendor is not on this purchase order/);
    assert.match(sql, /v_event\.vendor_id/);
    assert.match(sql, /stock_units_copy_owner/);
    assert.match(sql, /so_picks_copy_vendor/);
    assert.match(sql, /grant execute on function public\.receive_into_bin\(text, uuid, integer, text, text, text, text, text, date, integer, text, text, boolean, boolean, text, jsonb, uuid, uuid\) to service_role/);
    assert.doesNotMatch(sql, /grant .+ to anon/);
  });
});
