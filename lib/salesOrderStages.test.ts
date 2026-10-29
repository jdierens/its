import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  salesOrderPackOpenRefused,
  salesOrderPickOpenRefused,
  salesOrderShipHref,
  salesOrderStageActive,
  salesOrderStageNav,
} from "./salesOrderStages.ts";

const ORDER = "6f1c0b2e-1111-4222-8333-444455556666";

function nav(status: string, extra: Partial<Parameters<typeof salesOrderStageNav>[0]> = {}) {
  return salesOrderStageNav({
    orderId: ORDER,
    status,
    pickStatus: null,
    numbered: status !== "draft",
    current: "order",
    ...extra,
  });
}

function stage(model: ReturnType<typeof salesOrderStageNav>, id: "order" | "pick" | "pack" | "ship") {
  const found = model.stages.find((row) => row.id === id);
  assert.ok(found, id);
  return found;
}

describe("sales order stage navigation", () => {
  it("keeps a draft on the sales order", () => {
    const model = nav("draft", { numbered: false });
    assert.equal(stage(model, "order").active, true);
    assert.equal(stage(model, "order").current, true);
    assert.equal(stage(model, "order").href, null);
    assert.equal(stage(model, "pick").active, false);
    assert.equal(stage(model, "pick").href, null);
    assert.equal(stage(model, "pick").reason, "Approve the sales order before picking.");
    assert.equal(stage(model, "pack").active, false);
    assert.equal(stage(model, "pack").reason, "Finish the pick before packing.");
    assert.equal(model.previous, null);
    assert.equal(model.next, null);
    assert.equal(model.stages.some((row) => row.id === "ship"), false);
  });

  it("opens picking from an approved order and leaves packing off", () => {
    const model = nav("approved");
    assert.equal(stage(model, "pick").active, true);
    assert.equal(stage(model, "pick").href, `/warehouse/pick/${ORDER}`);
    assert.equal(stage(model, "pack").active, false);
    assert.equal(model.next?.id, "pick");
    assert.equal(salesOrderStageActive({ orderId: ORDER, status: "approved", numbered: false }, "pick"), false);
  });

  it("does not treat proforma, payment, or release as a pick", () => {
    for (const status of ["proforma_sent", "awaiting_payment", "released"]) {
      const model = nav(status);
      assert.equal(stage(model, "pick").active, false, status);
      assert.equal(stage(model, "pack").active, false, status);
    }
  });

  it("keeps packing off while the pick list is still open", () => {
    const model = nav("picking", { pickStatus: "open", current: "pick" });
    assert.equal(stage(model, "order").href, `/sales/orders/${ORDER}`);
    assert.equal(stage(model, "pick").current, true);
    assert.equal(stage(model, "pick").href, null);
    assert.equal(stage(model, "pack").active, false);
    assert.equal(model.previous?.id, "order");
    assert.equal(model.next, null);
  });

  it("opens packing once the pick is finished and still offers the earlier stages", () => {
    for (const pickStatus of ["picked", "short"] as const) {
      const model = nav("picking", { pickStatus, current: "pick" });
      assert.equal(stage(model, "pack").active, true, pickStatus);
      assert.equal(stage(model, "pack").href, `/warehouse/pack/${ORDER}`);
      assert.equal(model.previous?.id, "order");
      assert.equal(model.next?.id, "pack");
    }

    const packing = nav("packing", { pickStatus: "picked", current: "pack" });
    assert.equal(stage(packing, "order").active, true);
    assert.equal(stage(packing, "pick").active, true);
    assert.equal(stage(packing, "pick").href, `/warehouse/pick/${ORDER}`);
    assert.equal(stage(packing, "pack").current, true);
    assert.equal(packing.previous?.id, "pick");
    assert.equal(packing.next, null);
  });

  it("keeps earlier stages open after the order is packed or further along", () => {
    for (const status of ["packed", "partially_shipped", "shipped", "invoiced", "closed"]) {
      const model = nav(status, { pickStatus: "picked", current: "pack" });
      assert.equal(stage(model, "pick").active, true, status);
      assert.equal(stage(model, "pack").active, true, status);
      assert.equal(model.stages.some((row) => row.id === "ship"), false, status);
    }
  });

  it("still opens a finished pick after the order is cancelled", () => {
    const open = nav("cancelled", { pickStatus: "open", numbered: true });
    assert.equal(stage(open, "pick").active, true);
    assert.equal(stage(open, "pack").active, false);

    const picked = nav("cancelled", { pickStatus: "picked", numbered: true, current: "pack" });
    assert.equal(stage(picked, "pick").active, true);
    assert.equal(stage(picked, "pack").active, true);
    assert.equal(picked.previous?.id, "pick");
  });

  it("leaves shipping out until a per-order page exists", () => {
    assert.equal(salesOrderShipHref(ORDER), null);
    const packed = nav("packed", { pickStatus: "picked", current: "pack" });
    assert.equal(packed.stages.some((row) => row.id === "ship"), false);
  });

  it("adds shipping as a future stage when a route is supplied, and enables it after packing", () => {
    const href = `/warehouse/ship/${ORDER}`;
    const picking = nav("picking", { pickStatus: "open", current: "pick", shipHref: href });
    const waiting = stage(picking, "ship");
    assert.equal(waiting.active, false);
    assert.equal(waiting.href, null);
    assert.equal(waiting.reason, "Finish packing before shipping.");
    assert.equal(picking.next, null);

    const packed = nav("packed", { pickStatus: "picked", current: "pack", shipHref: href });
    const ready = stage(packed, "ship");
    assert.equal(ready.active, true);
    assert.equal(ready.href, href);
    assert.equal(packed.next?.id, "ship");
    assert.equal(packed.previous?.id, "pick");
  });

  it("recognizes the database sentences that mean the sheet can still be read", () => {
    assert.equal(salesOrderPickOpenRefused("Start from an approved sales order."), true);
    assert.equal(salesOrderPickOpenRefused("Nothing to pick on this order."), false);
    assert.equal(salesOrderPackOpenRefused("This sales order is cancelled."), true);
    assert.equal(salesOrderPackOpenRefused("Finish the pick before packing."), false);
  });
});
