import assert from "node:assert/strict";
import test from "node:test";
import { NAV_GROUPS, pageMetaFor } from "./nav.ts";

const OTHER_GROUPS: Record<string, string[]> = {
  Inventory: ["/items", "/lens", "/taxonomies", "/labels"],
  Contacts: ["/customers", "/vendors"],
  Sales: ["/sales/orders"],
  Purchasing: ["/purchasing/orders"],
  Pricing: ["/pricing"],
  Admin: [
    "/admin/manufacturers",
    "/admin/data",
    "/admin/users",
    "/admin/settings",
    "/admin/integrations",
  ],
};

test("warehouse nav follows the floor and leaves the other menus in place", () => {
  assert.deepEqual(
    NAV_GROUPS.map((group) => group.label),
    ["Inventory", "Contacts", "Sales", "Purchasing", "Warehouse", "Pricing", "Admin"],
  );

  for (const [label, hrefs] of Object.entries(OTHER_GROUPS)) {
    const group = NAV_GROUPS.find((entry) => entry.label === label);
    assert.deepEqual(
      group?.items.map((item) => item.href),
      hrefs,
      label,
    );
  }

  const warehouse = NAV_GROUPS.find((group) => group.label === "Warehouse");
  assert.ok(warehouse);
  assert.deepEqual(
    warehouse.items.map((item) => ({
      label: item.label,
      href: item.href,
      disabled: item.disabled ?? false,
    })),
    [
      { label: "Inventory search", href: "/warehouse/inventory", disabled: false },
      { label: "Receiving", href: "/warehouse/receiving", disabled: false },
      { label: "Move inventory", href: "/warehouse/move", disabled: false },
      { label: "Cycle count", href: "/warehouse/cycle-count", disabled: true },
      { label: "Picking", href: "/warehouse/pick", disabled: false },
      { label: "Packing", href: "/warehouse/pack", disabled: false },
      { label: "Shipping", href: "/warehouse/ship", disabled: false },
      { label: "Scan", href: "/scan", disabled: false },
      { label: "Bin labels", href: "/warehouse/bins", disabled: false },
    ],
  );

  const cycle = warehouse.items.find((item) => item.href === "/warehouse/cycle-count");
  assert.match(cycle?.description ?? "", /coming soon/i);
  const meta = pageMetaFor("/warehouse/cycle-count");
  assert.equal(meta.title, "ITS");
  assert.deepEqual(
    meta.crumbs.map((crumb) => crumb.label),
    ["ITS"],
  );
});
