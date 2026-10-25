import type { SupabaseClient } from "@supabase/supabase-js";
import { readEbayDraftDefaults } from "@/lib/ebayOrderDefaults";
import { apiBase, apizBase, financesTransactionsUrl, ordersUrl, type EbayEnvironment } from "@/lib/ebay/endpoints";
import { ebayRead } from "@/lib/ebay/http";
import { writeEbayLog } from "@/lib/ebay/log";
import {
  addLabelFees,
  applyLabelFees,
  draftLines,
  EBAY_SHIPPING_ITEM_SKU,
  draftOrderRow,
  EBAY_ORDER_CUSTOMER_NAME,
  EBAY_ORDER_CUSTOMER_QBO_ID,
  EBAY_PULL_OPERATOR_LABEL,
  labelFeeFilter,
  ORDER_PAGE_LIMIT,
  ORDER_PAGE_SIZE,
  orderPullWindows,
  pageNext,
  parseFulfillmentOrders,
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
import { addressFromRecord, type SoAddress } from "@/lib/salesOrderDraft";
import { getServiceSupabase } from "@/lib/supabaseAdmin";

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
    customer: { id: string; billTo: SoAddress | null },
  ): Promise<{ created: number; updated: number; linked: number }>;
  syncLabelFees?(fees: ReadonlyMap<string, number>): Promise<void>;
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
  customer: { id: string; billTo: SoAddress | null };
  fetchPage: (url: string) => Promise<{ body: unknown; rlogid: string | null; requestId: string | null }>;
  pageUrl: (filter: string, offset: number) => string;
  allowNext: (url: string) => boolean;
  loadLabelFees?: () => Promise<Map<string, number> | null>;
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
  let truncated = false;
  let rlogid: string | null = null;
  let requestId: string | null = null;

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
    skipped += actions.filter((action) => action.kind === "skip").length;
  }

  if (truncated) {
    throw new Error("eBay returned more orders than this pull reads. The next pull starts again and does not create a second draft for an order already saved.");
  }
  if (labelFees && input.store.syncLabelFees) {
    await input.store.syncLabelFees(labelFees);
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
    rlogid,
    requestId,
  };
}

