import type { SupabaseClient } from "@supabase/supabase-js";
import { readEbayDraftDefaults } from "@/lib/ebayOrderDefaults";
import { apiBase, apizBase, financesTransactionsUrl, ordersByIdsUrl, ordersUrl, shippingFulfillmentsUrl, type EbayEnvironment } from "@/lib/ebay/endpoints";
import {
  EBAY_CANCEL_NOTE,
  EBAY_CANCELLABLE_STATUSES,
  EBAY_ORDER_ID_BATCH,
  ebayCancelDecision,
} from "@/lib/ebay/cancellations";
import {
  ebayOrderShipDate,
  ebayStatusAfterShipments,
  EBAY_SHIPPABLE_STATUSES,
  orderNeedsShippingFulfillment,
  parseShippingFulfillments,
  planEbayShipmentWrites,
  trackingKey,
  type ParsedEbayShipment,
  type StoredShipment,
} from "@/lib/ebay/fulfillments";
import { ebayRead } from "@/lib/ebay/http";
import { writeEbayLog } from "@/lib/ebay/log";
import {
  addLabelFees,
  applyLabelFees,
  draftLines,
  EBAY_SHIPPING_ITEM_SKU,
  draftOrderRow,
  ebaySoReferenceAssignment,
  EBAY_ORDER_CUSTOMER_NAME,
  EBAY_ORDER_CUSTOMER_QBO_ID,
  EBAY_PULL_OPERATOR_LABEL,
  labelFeeFilter,
  isEbayOrderId,
  ORDER_PAGE_LIMIT,
  ORDER_PAGE_SIZE,
  orderPullWindows,
  pageNext,
  parseFulfillmentOrders,
  parseStoredPullDraft,
  positiveLabelFees,
  parseLegacyLogCsv,
  planLegacySeed,
  planOrderPull,
  rawOrderCount,
  rawTransactionCount,
  SEED_REQUIRED_MESSAGE,
  type ExistingPullOrder,
  type ExistingSeedOrder,
  type LegacyMapEntry,
  type LegacySoNumber,
  type PullAction,
  type SeedDraft,
  type SeedPlan,
  type SoNumberAssignment,
} from "@/lib/ebay/orderMap";
import { parsePackLabel } from "@/lib/ebay/packs";
import { forceRefreshAccessToken, validAccessToken } from "@/lib/ebay/oauth";
import { escapeLike } from "@/lib/labelLookup";
import { getServiceSupabase } from "@/lib/supabaseAdmin";
import { errorText } from "@/lib/errors";

const MIGRATION = "Apply supabase/migrations/20261025020829_ebay_order_pull.sql before pulling eBay orders.";
const MAP_MIGRATION = "Apply supabase/migrations/20261025073000_ebay_legacy_so_match.sql before assigning legacy SO numbers.";
/** First successful pull that stored this revision rewrote unedited drafts with discount, shipping, and label fees. */
const ORDER_PRICE_REVISION = "discount-shipping-v1";

export function watermarkForPriceRevision(watermark: string | null, revisionApplied: boolean): string | null {
  return revisionApplied ? watermark : null;
}

export class SeedRequiredError extends Error {
  constructor() {
    super(SEED_REQUIRED_MESSAGE);
    this.name = "SeedRequiredError";
  }
}

export type OrderPullResult = {
  created: number;
  updated: number;
  linked: number;
  skipped: number;
  fetchedAt: string;
  history: boolean;
  /** Orders with a shipping-label debit. Null when the finances read did not finish. */
  labels: number | null;
  /** New so_shipments rows written from eBay tracking. */
  shipments: number;
  /** Sales orders whose status moved to shipped. */
  shipped: number;
  /** Tracking was stored, and a kit component blocked the status change. */
  shippedHeld: number;
  /** Open sales orders cancelled because eBay cancelled the order. */
  cancelled: number;
  /** eBay cancelled the order, and the sales order was already shipped or invoiced. */
  cancelSkipped: number;
};

export type OrderPullSummary = {
  available: boolean;
  seeded: boolean;
  seededAt: string | null;
  linked: number | null;
  assigned: number | null;
  watermark: string | null;
};

type SeedState = {
  missingTable: boolean;
  seeded: boolean;
  watermark: string | null;
};

type OrderStore = {
  existing(orderIds: string[], salesRefs: string[]): Promise<ExistingPullOrder[]>;
  itemsForSkus(skus: string[]): Promise<{ id: string; sku: string }[]>;
  legacySoNumbers?(orderIds: string[]): Promise<LegacySoNumber[]>;
  apply(
    actions: PullAction[],
    customer: { id: string },
  ): Promise<{ created: number; updated: number; linked: number; cancelled: number; cancelSkipped: number }>;
  /** Open eBay sales orders, so a cancel outside the modified window is still seen. */
  listOpenEbayOrders?: () => Promise<{ id: string; ebayOrderId: string; status: string }[]>;
  syncLabelFees?(fees: ReadonlyMap<string, number>): Promise<void>;
  syncShipments?(
    groups: readonly { ebayOrderId: string; fulfillments: ParsedEbayShipment[] }[],
    pulledAt: string,
  ): Promise<{ shipments: number; shipped: number; shippedHeld: number }>;
  setWatermark(iso: string): Promise<void>;
};

export function allowOrdersNext(url: string, environment: EbayEnvironment): boolean {
  try {
    const parsed = new URL(url);
    const base = new URL(apiBase(environment));
    return parsed.origin === base.origin && parsed.pathname === "/sell/fulfillment/v1/order";
  } catch {
    return false;
  }
}

export function allowFinancesNext(url: string, environment: EbayEnvironment): boolean {
  try {
    const parsed = new URL(url);
    const base = new URL(apizBase(environment));
    return parsed.origin === base.origin && parsed.pathname === "/sell/finances/v1/transaction";
  } catch {
    return false;
  }
}

function tableMissing(error: { code?: string; message?: string } | null, table: string): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "PGRST205" || code === "42P01") return true;
  return new RegExp(table, "i").test(message) && /schema cache|does not exist|could not find/i.test(message);
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function personEdited(events: readonly { operator_id: string | null; operator_label: string | null }[]): boolean {
  return events.some(
    (event) => event.operator_id != null || (event.operator_label != null && event.operator_label !== EBAY_PULL_OPERATOR_LABEL),
  );
}

async function insertEvent(
  admin: SupabaseClient,
  salesOrderId: string,
  event: string,
  fromStatus: string | null,
  toStatus: string | null,
  note?: string | null,
): Promise<void> {
  const { error } = await admin.from("so_events").insert({
    sales_order_id: salesOrderId,
    event,
    from_status: fromStatus,
    to_status: toStatus,
    note: note ?? null,
    operator_id: null,
    operator_label: EBAY_PULL_OPERATOR_LABEL,
  });
  if (error) throw new Error("The sales-order history could not be saved.");
}

