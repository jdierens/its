/**
 * Shared sales-order stage navigation.
 *
 * Order → pick → pack are real pages. Shipping is not: Warehouse → Shipping
 * is the packed-order queue, with no page for one order. `salesOrderShipHref`
 * is the hook. When it returns a path, Shipping joins this control and stays
 * off until the order is packed.
 */

export type SalesOrderStageId = "order" | "pick" | "pack" | "ship";

export type SalesOrderPickStatus = "open" | "picked" | "short" | null;

export type SalesOrderStageInput = {
  orderId: string;
  status: string;
  pickStatus?: string | null;
  /** False while so_number is empty. Picking starts only after approval assigns one. */
  numbered: boolean;
  /**
   * Per-order shipping path. Omit this. `salesOrderShipHref` supplies it.
   * A test can pass a path to check the stage that appears once that page exists.
   */
  shipHref?: string | null;
};

export type SalesOrderStage = {
  id: SalesOrderStageId;
  label: string;
  /** Null when the stage cannot be opened, including the page you are already on. */
  href: string | null;
  active: boolean;
  current: boolean;
  /** Why a later stage stays off. Empty when it can be opened. */
  reason: string;
};

export type SalesOrderStageNavModel = {
  stages: SalesOrderStage[];
  previous: SalesOrderStage | null;
  next: SalesOrderStage | null;
};

/** Statuses `open_sales_order_pick` accepts. Anything else is refused. */
const PICK_START = new Set(["approved", "picking"]);

/** The order has moved past an open pick, so the pick sheet is only for looking. */
const AFTER_PICK = new Set(["packing", "packed", "partially_shipped", "shipped", "invoiced", "closed"]);

/** Packing has been opened, or the order is already packed or further along. */
const PACK_REACHED = new Set(["packing", "packed", "partially_shipped", "shipped", "invoiced", "closed"]);

/** `packed_at` is set and Warehouse → Shipping lists the order. */
const SHIP_REACHED = new Set(["packed", "partially_shipped", "shipped", "invoiced", "closed"]);

const PICK_FINISHED = new Set(["picked", "short"]);

/**
 * Path for one order's shipping page.
 * There is no such page yet. Return it here when the route exists, for example
 * `/warehouse/ship/${orderId}`. Leave this null and Shipping stays out of the control.
 */
export function salesOrderShipHref(_orderId: string): string | null {
  return null;
}

export function salesOrderPickOpenRefused(message: string): boolean {
  return message.includes("Start from an approved sales order.");
}

export function salesOrderPackOpenRefused(message: string): boolean {
  return message.includes("This sales order is cancelled.");
}

function pickStatusOf(value: string | null | undefined): SalesOrderPickStatus {
  if (value === "open" || value === "picked" || value === "short") return value;
  return null;
}

function pickActive(input: SalesOrderStageInput, pickStatus: SalesOrderPickStatus): boolean {
  if (input.numbered && PICK_START.has(input.status)) return true;
  if (pickStatus) return true;
  return AFTER_PICK.has(input.status);
}

function packActive(input: SalesOrderStageInput, pickStatus: SalesOrderPickStatus): boolean {
  if (pickStatus && PICK_FINISHED.has(pickStatus)) return true;
  return PACK_REACHED.has(input.status);
}

type StageSeed = {
  id: SalesOrderStageId;
  label: string;
  href: string | null;
  active: boolean;
  reason: string;
};

export function salesOrderStageNav(input: SalesOrderStageInput & { current: SalesOrderStageId }): SalesOrderStageNavModel {
  const pickStatus = pickStatusOf(input.pickStatus);
  const shipHref = input.shipHref === undefined ? salesOrderShipHref(input.orderId) : input.shipHref || null;
  const pickOn = pickActive(input, pickStatus);
  const packOn = packActive(input, pickStatus);
  const shipOn = SHIP_REACHED.has(input.status);

  const seeds: StageSeed[] = [
    {
      id: "order",
      label: "Sales order",
      href: `/sales/orders/${input.orderId}`,
      active: true,
      reason: "",
    },
    {
      id: "pick",
      label: "Picking",
      href: `/warehouse/pick/${input.orderId}`,
      active: pickOn,
      reason: pickOn ? "" : "Approve the sales order before picking.",
    },
    {
      id: "pack",
      label: "Packing",
      href: `/warehouse/pack/${input.orderId}`,
      active: packOn,
      reason: packOn ? "" : "Finish the pick before packing.",
    },
    {
      id: "ship",
      label: "Shipping",
      href: shipHref,
      active: shipOn,
      reason: shipOn ? "" : "Finish packing before shipping.",
    },
  ];

  const stages: SalesOrderStage[] = [];
  for (const seed of seeds) {
    if (seed.id === "ship" && !shipHref) continue;
    const current = seed.id === input.current;
    const active = seed.active && Boolean(seed.href);
    stages.push({
      id: seed.id,
      label: seed.label,
      href: active && !current ? seed.href : null,
      active,
      current,
      reason: active ? "" : seed.reason,
    });
  }

  const index = stages.findIndex((stage) => stage.current);
  const previous = index < 0 ? null : [...stages.slice(0, index)].reverse().find((stage) => stage.active && stage.href) ?? null;
  const next = index < 0 ? null : stages.slice(index + 1).find((stage) => stage.active && stage.href) ?? null;
  return { stages, previous, next };
}

/** True when that stage can be opened for this order. The page you are on does not count by itself. */
export function salesOrderStageActive(input: SalesOrderStageInput, stage: SalesOrderStageId): boolean {
  return salesOrderStageNav({ ...input, current: "order" }).stages.find((row) => row.id === stage)?.active === true;
}