/** A refresh keeps payment terms, Incoterms, and a bill-to that are already set. */
async function fillBlankEbayBillTo(admin: SupabaseClient, id: string, shipTo: unknown): Promise<void> {
  if (!shipTo || typeof shipTo !== "object") return;
  const shipLine = typeof (shipTo as { line1?: unknown }).line1 === "string" ? (shipTo as { line1: string }).line1.trim() : "";
  if (!shipLine) return;
  const current = await admin.from("sales_orders").select("bill_to").eq("id", id).maybeSingle();
  if (current.error) throw new Error("A draft sales order could not be updated.");
  const bill = current.data?.bill_to;
  const billLine = bill && typeof bill === "object" && typeof (bill as { line1?: unknown }).line1 === "string" ? (bill as { line1: string }).line1.trim() : "";
  if (billLine) return;
  const updated = await admin
    .from("sales_orders")
    .update({ bill_to: shipTo, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft");
  if (updated.error) throw new Error("A draft sales order could not be updated.");
}

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
      const rows = new Map<
        string,
        { id: string; status: string; so_number: number | string | null; ebay_order_id: string | null; ebay_sales_record_ref: string | null }
      >();
      for (const [column, values] of [
        ["ebay_order_id", orderIds],
        ["ebay_sales_record_ref", salesRefs],
      ] as const) {
        for (const chunk of chunks([...new Set(values)], 100)) {
          if (chunk.length === 0) continue;
          const { data, error } = await admin
            .from("sales_orders")
            .select("id, status, so_number, ebay_order_id, ebay_sales_record_ref")
            .in(column, chunk);
          if (error) throw new Error(error.message);
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
        if (error) throw new Error(error.message);
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
      return [...rows.values()].map((row) => ({
        id: String(row.id),
        status: String(row.status),
        ebayOrderId: row.ebay_order_id,
        ebaySalesRecordRef: row.ebay_sales_record_ref,
        soNumber: row.so_number == null || row.so_number === "" ? null : Number(row.so_number),
        personEdited: personEdited(events.get(String(row.id)) ?? []),
      }));
    },
    async itemsForSkus(skus) {
      const wanted = [...new Set(skus.map((sku) => sku.trim()).filter((sku) => sku.length > 0))];
      const found: { id: string; sku: string }[] = [];
      for (const chunk of chunks(wanted, 100)) {
        const exact = await admin.from("items").select("id, sku").in("sku", chunk);
        if (exact.error) throw new Error(exact.error.message);
        for (const row of exact.data ?? []) found.push({ id: String(row.id), sku: String(row.sku ?? "") });
      }
      const have = new Set(found.map((row) => row.sku));
      for (const chunk of chunks(wanted.filter((sku) => !have.has(sku)), 40)) {
        const filter = chunk.map((sku) => `sku.ilike."${escapeLike(sku).replace(/"/g, '""')}"`).join(",");
        const loose = await admin.from("items").select("id, sku").or(filter);
        if (loose.error) throw new Error(loose.error.message);
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
          throw new Error(error.message);
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
        if (error) throw new Error(error.message);
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
      for (const action of actions) {
        if (action.kind === "skip") continue;
        if (action.kind === "link") {
          await linkOrder(admin, action.id, action.ebayOrderId, action.salesRecordRef);
          linked += 1;
          continue;
        }
        if (action.order.shippingAmount != null && action.order.shippingAmount > 0 && !action.shippingItemId) {
          throw new Error("eBay shipping could not be allocated to item 4343.");
        }
        if (action.kind === "update") {
          const patch = draftOrderRow({
            order: action.order,
            customerId: customer.id,
            billTo: customer.billTo,
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
          await fillBlankEbayBillTo(admin, action.id, patch.ship_to);
          if (action.soNumber != null) {
            const numbered = await admin
              .from("sales_orders")
              .update({ so_number: action.soNumber, sheet_ref: `SO#${action.soNumber}`, updated_at: new Date().toISOString() })
              .eq("id", action.id)
              .eq("status", "draft")
              .is("so_number", null);
            if (numbered.error && numbered.error.code !== "23505") throw new Error("A legacy SO number could not be saved.");
          }
          const removed = await admin.from("so_lines").delete().eq("sales_order_id", action.id);
          if (removed.error) throw new Error("A draft sales order could not be updated.");
          await insertLines(admin, action.id, action);
          await insertEvent(admin, action.id, "updated", "draft", "draft");
          updated += 1;
          continue;
        }
        const inserted = await admin
          .from("sales_orders")
          .insert(
            draftOrderRow({
              order: action.order,
              customerId: customer.id,
              billTo: customer.billTo,
              soNumber: action.soNumber,
              salesRep: defaults.salesRep,
              paymentTerms: defaults.paymentTerms,
              incoterms: defaults.incoterms,
            }),
          )
          .select("id")
          .single();
        if (inserted.error?.code === "23505" && action.soNumber != null && /so_number|number_unique/i.test(inserted.error.message ?? "")) {
          const retry = await admin
            .from("sales_orders")
            .insert(
              draftOrderRow({
                order: action.order,
                customerId: customer.id,
                billTo: customer.billTo,
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
            await linkOrder(admin, String(found.data.id), action.order.ebayOrderId, action.order.salesRecordRef);
            linked += 1;
            continue;
          }
        }
        if (inserted.error || !inserted.data) throw new Error("A draft sales order could not be created.");
        const id = String(inserted.data.id);
        await insertLines(admin, id, action);
        await insertEvent(admin, id, "created", null, "draft");
        created += 1;
      }
      return { created, updated, linked };
    },
    async syncLabelFees(fees) {
      const ids = [...fees.keys()];
      for (const chunk of chunks(ids, 100)) {
        if (chunk.length === 0) continue;
        const { data, error } = await admin.from("sales_orders").select("id, ebay_order_id, ebay_label_fee").in("ebay_order_id", chunk);
        if (error) throw new Error(error.message);
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
    async setWatermark(iso) {
      const { error } = await admin.from("ebay_order_seed").update({ orders_watermark: iso }).eq("id", 1);
      if (error) throw new Error(error.message);
    },
  };
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
    throw new Error(error.message);
  }
  return {
    missingTable: false,
    seeded: Boolean(data),
    watermark: data && typeof data.orders_watermark === "string" ? data.orders_watermark : null,
  };
}

async function ebayCustomer(admin: SupabaseClient): Promise<{ id: string; billTo: SoAddress | null }> {
  const { data, error } = await admin
    .from("customers")
    .select("id, billing_address")
    .eq("display_name", EBAY_ORDER_CUSTOMER_NAME)
    .eq("qbo_id", EBAY_ORDER_CUSTOMER_QBO_ID)
    .eq("active", true)
    .limit(2);
  if (error) throw new Error(error.message);
  if (!data || data.length !== 1) {
    throw new Error("The eBay Customer record was not found. No sales orders were created.");
  }
  const billTo = addressFromRecord(data[0].billing_address);
  return { id: String(data[0].id), billTo: billTo.line1.trim() ? billTo : null };
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
    throw new Error(error.message);
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

export function orderPullMessage(result: Pick<OrderPullResult, "created" | "updated" | "linked" | "labels">): string {
  const labels =
    result.labels == null
      ? "Shipping label fees were not read. Reconnect eBay, then pull orders again."
      : `Found shipping label fees for ${result.labels} ${result.labels === 1 ? "order" : "orders"}.`;
  return `Created ${result.created} draft sales orders. Updated ${result.updated}. Linked ${result.linked}. ${labels}`;
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
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "eBay order pull failed.";
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
    if (error) throw new Error(error.message);
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
  const assigned = await assignLegacyNumbers(admin, plan.assignments);
  await advanceSoCounter(admin, plan.assignments.map((row) => row.soNumber));
  const current = await admin.from("ebay_order_seed").select("orders_watermark").eq("id", 1).maybeSingle();
  if (current.error) throw new Error(current.error.message);
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
    throw new Error(saved.error.message);
  }
  const conflicts = plan.conflicts + (plan.assigned - assigned);
  const message = `Linked ${plan.linked} existing sales ${plan.linked === 1 ? "order" : "orders"}. Assigned ${assigned} legacy SO ${assigned === 1 ? "number" : "numbers"} to drafts. ${plan.missing} eBay ${plan.missing === 1 ? "order had" : "orders had"} no sales order to update. ${conflicts} ${conflicts === 1 ? "conflict was" : "conflicts were"} left unchanged.`;
  await writeEbayLog({
    entity: "orders",
    direction: "read",
    status: "ok",
    message,
    detail: { linked: plan.linked, assigned, skipped: plan.skipped, conflicts, missing: plan.missing },
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
    throw new Error(stored.error.message);
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
    if (error) throw new Error(error.message);
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
  const assigned = await assignLegacyNumbers(admin, plan.assignments);
  await advanceSoCounter(admin, plan.assignments.map((row) => row.soNumber));
  const conflicts = plan.conflicts + (plan.assigned - assigned);
  const message = `Assigned ${assigned} legacy SO ${assigned === 1 ? "number" : "numbers"} from the stored log map. ${conflicts} ${conflicts === 1 ? "conflict was" : "conflicts were"} left unchanged.`;
  await writeEbayLog({
    entity: "orders",
    direction: "read",
    status: "ok",
    message,
    detail: { assigned, conflicts, missing: plan.missing },
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
    if (error) throw new Error(error.message);
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
      throw new Error(saved.error.message);
    }
  }
  const keep = new Set(map.map((row) => row.ebayOrderId));
  const current = await admin.from("ebay_legacy_order_map").select("ebay_order_id");
  if (current.error) {
    if (tableMissing(current.error, "ebay_legacy_order_map")) throw new Error(MAP_MIGRATION);
    throw new Error(current.error.message);
  }
  const stale = (current.data ?? [])
    .map((row) => String(row.ebay_order_id ?? ""))
    .filter((id) => id && !keep.has(id));
  for (const chunk of chunks(stale, 200)) {
    if (chunk.length === 0) continue;
    const removed = await admin.from("ebay_legacy_order_map").delete().in("ebay_order_id", chunk);
    if (removed.error) throw new Error(removed.error.message);
  }
}

async function assignLegacyNumbers(admin: SupabaseClient, assignments: SoNumberAssignment[]): Promise<number> {
  let assigned = 0;
  for (const assignment of assignments) {
    const updated = await admin
      .from("sales_orders")
      .update({
        so_number: assignment.soNumber,
        updated_at: new Date().toISOString(),
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
    await admin.from("sales_orders").update({ sheet_ref: `SO#${assignment.soNumber}` }).eq("id", assignment.id).is("sheet_ref", null);
    await insertEvent(admin, assignment.id, "linked", "draft", "draft", `SO${assignment.soNumber}`);
    assigned += 1;
  }
  return assigned;
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