async function insertLines(admin: SupabaseClient, salesOrderId: string, action: Extract<PullAction, { kind: "create" | "update" }>): Promise<void> {
  const lines = draftLines(action.order, action.itemIds, action.shippingItemId, action.allocationQtys);
  if (lines.some((line) => line.line_kind === "freight" && !line.item_id)) {
    throw new Error("eBay shipping could not be allocated to item 4343.");
  }
  for (const line of lines) {
    const { data, error } = await admin
      .from("so_lines")
      .insert({
        sales_order_id: salesOrderId,
        line_no: line.line_no,
        line_kind: line.line_kind,
        customer_part_number: line.customer_part_number,
        customer_description: line.customer_description,
        qty: line.qty,
        unit_price: line.unit_price,
        ext_price: line.ext_price,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error("A sales-order line could not be saved.");
    if (!line.item_id) continue;
    const allocation = await admin.from("so_line_allocations").insert({
      so_line_id: data.id,
      item_id: line.item_id,
      qty: line.allocation_qty ?? line.qty,
      operator_id: null,
    });
    if (allocation.error) throw new Error("A sales-order line could not be matched to an item.");
  }
}

export async function runOrderPull(input: {
  now: Date;
  watermark: string | null;
  customer: { id: string };
  fetchPage: (url: string) => Promise<{ body: unknown; rlogid: string | null; requestId: string | null }>;
  pageUrl: (filter: string, offset: number) => string;
  allowNext: (url: string) => boolean;
  loadLabelFees?: () => Promise<Map<string, number> | null>;
  fetchFulfillments?: (orderId: string) => Promise<unknown>;
  /** getOrders by id, for open sales orders the modified window did not return. */
  fetchOrdersByIds?: (orderIds: string[]) => Promise<{ body: unknown; rlogid: string | null; requestId: string | null }>;
  store: OrderStore;
}): Promise<OrderPullResult & { rlogid: string | null; requestId: string | null }> {
  let labelFees: Map<string, number> | null = null;
  if (input.loadLabelFees) {
    try {
      labelFees = await input.loadLabelFees();
    } catch {
      labelFees = null;
    }
  }
  const windows = orderPullWindows(input.now, input.watermark);
  let created = 0;
  let updated = 0;
  let linked = 0;
  let skipped = 0;
  let shipments = 0;
  let shipped = 0;
  let shippedHeld = 0;
  let cancelled = 0;
  let cancelSkipped = 0;
  let truncated = false;
  let rlogid: string | null = null;
  let requestId: string | null = null;
  const seenOrderIds = new Set<string>();

  for (const window of windows) {
    const seen = new Map<string, ReturnType<typeof parseFulfillmentOrders>[number]>();
    let url = input.pageUrl(window.filter, 0);
    let offset = 0;
    for (let page = 0; page < ORDER_PAGE_LIMIT; page += 1) {
      const result = await input.fetchPage(url);
      rlogid = result.rlogid ?? rlogid;
      requestId = result.requestId ?? requestId;
      for (const order of parseFulfillmentOrders(result.body)) seen.set(order.ebayOrderId, order);
      const next = pageNext(result.body);
      const full = rawOrderCount(result.body) >= ORDER_PAGE_SIZE;
      if (next && input.allowNext(next)) {
        url = next;
        if (page === ORDER_PAGE_LIMIT - 1) truncated = true;
        continue;
      }
      if (!full) break;
      if (page === ORDER_PAGE_LIMIT - 1) {
        truncated = true;
        break;
      }
      offset += ORDER_PAGE_SIZE;
      url = input.pageUrl(window.filter, offset);
    }
    const orders = [...seen.values()];
    for (const order of orders) seenOrderIds.add(order.ebayOrderId);
    if (labelFees) applyLabelFees(orders, labelFees);
    if (orders.length === 0) continue;
    const existing = await input.store.existing(
      orders.map((order) => order.ebayOrderId),
      orders.flatMap((order) => (order.salesRecordRef ? [order.salesRecordRef] : [])),
    );
    const skus = orders.flatMap((order) => order.lines.flatMap((line) => (line.sku ? [line.sku] : [])));
    const bases = skus.flatMap((sku) => {
      const pack = parsePackLabel(sku);
      return pack ? [pack.baseSku] : [];
    });
    const items = await input.store.itemsForSkus([...skus, ...bases, EBAY_SHIPPING_ITEM_SKU]);
    const legacy = input.store.legacySoNumbers ? await input.store.legacySoNumbers(orders.map((order) => order.ebayOrderId)) : [];
    const actions = planOrderPull(orders, existing, items, legacy);
    const applied = await input.store.apply(actions, input.customer);
    created += applied.created;
    updated += applied.updated;
    linked += applied.linked;
    cancelled += applied.cancelled ?? 0;
    cancelSkipped += applied.cancelSkipped ?? 0;
    skipped += actions.filter((action) => action.kind === "skip").length;
    cancelSkipped += actions.filter((action) => action.kind === "skip" && action.reason === "shipped").length;
    if (input.fetchFulfillments && input.store.syncShipments) {
      const synced = await input.store.syncShipments(await loadShipmentGroups(orders, input.fetchFulfillments), input.now.toISOString());
      shipments += synced.shipments;
      shipped += synced.shipped;
      shippedHeld += synced.shippedHeld;
    }
  }

  if (truncated) {
    throw new Error("eBay returned more orders than this pull reads. The next pull starts again and does not create a second draft for an order already saved.");
  }
  if (labelFees && input.store.syncLabelFees) {
    await input.store.syncLabelFees(labelFees);
  }
  if (input.fetchOrdersByIds && input.store.listOpenEbayOrders) {
    const rechecked = await recheckOpenEbayCancels({
      seen: seenOrderIds,
      customer: input.customer,
      fetchOrdersByIds: input.fetchOrdersByIds,
      listOpenEbayOrders: input.store.listOpenEbayOrders.bind(input.store),
      apply: input.store.apply.bind(input.store),
    });
    cancelled += rechecked.cancelled;
    cancelSkipped += rechecked.cancelSkipped;
    rlogid = rechecked.rlogid ?? rlogid;
    requestId = rechecked.requestId ?? requestId;
  }
  await input.store.setWatermark(input.now.toISOString());
  return {
    created,
    updated,
    linked,
    skipped,
    fetchedAt: input.now.toISOString(),
    history: windows.some((window) => window.history),
    labels: labelFees ? positiveLabelFees(labelFees).size : null,
    shipments,
    shipped,
    shippedHeld,
    cancelled,
    cancelSkipped,
    rlogid,
    requestId,
  };
}

/**
 * Same status change as cancel_sales_order: the order becomes cancelled and
 * an so_events row is appended. That function refuses only cancelled and
 * closed, and it requires two-letter initials, so it cannot label the row
 * "eBay" or store a note. Shipped, partially shipped, and invoiced orders
 * are left as they are. The function would cancel those too.
 */
export async function cancelMatchingEbayOrder(
  admin: SupabaseClient,
  id: string,
): Promise<"cancelled" | "skipped" | "left"> {
  const row = await admin.from("sales_orders").select("status").eq("id", id).maybeSingle();
  if (row.error) throw new Error(errorText(row.error));
  if (!row.data) return "left";
  const status = String(row.data.status ?? "");
  const decision = ebayCancelDecision(status);
  if (decision === "skip-shipped") return "skipped";
  if (decision !== "cancel") return "left";
  const updated = await admin
    .from("sales_orders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", [...EBAY_CANCELLABLE_STATUSES])
    .select("id");
  if (updated.error) throw new Error("A sales order could not be cancelled.");
  if (!updated.data?.length) return "left";
  await insertEvent(admin, id, "cancelled", status, "cancelled", EBAY_CANCEL_NOTE);
  return "cancelled";
}

async function recheckOpenEbayCancels(input: {
  seen: ReadonlySet<string>;
  customer: { id: string };
  fetchOrdersByIds: (orderIds: string[]) => Promise<{ body: unknown; rlogid: string | null; requestId: string | null }>;
  listOpenEbayOrders: () => Promise<{ id: string; ebayOrderId: string; status: string }[]>;
  apply: OrderStore["apply"];
}): Promise<{ cancelled: number; cancelSkipped: number; rlogid: string | null; requestId: string | null }> {
  const open = await input.listOpenEbayOrders();
  const pending = new Map<string, { id: string; ebayOrderId: string; status: string }>();
  for (const row of open) {
    const ebayOrderId = row.ebayOrderId.trim();
    if (!isEbayOrderId(ebayOrderId) || input.seen.has(ebayOrderId) || pending.has(ebayOrderId)) continue;
    pending.set(ebayOrderId, { id: row.id, ebayOrderId, status: row.status });
  }
  let rlogid: string | null = null;
  let requestId: string | null = null;
  const parsed: ReturnType<typeof parseFulfillmentOrders> = [];
  await mapPool(chunks([...pending.keys()], EBAY_ORDER_ID_BATCH), 4, async (chunk) => {
    const result = await input.fetchOrdersByIds(chunk);
    rlogid = result.rlogid ?? rlogid;
    requestId = result.requestId ?? requestId;
    for (const order of parseFulfillmentOrders(result.body)) {
      if (order.cancelled) parsed.push(order);
    }
  });
  if (parsed.length === 0) return { cancelled: 0, cancelSkipped: 0, rlogid, requestId };
  const existing: ExistingPullOrder[] = [];
  for (const order of parsed) {
    const row = pending.get(order.ebayOrderId);
    if (!row) continue;
    existing.push({
      id: row.id,
      status: row.status,
      ebayOrderId: row.ebayOrderId,
      ebaySalesRecordRef: order.salesRecordRef,
      personEdited: true,
    });
  }
  const actions = planOrderPull(parsed, existing, []).filter((action) => action.kind === "cancel" || (action.kind === "skip" && action.reason === "shipped"));
  if (!actions.some((action) => action.kind === "cancel")) {
    return {
      cancelled: 0,
      cancelSkipped: actions.filter((action) => action.kind === "skip" && action.reason === "shipped").length,
      rlogid,
      requestId,
    };
  }
  const applied = await input.apply(actions, input.customer);
  return {
    cancelled: applied.cancelled ?? 0,
    cancelSkipped: (applied.cancelSkipped ?? 0) + actions.filter((action) => action.kind === "skip" && action.reason === "shipped").length,
    rlogid,
    requestId,
  };
}

async function mapPool<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await run(items[index]);
    }
  });
  await Promise.all(workers);
}

async function loadShipmentGroups(
  orders: readonly { ebayOrderId: string; fulfillmentStatus?: string | null; hasFulfillmentHrefs?: boolean; lineItemShipped?: boolean }[],
  fetchFulfillments: (orderId: string) => Promise<unknown>,
): Promise<{ ebayOrderId: string; fulfillments: ParsedEbayShipment[] }[]> {
  const byId = new Map<string, ParsedEbayShipment[]>();
  await mapPool(
    orders.filter(orderNeedsShippingFulfillment),
    4,
    async (order) => {
      byId.set(order.ebayOrderId, parseShippingFulfillments(await fetchFulfillments(order.ebayOrderId)));
    },
  );
  return orders.map((order) => ({
    ebayOrderId: order.ebayOrderId,
    fulfillments: byId.get(order.ebayOrderId) ?? [],
  }));
}

function datePrefix(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

function shipmentNote(fulfillments: readonly ParsedEbayShipment[]): string {
  const tracked = fulfillments.filter((row) => trackingKey(row.trackingNumber) !== "");
  const first = tracked[0];
  if (!first) return "Tracking pulled from eBay.";
  const carrier = first.carrier ? `${first.carrier} ` : "";
  const extra = tracked.length > 1 ? ` and ${tracked.length - 1} more` : "";
  return `Tracking pulled from eBay: ${carrier}${first.trackingNumber}${extra}`.slice(0, 300);
}

/** A refresh keeps payment terms and Incoterms that are already set. */
async function fillBlankEbayTerms(
  admin: SupabaseClient,
  id: string,
  paymentTerms: string,
  incoterms: string,
): Promise<void> {
  const now = new Date().toISOString();
  const terms = await admin
    .from("sales_orders")
    .update({ terms: paymentTerms, updated_at: now })
    .eq("id", id)
    .eq("status", "draft")
    .is("terms", null);
  if (terms.error) throw new Error("A draft sales order could not be updated.");
  const trade = await admin
    .from("sales_orders")
    .update({ incoterms, updated_at: now })
    .eq("id", id)
    .eq("status", "draft")
    .is("incoterms", null);
  if (trade.error) throw new Error("A draft sales order could not be updated.");
}

function supabaseStore(
  admin: SupabaseClient,
  defaults: { salesRep: string; paymentTerms: string; incoterms: string },
): OrderStore {
  return {
    async existing(orderIds, salesRefs) {
      const rows = new Map<string, Record<string, unknown>>();
      for (const [column, values] of [
        ["ebay_order_id", orderIds],
        ["ebay_sales_record_ref", salesRefs],
      ] as const) {
        for (const chunk of chunks([...new Set(values)], 100)) {
          if (chunk.length === 0) continue;
          const { data, error } = await admin
            .from("sales_orders")
            .select(
              "id, status, so_number, ebay_order_id, ebay_sales_record_ref, order_date, ship_to, bill_to, buyer, payment_status, payment_method, payment_date, ebay_transaction_fee, ebay_order_earnings, currency, terms, incoterms",
            )
            .in(column, chunk);
          if (error) throw new Error(errorText(error));
          for (const row of data ?? []) rows.set(String(row.id), row);
        }
      }
      const ids = [...rows.keys()];
      const events = new Map<string, { operator_id: string | null; operator_label: string | null }[]>();
      for (const chunk of chunks(ids, 100)) {
        if (chunk.length === 0) continue;
        const { data, error } = await admin
          .from("so_events")
          .select("sales_order_id, operator_id, operator_label")
          .in("sales_order_id", chunk);
        if (error) throw new Error(errorText(error));
        for (const event of data ?? []) {
          const key = String(event.sales_order_id);
          const list = events.get(key) ?? [];
          list.push({
            operator_id: event.operator_id == null ? null : String(event.operator_id),
            operator_label: event.operator_label == null ? null : String(event.operator_label),
          });
          events.set(key, list);
        }
      }
      const refreshIds = [...rows.entries()]
        .filter(([id, row]) => String(row.status ?? "") === "draft" && !personEdited(events.get(id) ?? []))
        .map(([id]) => id);
      const linesByOrder = new Map<string, Record<string, unknown>[]>();
      for (const id of refreshIds) linesByOrder.set(id, []);
      const lineRows: Record<string, unknown>[] = [];
      for (const chunk of chunks(refreshIds, 100)) {
        if (chunk.length === 0) continue;
        const { data, error } = await admin
          .from("so_lines")
          .select("id, sales_order_id, line_no, line_kind, customer_part_number, customer_description, qty, unit_price, ext_price")
          .in("sales_order_id", chunk);
        if (error) throw new Error(errorText(error));
        for (const line of data ?? []) {
          lineRows.push(line);
          const key = String(line.sales_order_id);
          const list = linesByOrder.get(key) ?? [];
          list.push(line);
          linesByOrder.set(key, list);
        }
      }
      const allocationsByLine = new Map<string, { item_id: string; qty: unknown }[]>();
      for (const chunk of chunks(
        lineRows.map((line) => String(line.id)),
        100,
      )) {
        if (chunk.length === 0) continue;
        const { data, error } = await admin.from("so_line_allocations").select("so_line_id, item_id, qty").in("so_line_id", chunk);
        if (error) throw new Error(errorText(error));
        for (const allocation of data ?? []) {
          const key = String(allocation.so_line_id);
          const list = allocationsByLine.get(key) ?? [];
          list.push({ item_id: String(allocation.item_id ?? ""), qty: allocation.qty });
          allocationsByLine.set(key, list);
        }
      }
      return [...rows.entries()].map(([id, row]) => {
        const edited = personEdited(events.get(id) ?? []);
        const lines = linesByOrder.get(id);
        const stored =
          lines == null
            ? undefined
            : (parseStoredPullDraft({
                orderDate: row.order_date,
                shipTo: row.ship_to,
                billTo: row.bill_to,
                buyer: row.buyer,
                paymentStatus: row.payment_status,
                paymentMethod: row.payment_method,
                paymentDate: row.payment_date,
                transactionFee: row.ebay_transaction_fee,
                earnings: row.ebay_order_earnings,
                currency: row.currency,
                terms: row.terms,
                incoterms: row.incoterms,
                lines: lines.map((line) => {
                  const allocations = allocationsByLine.get(String(line.id)) ?? [];
                  const only = allocations.length === 1 ? allocations[0] : null;
                  return {
                    line_no: line.line_no,
                    line_kind: line.line_kind,
                    customer_part_number: line.customer_part_number,
                    customer_description: line.customer_description,
                    qty: line.qty,
                    unit_price: line.unit_price,
                    ext_price: line.ext_price,
                    item_id: only?.item_id ?? null,
                    allocation_qty: only?.qty ?? null,
                    allocation_count: allocations.length,
                  };
                }),
              }) ?? undefined);
        const soNumber = row.so_number == null || row.so_number === "" ? null : Number(row.so_number);
        return {
          id,
          status: String(row.status ?? ""),
          ebayOrderId: row.ebay_order_id == null ? null : String(row.ebay_order_id),
          ebaySalesRecordRef: row.ebay_sales_record_ref == null ? null : String(row.ebay_sales_record_ref),
          soNumber: soNumber != null && Number.isFinite(soNumber) ? soNumber : null,
          personEdited: edited,
          ...(stored ? { stored } : {}),
        };
      });
    },
    async itemsForSkus(skus) {
      const wanted = [...new Set(skus.map((sku) => sku.trim()).filter((sku) => sku.length > 0))];
      const found: { id: string; sku: string }[] = [];
      for (const chunk of chunks(wanted, 100)) {
        const exact = await admin.from("items").select("id, sku").in("sku", chunk);
        if (exact.error) throw new Error(errorText(exact.error));
        for (const row of exact.data ?? []) found.push({ id: String(row.id), sku: String(row.sku ?? "") });
      }
      const have = new Set(found.map((row) => row.sku));
      for (const chunk of chunks(wanted.filter((sku) => !have.has(sku)), 40)) {
        const filter = chunk.map((sku) => `sku.ilike."${escapeLike(sku).replace(/"/g, '""')}"`).join(",");
        const loose = await admin.from("items").select("id, sku").or(filter);
        if (loose.error) throw new Error(errorText(loose.error));
        for (const row of loose.data ?? []) found.push({ id: String(row.id), sku: String(row.sku ?? "") });
      }
      return found;
    },
    async legacySoNumbers(orderIds) {
      const wanted = [...new Set(orderIds.filter(Boolean))];
      const rows: LegacySoNumber[] = [];
      for (const chunk of chunks(wanted, 100)) {
        if (chunk.length === 0) continue;
        const { data, error } = await admin.from("ebay_legacy_order_map").select("ebay_order_id, so_number").in("ebay_order_id", chunk);
        if (error) {
          if (tableMissing(error, "ebay_legacy_order_map")) return [];
          throw new Error(errorText(error));
        }
        for (const row of data ?? []) {
          const soNumber = typeof row.so_number === "number" ? row.so_number : Number(row.so_number);
          const ebayOrderId = row.ebay_order_id == null ? "" : String(row.ebay_order_id);
          if (ebayOrderId && Number.isSafeInteger(soNumber) && soNumber >= 1) rows.push({ ebayOrderId, soNumber });
        }
      }
      const numbers = [...new Set(rows.map((row) => row.soNumber))];
      const taken = new Set<number>();
      for (const chunk of chunks(numbers, 100)) {
        if (chunk.length === 0) continue;
        const { data, error } = await admin.from("sales_orders").select("so_number").in("so_number", chunk);
        if (error) throw new Error(errorText(error));
        for (const row of data ?? []) {
          const soNumber = typeof row.so_number === "number" ? row.so_number : Number(row.so_number);
          if (Number.isSafeInteger(soNumber)) taken.add(soNumber);
        }
      }
      return rows.filter((row) => !taken.has(row.soNumber));
    },
    async apply(actions, customer) {
      let created = 0;
      let updated = 0;
      let linked = 0;
      let cancelled = 0;
      let cancelSkipped = 0;
      const countCancel = async (id: string) => {
        const result = await cancelMatchingEbayOrder(admin, id);
        if (result === "cancelled") cancelled += 1;
        else if (result === "skipped") cancelSkipped += 1;
      };
      for (const action of actions) {
        if (action.kind === "skip") continue;
        if (action.kind === "cancel") {
          if (action.link) await linkOrder(admin, action.id, action.ebayOrderId, action.salesRecordRef);
          await countCancel(action.id);
          continue;
        }
        if (action.kind === "link") {
          await linkOrder(admin, action.id, action.ebayOrderId, action.salesRecordRef);
          linked += 1;
          continue;
        }
        if (action.order.shippingAmount != null && action.order.shippingAmount > 0 && !action.shippingItemId) {
          throw new Error("eBay shipping could not be allocated to item 4343.");
        }
        const afterCreate = async (id: string) => {
          if (action.order.cancelled) await countCancel(id);
        };
        if (action.kind === "update") {
          const patch = draftOrderRow({
            order: action.order,
            customerId: customer.id,
            soNumber: action.soNumber,
            salesRep: defaults.salesRep,
            paymentTerms: defaults.paymentTerms,
            incoterms: defaults.incoterms,
          });
          const updatedRow = await admin
            .from("sales_orders")
            .update({
              order_date: patch.order_date,
              ship_to: patch.ship_to,
              bill_to: null,
              buyer: patch.buyer,
              ebay_order_id: patch.ebay_order_id,
              ebay_sales_record_ref: patch.ebay_sales_record_ref,
              payment_status: patch.payment_status,
              payment_method: patch.payment_method,
              payment_date: patch.payment_date,
              ebay_transaction_fee: patch.ebay_transaction_fee,
              ebay_order_earnings: patch.ebay_order_earnings,
              ...(action.order.labelFee !== undefined ? { ebay_label_fee: action.order.labelFee } : {}),
              currency: patch.currency,
              updated_at: new Date().toISOString(),
            })
            .eq("id", action.id)
            .eq("status", "draft")
            .select("id");
          if (updatedRow.error) throw new Error("A draft sales order could not be updated.");
          if (!updatedRow.data || updatedRow.data.length === 0) {
            await linkOrder(admin, action.id, action.order.ebayOrderId, action.order.salesRecordRef);
            linked += 1;
            continue;
          }
          await fillBlankEbayTerms(admin, action.id, defaults.paymentTerms, defaults.incoterms);
          let approvedNow = false;
          if (action.soNumber != null) {
            const now = new Date().toISOString();
            const numbered = await admin
              .from("sales_orders")
              .update({
                ...ebaySoReferenceAssignment(action.soNumber, now),
                updated_at: now,
              })
              .eq("id", action.id)
              .eq("status", "draft")
              .is("so_number", null)
              .select("id");
            if (numbered.error && numbered.error.code !== "23505") throw new Error("A legacy SO number could not be saved.");
            approvedNow = !numbered.error && (numbered.data?.length ?? 0) > 0;
          }
          const removed = await admin.from("so_lines").delete().eq("sales_order_id", action.id);
          if (removed.error) throw new Error("A draft sales order could not be updated.");
          await insertLines(admin, action.id, action);
          await insertEvent(admin, action.id, "updated", "draft", approvedNow ? "approved" : "draft");
          if (approvedNow && action.soNumber != null) {
            await insertEvent(admin, action.id, "approved", "draft", "approved", `SO${action.soNumber}`);
          }
          updated += 1;
          continue;
        }
        const createdRow = draftOrderRow({
          order: action.order,
          customerId: customer.id,
          soNumber: action.soNumber,
          salesRep: defaults.salesRep,
          paymentTerms: defaults.paymentTerms,
          incoterms: defaults.incoterms,
        });
        const inserted = await admin
          .from("sales_orders")
          .insert(createdRow)
          .select("id")
          .single();
        if (inserted.error?.code === "23505" && action.soNumber != null && /so_number|number_unique/i.test(inserted.error.message ?? "")) {
          const retry = await admin
            .from("sales_orders")
            .insert(
              draftOrderRow({
                order: action.order,
                customerId: customer.id,
                salesRep: defaults.salesRep,
                paymentTerms: defaults.paymentTerms,
                incoterms: defaults.incoterms,
              }),
            )
            .select("id")
            .single();
          if (!retry.error && retry.data) {
            const id = String(retry.data.id);
            await insertLines(admin, id, action);
            await insertEvent(admin, id, "created", null, "draft");
            created += 1;
            await afterCreate(id);
            continue;
          }
        }
        if (inserted.error?.code === "23505") {
          const found = await admin
            .from("sales_orders")
            .select("id")
            .eq("ebay_order_id", action.order.ebayOrderId)
            .maybeSingle();
          if (found.data?.id) {
            const id = String(found.data.id);
            await linkOrder(admin, id, action.order.ebayOrderId, action.order.salesRecordRef);
            linked += 1;
            await afterCreate(id);
            continue;
          }
        }
        if (inserted.error || !inserted.data) throw new Error("A draft sales order could not be created.");
        const id = String(inserted.data.id);
        await insertLines(admin, id, action);
        const createdStatus = String(createdRow.status);
        await insertEvent(admin, id, "created", null, createdStatus);
        if (createdStatus === "approved" && action.soNumber != null) {
          await insertEvent(admin, id, "approved", "draft", "approved", `SO${action.soNumber}`);
        }
        created += 1;
        await afterCreate(id);
      }
      return { created, updated, linked, cancelled, cancelSkipped };
    },
    async syncLabelFees(fees) {
      const ids = [...fees.keys()];
      for (const chunk of chunks(ids, 100)) {
        if (chunk.length === 0) continue;
        const { data, error } = await admin.from("sales_orders").select("id, ebay_order_id, ebay_label_fee").in("ebay_order_id", chunk);
        if (error) throw new Error(errorText(error));
        for (const row of data ?? []) {
          const orderId = row.ebay_order_id == null ? "" : String(row.ebay_order_id);
          const next = fees.get(orderId) ?? 0;
          const amount = next > 0 ? Math.round(next * 100) / 100 : null;
          const current = row.ebay_label_fee == null || row.ebay_label_fee === "" ? null : Number(row.ebay_label_fee);
          const same = amount == null ? current == null : current != null && Math.abs(current - amount) < 0.001;
          if (same) continue;
          const updated = await admin
            .from("sales_orders")
            .update({ ebay_label_fee: amount, updated_at: new Date().toISOString() })
            .eq("id", row.id);
          if (updated.error) throw new Error("A shipping label fee could not be saved.");
        }
      }
    },
    async syncShipments(groups, pulledAt) {
      return syncEbayShipments(admin, groups, pulledAt);
    },
    async listOpenEbayOrders() {
      const rows: { id: string; ebayOrderId: string; status: string }[] = [];
      const pageSize = 1000;
      for (let from = 0; from < 20000; from += pageSize) {
        const { data, error } = await admin
          .from("sales_orders")
          .select("id, status, ebay_order_id")
          .not("ebay_order_id", "is", null)
          .in("status", [...EBAY_CANCELLABLE_STATUSES])
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw new Error(errorText(error));
        const batch = data ?? [];
        for (const row of batch) {
          const ebayOrderId = row.ebay_order_id == null ? "" : String(row.ebay_order_id).trim();
          if (!ebayOrderId) continue;
          rows.push({ id: String(row.id), ebayOrderId, status: String(row.status ?? "") });
        }
        if (batch.length < pageSize) break;
        if (from + pageSize >= 20000) {
          throw new Error("Too many open eBay orders to recheck in one pull.");
        }
      }
      return rows;
    },
    async setWatermark(iso) {
      const { error } = await admin.from("ebay_order_seed").update({ orders_watermark: iso }).eq("id", 1);
      if (error) throw new Error(errorText(error));
    },
  };
}

async function syncEbayShipments(
  admin: SupabaseClient,
  groups: readonly { ebayOrderId: string; fulfillments: ParsedEbayShipment[] }[],
  pulledAt: string,
): Promise<{ shipments: number; shipped: number; shippedHeld: number }> {
  let shipments = 0;
  let shipped = 0;
  let shippedHeld = 0;
  for (const chunk of chunks(groups, 100)) {
    if (chunk.length === 0) continue;
    const ids = [...new Set(chunk.map((group) => group.ebayOrderId))];
    const { data, error } = await admin.from("sales_orders").select("id, status, ship_date, ebay_order_id").in("ebay_order_id", ids);
    if (error) throw new Error(errorText(error));
    const orders = new Map<string, { id: string; status: string; shipDate: string | null }>();
    for (const row of data ?? []) {
      const ebayOrderId = row.ebay_order_id == null ? "" : String(row.ebay_order_id);
      if (!ebayOrderId) continue;
      orders.set(ebayOrderId, {
        id: String(row.id),
        status: String(row.status ?? ""),
        shipDate: datePrefix(row.ship_date),
      });
    }
    const orderIds = [...orders.values()].map((order) => order.id);
    const stored = new Map<string, StoredShipment[]>();
    for (const id of orderIds) stored.set(id, []);
    for (const idChunk of chunks(orderIds, 100)) {
      if (idChunk.length === 0) continue;
      const rows = await admin.from("so_shipments").select("id, sales_order_id, awb, carrier, ship_date, ebay_tracking_pushed_at").in("sales_order_id", idChunk);
      if (rows.error) throw new Error(errorText(rows.error));
      for (const row of rows.data ?? []) {
        const salesOrderId = String(row.sales_order_id);
        const list = stored.get(salesOrderId) ?? [];
        list.push({
          id: String(row.id),
          awb: row.awb == null ? null : String(row.awb),
          carrier: row.carrier == null ? null : String(row.carrier),
          shipDate: datePrefix(row.ship_date),
          ebayTrackingPushedAt: row.ebay_tracking_pushed_at == null ? null : String(row.ebay_tracking_pushed_at),
        });
        stored.set(salesOrderId, list);
      }
    }
    for (const group of chunk) {
      const order = orders.get(group.ebayOrderId);
      if (!order) continue;
      const existing = stored.get(order.id) ?? [];
      const writes = planEbayShipmentWrites(existing, group.fulfillments, pulledAt);
      let inserted = 0;
      for (const write of writes) {
        if (write.kind === "insert") {
          const saved = await admin
            .from("so_shipments")
            .insert({
              sales_order_id: order.id,
              carrier: write.carrier,
              awb: write.trackingNumber,
              ship_date: write.shipDate,
              ebay_tracking_pushed_at: write.ebayTrackingPushedAt,
              operator_id: null,
              operator_label: EBAY_PULL_OPERATOR_LABEL,
            })
            .select("id")
            .single();
          if (saved.error?.code === "23505") continue;
          if (saved.error || !saved.data) throw new Error("eBay tracking could not be saved.");
          existing.push({
            id: String(saved.data.id),
            awb: write.trackingNumber,
            carrier: write.carrier,
            shipDate: write.shipDate,
            ebayTrackingPushedAt: write.ebayTrackingPushedAt,
          });
          inserted += 1;
          continue;
        }
        const patch: { carrier?: string; ship_date?: string; ebay_tracking_pushed_at?: string } = {};
        if (write.carrier) patch.carrier = write.carrier;
        if (write.shipDate) patch.ship_date = write.shipDate;
        if (write.ebayTrackingPushedAt) patch.ebay_tracking_pushed_at = write.ebayTrackingPushedAt;
        const saved = await admin.from("so_shipments").update(patch).eq("id", write.id);
        if (saved.error) throw new Error("eBay tracking could not be saved.");
        const row = existing.find((item) => item.id === write.id);
        if (row) {
          if (write.carrier) row.carrier = write.carrier;
          if (write.shipDate) row.shipDate = write.shipDate;
          if (write.ebayTrackingPushedAt) row.ebayTrackingPushedAt = write.ebayTrackingPushedAt;
        }
      }
      stored.set(order.id, existing);
      shipments += inserted;
      const wantedDate = ebayOrderShipDate(
        order.shipDate,
        [...existing.map((row) => row.shipDate), ...group.fulfillments.map((row) => row.shipDate)],
      );
      if (wantedDate) {
        const dated = await admin
          .from("sales_orders")
          .update({ ship_date: wantedDate, updated_at: new Date().toISOString() })
          .eq("id", order.id)
          .is("ship_date", null)
          .select("id");
        if (dated.error) throw new Error("A ship date could not be saved.");
        if ((dated.data?.length ?? 0) > 0) order.shipDate = wantedDate;
      }
      const hasTracking = existing.some((row) => row.awb != null && trackingKey(row.awb) !== "");
      const next = ebayStatusAfterShipments({ status: order.status, shipDate: order.shipDate, hasTracking });
      if (!next) {
        if (inserted > 0) await insertEvent(admin, order.id, "shipment", null, null, shipmentNote(group.fulfillments));
        continue;
      }
      const moved = await writeShippedStatus(admin, order.id, order.status, shipmentNote(group.fulfillments));
      if (moved === "shipped") {
        order.status = "shipped";
        shipped += 1;
      } else {
        if (moved === "held") shippedHeld += 1;
        if (inserted > 0) await insertEvent(admin, order.id, "shipment", null, null, shipmentNote(group.fulfillments));
      }
    }
  }
  return { shipments, shipped, shippedHeld };
}

async function writeShippedStatus(
  admin: SupabaseClient,
  id: string,
  fromStatus: string,
  note: string,
): Promise<"shipped" | "held" | "unchanged"> {
  const updated = await admin
    .from("sales_orders")
    .update({ status: "shipped", updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", [...EBAY_SHIPPABLE_STATUSES])
    .select("id");
  if (updated.error) {
    if (/physical part|generic component/i.test(updated.error.message ?? "")) return "held";
    throw new Error("A sales order could not be marked shipped.");
  }
  if (!updated.data?.length) return "unchanged";
  await insertEvent(admin, id, "shipped", fromStatus, "shipped", note);
  return "shipped";
}

/** A draft that already has a ship date and tracking must not stay approved after it receives an SO number. */
async function markEbayOrderShippedIfTracked(admin: SupabaseClient, id: string): Promise<boolean> {
  const order = await admin.from("sales_orders").select("status, ship_date").eq("id", id).maybeSingle();
  if (order.error) throw new Error(errorText(order.error));
  if (!order.data) return false;
  const shipments = await admin.from("so_shipments").select("awb").eq("sales_order_id", id);
  if (shipments.error) throw new Error(errorText(shipments.error));
  const hasTracking = (shipments.data ?? []).some((row) => row.awb != null && trackingKey(String(row.awb)) !== "");
  const status = String(order.data.status ?? "");
  const next = ebayStatusAfterShipments({ status, shipDate: datePrefix(order.data.ship_date), hasTracking });
  if (!next) return false;
  const moved = await writeShippedStatus(admin, id, status, "Tracking pulled from eBay.");
  return moved === "shipped";
}

const LABEL_PAGE_SIZE = 200;

export async function readShippingLabelFees(input: {
  now: Date;
  fetchPage: (url: string) => Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }>;
  pageUrl: (offset: number) => string;
  allowNext: (url: string) => boolean;
}): Promise<Map<string, number> | null> {
  const fees = new Map<string, number>();
  let url = input.pageUrl(0);
  let offset = 0;
  for (let page = 0; page < ORDER_PAGE_LIMIT; page += 1) {
    const result = await input.fetchPage(url);
    if (!result.ok) {
      if (result.status === 403) return null;
      throw new Error(result.message);
    }
    addLabelFees(fees, result.body);
    const next = pageNext(result.body);
    const full = rawTransactionCount(result.body) >= LABEL_PAGE_SIZE;
    if (next && input.allowNext(next)) {
      url = next;
      if (page === ORDER_PAGE_LIMIT - 1) {
        throw new Error("eBay returned more shipping labels than this pull reads. Order drafts were still saved. Pull orders again to finish the label fees.");
      }
      continue;
    }
    if (!full) return fees;
    if (page === ORDER_PAGE_LIMIT - 1) {
      throw new Error("eBay returned more shipping labels than this pull reads. Order drafts were still saved. Pull orders again to finish the label fees.");
    }
    offset += LABEL_PAGE_SIZE;
    url = input.pageUrl(offset);
  }
  return fees;
}

async function linkOrder(admin: SupabaseClient, id: string, ebayOrderId: string, salesRecordRef: string | null): Promise<void> {
  const now = new Date().toISOString();
  const order = await admin
    .from("sales_orders")
    .update({ ebay_order_id: ebayOrderId, updated_at: now })
    .eq("id", id)
    .is("ebay_order_id", null);
  if (order.error && order.error.code !== "23505") throw new Error("An existing sales order could not be linked.");
  if (salesRecordRef) {
    const record = await admin
      .from("sales_orders")
      .update({ ebay_sales_record_ref: salesRecordRef, updated_at: now })
      .eq("id", id)
      .is("ebay_sales_record_ref", null);
    if (record.error) throw new Error("An existing sales order could not be linked.");
  }
  const source = await admin
    .from("sales_orders")
    .update({ source_ref: ebayOrderId })
    .eq("id", id)
    .eq("source", "ebay")
    .is("source_ref", null);
  if (source.error && source.error.code !== "23505") throw new Error("An existing sales order could not be linked.");
  await insertEvent(admin, id, "linked", null, null);
}

async function priceRevisionApplied(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin
    .from("ebay_sync_log")
    .select("detail")
    .eq("entity", "orders")
    .eq("status", "ok")
    .order("created_at", { ascending: false })
    .limit(8);
  if (error || !data) return false;
  return data.some((row) => {
    const detail = row.detail;
    return Boolean(
      detail && typeof detail === "object" && (detail as { priceRevision?: unknown }).priceRevision === ORDER_PRICE_REVISION,
    );
  });
}

async function readSeed(admin: SupabaseClient): Promise<SeedState> {
  const { data, error } = await admin.from("ebay_order_seed").select("id, orders_watermark").eq("id", 1).maybeSingle();
  if (error) {
    if (tableMissing(error, "ebay_order_seed")) return { missingTable: true, seeded: false, watermark: null };
    throw new Error(errorText(error));
  }
  return {
    missingTable: false,
    seeded: Boolean(data),
    watermark: data && typeof data.orders_watermark === "string" ? data.orders_watermark : null,
  };
}

async function ebayCustomer(admin: SupabaseClient): Promise<{ id: string }> {
  const { data, error } = await admin
    .from("customers")
    .select("id")
    .eq("display_name", EBAY_ORDER_CUSTOMER_NAME)
    .eq("qbo_id", EBAY_ORDER_CUSTOMER_QBO_ID)
    .eq("active", true)
    .limit(2);
  if (error) throw new Error(errorText(error));
  if (!data || data.length !== 1) {
    throw new Error("The eBay Customer record was not found. No sales orders were created.");
  }
  return { id: String(data[0].id) };
}

function emptyOrderPullSummary(available: boolean): OrderPullSummary {
  return { available, seeded: false, seededAt: null, linked: null, assigned: null, watermark: null };
}

export async function orderPullSummary(): Promise<OrderPullSummary> {
  const admin = getServiceSupabase();
  if (!admin) return emptyOrderPullSummary(false);
  const selected = await admin
    .from("ebay_order_seed")
    .select("applied_at, linked, assigned, orders_watermark")
    .eq("id", 1)
    .maybeSingle();
  let data: {
    applied_at: string | null;
    linked: number | null;
    assigned: number | null;
    orders_watermark: string | null;
  } | null = selected.data;
  let error = selected.error;
  let assignedKnown = true;
  if (error && /assigned/i.test(error.message ?? "") && /schema cache|does not exist|could not find/i.test(error.message ?? "")) {
    assignedKnown = false;
    const fallback = await admin.from("ebay_order_seed").select("applied_at, linked, orders_watermark").eq("id", 1).maybeSingle();
    data = fallback.data ? { ...fallback.data, assigned: null } : null;
    error = fallback.error;
  }
  if (error) {
    if (tableMissing(error, "ebay_order_seed")) return emptyOrderPullSummary(false);
    throw new Error(errorText(error));
  }
  if (!data) return emptyOrderPullSummary(true);
  const assigned = !assignedKnown || data.assigned == null ? null : Number(data.assigned);
  return {
    available: true,
    seeded: true,
    seededAt: typeof data.applied_at === "string" ? data.applied_at : null,
    linked: typeof data.linked === "number" ? data.linked : Number(data.linked ?? 0),
    assigned: assigned != null && Number.isFinite(assigned) ? assigned : null,
    watermark: typeof data.orders_watermark === "string" ? data.orders_watermark : null,
  };
}

export function orderPullMessage(
  result: Pick<OrderPullResult, "created" | "updated" | "linked" | "labels"> &
    Partial<Pick<OrderPullResult, "shipments" | "shipped" | "shippedHeld" | "cancelled" | "cancelSkipped">>,
): string {
  const labels =
    result.labels == null
      ? "Shipping label fees were not read. Reconnect eBay, then pull orders again."
      : `Found shipping label fees for ${result.labels} ${result.labels === 1 ? "order" : "orders"}.`;
  const parts = [`Created ${result.created} draft sales orders. Updated ${result.updated}. Linked ${result.linked}. ${labels}`];
  if (result.shipments) parts.push(`Saved ${result.shipments} tracking ${result.shipments === 1 ? "number" : "numbers"}.`);
  if (result.shipped) parts.push(`Marked ${result.shipped} ${result.shipped === 1 ? "order" : "orders"} shipped.`);
  if (result.shippedHeld) {
    parts.push(
      `Left ${result.shippedHeld} ${result.shippedHeld === 1 ? "order" : "orders"} unchanged because a kit component is still generic.`,
    );
  }
  if (result.cancelled) {
    parts.push(`Cancelled ${result.cancelled} ${result.cancelled === 1 ? "order" : "orders"} that eBay cancelled.`);
  }
  if (result.cancelSkipped) {
    parts.push(
      `Left ${result.cancelSkipped} already shipped or invoiced ${result.cancelSkipped === 1 ? "order" : "orders"} unchanged.`,
    );
  }
  return parts.join(" ");
}

export async function pullEbayOrders(): Promise<OrderPullResult> {
  const admin = getServiceSupabase();
  if (!admin) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY on the server.");
  const seed = await readSeed(admin);
  if (seed.missingTable) throw new Error(MIGRATION);
  if (!seed.seeded) throw new SeedRequiredError();
  const customer = await ebayCustomer(admin);
  const ebayDefaults = await readEbayDraftDefaults(admin);
  const { connection } = await validAccessToken();
  const now = new Date();
  let token = connection.access_token;
  const revisionApplied = await priceRevisionApplied(admin);
  try {
    const result = await runOrderPull({
      now,
      watermark: watermarkForPriceRevision(seed.watermark, revisionApplied),
      customer,
      pageUrl: (filter, offset) => ordersUrl(connection.environment, filter, ORDER_PAGE_SIZE, offset),
      allowNext: (url) => allowOrdersNext(url, connection.environment),
      fetchPage: async (url) => {
        const response = await ebayRead<unknown>({
          url,
          token,
          marketplace: true,
          refresh: async () => {
            token = (await forceRefreshAccessToken()).access_token;
            return token;
          },
        });
        if (!response.ok) {
          if (response.status === 403) {
            throw new Error("eBay has not granted order access. Reconnect eBay, then pull orders again.");
          }
          throw new Error(response.message);
        }
        return { body: response.body, rlogid: response.rlogid, requestId: response.requestId };
      },
      loadLabelFees: () =>
        readShippingLabelFees({
          now,
          pageUrl: (offset) => financesTransactionsUrl(connection.environment, labelFeeFilter(now), LABEL_PAGE_SIZE, offset),
          allowNext: (url) => allowFinancesNext(url, connection.environment),
          fetchPage: async (url) => {
            const response = await ebayRead<unknown>({
              url,
              token,
              refresh: async () => {
                token = (await forceRefreshAccessToken()).access_token;
                return token;
              },
            });
            if (!response.ok) return { ok: false, status: response.status, message: response.message };
            return { ok: true, body: response.body };
          },
        }),
      fetchFulfillments: async (orderId) => {
        const response = await ebayRead<unknown>({
          url: shippingFulfillmentsUrl(connection.environment, orderId),
          token,
          marketplace: true,
          refresh: async () => {
            token = (await forceRefreshAccessToken()).access_token;
            return token;
          },
        });
        if (!response.ok) {
          if (response.status === 404) return { fulfillments: [] };
          if (response.status === 403) {
            throw new Error("eBay has not granted order access. Reconnect eBay, then pull orders again.");
          }
          throw new Error(`eBay tracking could not be read. Order drafts were still saved. Pull orders again to finish tracking. ${response.message}`);
        }
        return response.body;
      },
      fetchOrdersByIds: async (orderIds) => {
        const response = await ebayRead<unknown>({
          url: ordersByIdsUrl(connection.environment, orderIds),
          token,
          marketplace: true,
          refresh: async () => {
            token = (await forceRefreshAccessToken()).access_token;
            return token;
          },
        });
        if (!response.ok) {
          if (response.status === 403) {
            throw new Error("eBay has not granted order access. Reconnect eBay, then pull orders again.");
          }
          throw new Error(`eBay order cancellations could not be read. ${response.message}`);
        }
        return { body: response.body, rlogid: response.rlogid, requestId: response.requestId };
      },
      store: supabaseStore(admin, ebayDefaults),
    });
    await writeEbayLog({
      entity: "orders",
      direction: "read",
      status: "ok",
      message: orderPullMessage(result),
      detail: {
        created: result.created,
        updated: result.updated,
        linked: result.linked,
        skipped: result.skipped,
        labels: result.labels,
        shipments: result.shipments,
        shipped: result.shipped,
        shippedHeld: result.shippedHeld,
        cancelled: result.cancelled,
        cancelSkipped: result.cancelSkipped,
        history: result.history ? 1 : 0,
        priceRevision: ORDER_PRICE_REVISION,
        rlogid: result.rlogid,
        requestId: result.requestId,
      },
    });
    return {
      created: result.created,
      updated: result.updated,
      linked: result.linked,
      skipped: result.skipped,
      fetchedAt: result.fetchedAt,
      history: result.history,
      labels: result.labels,
      shipments: result.shipments,
      shipped: result.shipped,
      shippedHeld: result.shippedHeld,
      cancelled: result.cancelled,
      cancelSkipped: result.cancelSkipped,
    };
  } catch (error) {
    const message = errorText(error, "eBay order pull failed.");
    await writeEbayLog({
      entity: "orders",
      direction: "read",
      status: "error",
      message: message.slice(0, 300),
      detail: null,
    });
    throw error;
  }
}

export async function applyLegacyLogSeed(csv: string): Promise<SeedPlan & { message: string }> {
  const rows = parseLegacyLogCsv(csv);
  if (rows.length === 0) {
    throw new Error("The log map has no eBay order rows. Check the Order Number and REF columns.");
  }
  const admin = getServiceSupabase();
  if (!admin) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY on the server.");
  const seed = await readSeed(admin);
  if (seed.missingTable) throw new Error(MIGRATION);
  const existing: ExistingSeedOrder[] = [];
  for (const chunk of chunks([...new Set(rows.map((row) => row.soNumber))], 200)) {
    const { data, error } = await admin
      .from("sales_orders")
      .select("id, so_number, ebay_order_id, ebay_sales_record_ref")
      .in("so_number", chunk);
    if (error) throw new Error(errorText(error));
    for (const row of data ?? []) {
      const soNumber = typeof row.so_number === "number" ? row.so_number : Number(row.so_number);
      if (!Number.isSafeInteger(soNumber)) continue;
      existing.push({
        id: String(row.id),
        soNumber,
        ebayOrderId: row.ebay_order_id == null ? null : String(row.ebay_order_id),
        ebaySalesRecordRef: row.ebay_sales_record_ref == null ? null : String(row.ebay_sales_record_ref),
      });
    }
  }
  const drafts = await loadSeedDrafts(admin, [...new Set(rows.map((row) => row.ebayOrderId))]);
  const plan = planLegacySeed(rows, existing, drafts);
  await replaceLegacyMap(admin, plan.map);
  for (const update of plan.updates) {
    const order = await admin
      .from("sales_orders")
      .update({ ebay_order_id: update.ebayOrderId, updated_at: new Date().toISOString() })
      .eq("id", update.id)
      .is("ebay_order_id", null);
    if (order.error && order.error.code !== "23505") throw new Error("A sales order could not be linked.");
    if (update.salesRecordRef) {
      const record = await admin
        .from("sales_orders")
        .update({ ebay_sales_record_ref: update.salesRecordRef })
        .eq("id", update.id)
        .is("ebay_sales_record_ref", null);
      if (record.error) throw new Error("A sales order could not be linked.");
    }
    await insertEvent(admin, update.id, "linked", null, null);
  }
  const numbered = await assignLegacyNumbers(admin, plan.assignments);
  const assigned = numbered.assigned;
  await advanceSoCounter(admin, plan.assignments.map((row) => row.soNumber));
  const current = await admin.from("ebay_order_seed").select("orders_watermark").eq("id", 1).maybeSingle();
  if (current.error) throw new Error(errorText(current.error));
  const saved = await admin.from("ebay_order_seed").upsert({
    id: 1,
    applied_at: new Date().toISOString(),
    linked: plan.linked,
    assigned,
    skipped: plan.skipped,
    conflicts: plan.conflicts + (plan.assigned - assigned),
    missing: plan.missing,
    orders_watermark: current.data?.orders_watermark ?? null,
  });
  if (saved.error) {
    if (/assigned|ebay_legacy_order_map/i.test(saved.error.message ?? "")) throw new Error(MAP_MIGRATION);
    throw new Error(errorText(saved.error));
  }
  const conflicts = plan.conflicts + (plan.assigned - assigned);
  const shippedNote = numbered.shipped
    ? ` Marked ${numbered.shipped} ${numbered.shipped === 1 ? "order" : "orders"} shipped.`
    : "";
  const message = `Linked ${plan.linked} existing sales ${plan.linked === 1 ? "order" : "orders"}. Assigned ${assigned} legacy SO ${assigned === 1 ? "number" : "numbers"} to drafts. ${plan.missing} eBay ${plan.missing === 1 ? "order had" : "orders had"} no sales order to update. ${conflicts} ${conflicts === 1 ? "conflict was" : "conflicts were"} left unchanged.${shippedNote}`;
  await writeEbayLog({
    entity: "orders",
    direction: "read",
    status: "ok",
    message,
    detail: { linked: plan.linked, assigned, shipped: numbered.shipped, skipped: plan.skipped, conflicts, missing: plan.missing },
  });
  return { ...plan, assigned, conflicts, message };
}

export async function backfillLegacySoNumbers(): Promise<{ assigned: number; conflicts: number; message: string }> {
  const admin = getServiceSupabase();
  if (!admin) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY on the server.");
  const seed = await readSeed(admin);
  if (seed.missingTable) throw new Error(MIGRATION);
  const stored = await admin.from("ebay_legacy_order_map").select("ebay_order_id, so_number, sales_record_ref");
  if (stored.error) {
    if (tableMissing(stored.error, "ebay_legacy_order_map")) throw new Error(MAP_MIGRATION);
    throw new Error(errorText(stored.error));
  }
  const map = (stored.data ?? [])
    .map((row) => {
      const soNumber = typeof row.so_number === "number" ? row.so_number : Number(row.so_number);
      const ebayOrderId = row.ebay_order_id == null ? "" : String(row.ebay_order_id);
      if (!ebayOrderId || !Number.isSafeInteger(soNumber)) return null;
      return {
        soNumber,
        ebayOrderId,
        salesRecordRef: row.sales_record_ref == null ? null : String(row.sales_record_ref),
      };
    })
    .filter((row): row is LegacyMapEntry => row != null);
  if (map.length === 0) {
    const message = "The legacy log map is not stored. Upload the log CSV with Apply log map, then assign SO numbers.";
    return { assigned: 0, conflicts: 0, message };
  }
  const existing: ExistingSeedOrder[] = [];
  for (const chunk of chunks([...new Set(map.map((row) => row.soNumber))], 200)) {
    const { data, error } = await admin.from("sales_orders").select("id, so_number, ebay_order_id, ebay_sales_record_ref").in("so_number", chunk);
    if (error) throw new Error(errorText(error));
    for (const row of data ?? []) {
      const soNumber = typeof row.so_number === "number" ? row.so_number : Number(row.so_number);
      if (!Number.isSafeInteger(soNumber)) continue;
      existing.push({
        id: String(row.id),
        soNumber,
        ebayOrderId: row.ebay_order_id == null ? null : String(row.ebay_order_id),
        ebaySalesRecordRef: row.ebay_sales_record_ref == null ? null : String(row.ebay_sales_record_ref),
      });
    }
  }
  const drafts = await loadSeedDrafts(admin, map.map((row) => row.ebayOrderId));
  const plan = planLegacySeed(
    map.map((row) => ({ soNumber: row.soNumber, ebayOrderId: row.ebayOrderId, salesRecordRef: row.salesRecordRef })),
    existing,
    drafts,
  );
  const numbered = await assignLegacyNumbers(admin, plan.assignments);
  const assigned = numbered.assigned;
  await advanceSoCounter(admin, plan.assignments.map((row) => row.soNumber));
  const conflicts = plan.conflicts + (plan.assigned - assigned);
  const shippedNote = numbered.shipped
    ? ` Marked ${numbered.shipped} ${numbered.shipped === 1 ? "order" : "orders"} shipped.`
    : "";
  const message = `Assigned ${assigned} legacy SO ${assigned === 1 ? "number" : "numbers"} from the stored log map. ${conflicts} ${conflicts === 1 ? "conflict was" : "conflicts were"} left unchanged.${shippedNote}`;
  await writeEbayLog({
    entity: "orders",
    direction: "read",
    status: "ok",
    message,
    detail: { assigned, shipped: numbered.shipped, conflicts, missing: plan.missing },
  });
  return { assigned, conflicts, message };
}

async function loadSeedDrafts(admin: SupabaseClient, ebayOrderIds: string[]): Promise<SeedDraft[]> {
  const drafts: SeedDraft[] = [];
  for (const chunk of chunks([...new Set(ebayOrderIds)], 200)) {
    if (chunk.length === 0) continue;
    const { data, error } = await admin
      .from("sales_orders")
      .select("id, status, so_number, ebay_order_id, ebay_sales_record_ref")
      .in("ebay_order_id", chunk);
    if (error) throw new Error(errorText(error));
    for (const row of data ?? []) {
      const soNumber = row.so_number == null || row.so_number === "" ? null : Number(row.so_number);
      drafts.push({
        id: String(row.id),
        status: String(row.status ?? ""),
        soNumber: soNumber != null && Number.isSafeInteger(soNumber) ? soNumber : null,
        ebayOrderId: row.ebay_order_id == null ? null : String(row.ebay_order_id),
        ebaySalesRecordRef: row.ebay_sales_record_ref == null ? null : String(row.ebay_sales_record_ref),
      });
    }
  }
  return drafts;
}

async function replaceLegacyMap(admin: SupabaseClient, map: LegacyMapEntry[]): Promise<void> {
  for (const chunk of chunks(map, 200)) {
    if (chunk.length === 0) continue;
    const saved = await admin.from("ebay_legacy_order_map").upsert(
      chunk.map((row) => ({
        ebay_order_id: row.ebayOrderId,
        so_number: row.soNumber,
        sales_record_ref: row.salesRecordRef,
      })),
    );
    if (saved.error) {
      if (tableMissing(saved.error, "ebay_legacy_order_map")) throw new Error(MAP_MIGRATION);
      throw new Error(errorText(saved.error));
    }
  }
  const keep = new Set(map.map((row) => row.ebayOrderId));
  const current = await admin.from("ebay_legacy_order_map").select("ebay_order_id");
  if (current.error) {
    if (tableMissing(current.error, "ebay_legacy_order_map")) throw new Error(MAP_MIGRATION);
    throw new Error(errorText(current.error));
  }
  const stale = (current.data ?? [])
    .map((row) => String(row.ebay_order_id ?? ""))
    .filter((id) => id && !keep.has(id));
  for (const chunk of chunks(stale, 200)) {
    if (chunk.length === 0) continue;
    const removed = await admin.from("ebay_legacy_order_map").delete().in("ebay_order_id", chunk);
    if (removed.error) throw new Error(errorText(removed.error));
  }
}

async function assignLegacyNumbers(
  admin: SupabaseClient,
  assignments: SoNumberAssignment[],
): Promise<{ assigned: number; shipped: number }> {
  let assigned = 0;
  let shipped = 0;
  for (const assignment of assignments) {
    const now = new Date().toISOString();
    const updated = await admin
      .from("sales_orders")
      .update({
        ...ebaySoReferenceAssignment(assignment.soNumber, now),
        updated_at: now,
      })
      .eq("id", assignment.id)
      .eq("status", "draft")
      .is("so_number", null)
      .select("id");
    if (updated.error?.code === "23505" || !updated.data?.length) continue;
    if (updated.error) throw new Error("A draft sales order could not be given its legacy SO number.");
    if (assignment.salesRecordRef) {
      await admin
        .from("sales_orders")
        .update({ ebay_sales_record_ref: assignment.salesRecordRef })
        .eq("id", assignment.id)
        .is("ebay_sales_record_ref", null);
    }
    await insertEvent(admin, assignment.id, "approved", "draft", "approved", `SO${assignment.soNumber}`);
    if (await markEbayOrderShippedIfTracked(admin, assignment.id)) shipped += 1;
    assigned += 1;
  }
  return { assigned, shipped };
}

async function advanceSoCounter(admin: SupabaseClient, numbers: number[]): Promise<void> {
  const usable = numbers.filter((number) => Number.isSafeInteger(number) && number >= 1);
  if (usable.length === 0) return;
  const max = Math.max(...usable);
  const current = await admin.from("so_counter").select("next_number").eq("id", 1).maybeSingle();
  if (current.error || current.data?.next_number == null) return;
  const next = Number(current.data.next_number);
  if (!Number.isSafeInteger(next) || max < next) return;
  await admin.from("so_counter").update({ next_number: max + 1 }).eq("id", 1).lte("next_number", max);
}
