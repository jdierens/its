import { omitPickTicketSku, pickSheetPlace } from "@/lib/pickSheet";
import { salesOrderBuyerTotal, type QboInvoiceFacts, type SalesOrderStageInput } from "@/lib/salesOrderStageIcons";
import { getSupabase } from "@/lib/supabase";

/**
 * Stage facts for the sales-order icon strip.
 * One batched read of the orders on the page, not a query per row.
 * QuickBooks invoices are so_invoices rows with source qbo_import.
 * Until those columns exist, every invoice icon stays neutral.
 */

const CHUNK = 150;

type OrderFlag = {
  id: string;
  status: string;
  approvedAt: boolean;
  packedAt: boolean;
};

function relationMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /schema cache|does not exist|could not find the table|could not find the column/i.test(message)
  );
}

function chunks(ids: string[]): string[][] {
  const slices: string[][] = [];
  for (let index = 0; index < ids.length; index += CHUNK) slices.push(ids.slice(index, index + CHUNK));
  return slices;
}

async function inChunks<T>(ids: string[], load: (slice: string[]) => Promise<T[]>): Promise<T[]> {
  const parts = await Promise.all(chunks(ids).map((slice) => load(slice)));
  return parts.flat();
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function firstRelation(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value[0] && typeof value[0] === "object" ? (value[0] as Record<string, unknown>) : null;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

export async function loadSalesOrderStageInput(orderId: string): Promise<SalesOrderStageInput | null> {
  const inputs = await loadSalesOrderStageInputs([orderId]);
  return inputs.get(orderId) ?? null;
}

export async function loadSalesOrderStageInputs(ids: readonly string[]): Promise<Map<string, SalesOrderStageInput>> {
  const wanted = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const result = new Map<string, SalesOrderStageInput>();
  if (wanted.length === 0) return result;

  const supabase = await getSupabase();
  const [orders, lineFacts, lists, packages, shipments, approvals, links] = await Promise.all([
    loadOrderFlags(supabase, wanted),
    loadLineFacts(supabase, wanted),
    loadPickLists(supabase, wanted),
    loadPackages(supabase, wanted),
    loadShipments(supabase, wanted),
    loadApprovals(supabase, wanted),
    loadQboLinks(supabase, wanted),
  ]);
  const picks = await loadPickQty(supabase, lists.map((list) => list.id));

  const picked = new Set<string>();
  const listOrder = new Map<string, string>();
  for (const list of lists) {
    listOrder.set(list.id, list.salesOrderId);
    if (list.status === "picked" || list.status === "short") picked.add(list.salesOrderId);
  }
  for (const pick of picks) {
    const salesOrderId = listOrder.get(pick.pickListId);
    if (salesOrderId && lineFacts.pickableAllocations.has(pick.allocationId)) picked.add(salesOrderId);
  }

  for (const id of wanted) {
    const order = orders.get(id);
    if (!order) continue;
    const qbo = links.get(id) ?? { present: false, saleAmount: 0, totalAmount: 0 };
    result.set(id, {
      status: order.status,
      approvedAt: order.approvedAt,
      approvedEvent: approvals.has(id),
      hasPickableLines: lineFacts.pickableOrders.has(id),
      picked: picked.has(id),
      packed: order.packedAt || packages.has(id),
      hasShipment: shipments.has(id),
      total: lineFacts.totals.get(id) ?? null,
      qbo,
    });
  }
  return result;
}

async function loadOrderFlags(supabase: Awaited<ReturnType<typeof getSupabase>>, ids: string[]): Promise<Map<string, OrderFlag>> {
  const flags = new Map<string, OrderFlag>();
  const rows = await inChunks(ids, async (slice) => {
    const withPacked = await supabase.from("sales_orders").select("id, status, approved_at, packed_at").in("id", slice);
    if (!withPacked.error) return asRows(withPacked.data);
    if (!relationMissing(withPacked.error) || !/packed_at/i.test(withPacked.error.message ?? "")) {
      throw new Error(withPacked.error.message || "Could not read sales orders.");
    }
    const plain = await supabase.from("sales_orders").select("id, status, approved_at").in("id", slice);
    if (plain.error) throw new Error(plain.error.message);
    return asRows(plain.data);
  });
  for (const row of rows) {
    const id = text(row.id);
    if (!id) continue;
    flags.set(id, {
      id,
      status: text(row.status) || "draft",
      approvedAt: row.approved_at != null && text(row.approved_at) !== "",
      packedAt: row.packed_at != null && text(row.packed_at) !== "",
    });
  }
  return flags;
}

async function loadLineFacts(
  supabase: Awaited<ReturnType<typeof getSupabase>>,
  ids: string[],
): Promise<{ totals: Map<string, number | null>; pickableOrders: Set<string>; pickableAllocations: Set<string> }> {
  const linesByOrder = new Map<string, { extPrice: string }[]>();
  const pickableOrders = new Set<string>();
  const pickableAllocations = new Set<string>();
  const rows = await inChunks(ids, async (slice) => {
    const rich = await supabase
      .from("so_lines")
      .select("sales_order_id, ext_price, line_kind, so_line_allocations(id, items!so_line_allocations_item_id_fkey(item_type, sku))")
      .in("sales_order_id", slice);
    if (!rich.error) return asRows(rich.data);
    if (relationMissing(rich.error)) return [];
    const plain = await supabase.from("so_lines").select("sales_order_id, ext_price, line_kind").in("sales_order_id", slice);
    if (plain.error) {
      if (relationMissing(plain.error)) return [];
      throw new Error(plain.error.message);
    }
    return asRows(plain.data);
  });

  for (const row of rows) {
    const salesOrderId = text(row.sales_order_id);
    if (!salesOrderId) continue;
    const ext = row.ext_price == null || row.ext_price === "" ? "" : Number(row.ext_price).toFixed(2);
    const lines = linesByOrder.get(salesOrderId) ?? [];
    lines.push({ extPrice: ext });
    linesByOrder.set(salesOrderId, lines);
    const allocations = asRows(row.so_line_allocations);
    for (const allocation of allocations) {
      const item = firstRelation(allocation.items);
      const lineKind = text(row.line_kind) || "product";
      const itemType = item ? text(item.item_type) : "";
      const sku = item ? text(item.sku) : "";
      if (omitPickTicketSku(sku)) continue;
      if (pickSheetPlace({ lineKind, itemType: itemType || null }) !== "pick") continue;
      pickableOrders.add(salesOrderId);
      const allocationId = text(allocation.id);
      if (allocationId) pickableAllocations.add(allocationId);
    }
  }

  const totals = new Map<string, number | null>();
  for (const [salesOrderId, lines] of linesByOrder) totals.set(salesOrderId, salesOrderBuyerTotal(lines));
  return { totals, pickableOrders, pickableAllocations };
}

async function loadPickLists(
  supabase: Awaited<ReturnType<typeof getSupabase>>,
  ids: string[],
): Promise<{ id: string; salesOrderId: string; status: string }[]> {
  const rows = await inChunks(ids, async (slice) => {
    const { data, error } = await supabase
      .from("so_pick_lists")
      .select("id, sales_order_id, status")
      .in("sales_order_id", slice)
      .neq("status", "cancelled");
    if (error) {
      if (relationMissing(error)) return [];
      throw new Error(error.message);
    }
    return asRows(data);
  });
  return rows
    .map((row) => ({ id: text(row.id), salesOrderId: text(row.sales_order_id), status: text(row.status) }))
    .filter((row) => row.id && row.salesOrderId);
}

async function loadPickQty(
  supabase: Awaited<ReturnType<typeof getSupabase>>,
  listIds: string[],
): Promise<{ pickListId: string; allocationId: string }[]> {
  if (listIds.length === 0) return [];
  const rows = await inChunks(listIds, async (slice) => {
    const { data, error } = await supabase.from("so_picks").select("pick_list_id, allocation_id, qty_picked").in("pick_list_id", slice).gt("qty_picked", 0);
    if (error) {
      if (relationMissing(error)) return [];
      throw new Error(error.message);
    }
    return asRows(data);
  });
  return rows
    .map((row) => ({ pickListId: text(row.pick_list_id), allocationId: text(row.allocation_id) }))
    .filter((row) => row.pickListId && row.allocationId);
}

async function loadPackages(supabase: Awaited<ReturnType<typeof getSupabase>>, ids: string[]): Promise<Set<string>> {
  const rows = await inChunks(ids, async (slice) => {
    const { data, error } = await supabase.from("so_packages").select("sales_order_id").in("sales_order_id", slice);
    if (error) {
      if (relationMissing(error)) return [];
      throw new Error(error.message);
    }
    return asRows(data);
  });
  return new Set(rows.map((row) => text(row.sales_order_id)).filter(Boolean));
}

async function loadShipments(supabase: Awaited<ReturnType<typeof getSupabase>>, ids: string[]): Promise<Set<string>> {
  const rows = await inChunks(ids, async (slice) => {
    const { data, error } = await supabase.from("so_shipments").select("sales_order_id, awb, ship_date").in("sales_order_id", slice);
    if (error) {
      if (relationMissing(error)) return [];
      throw new Error(error.message);
    }
    return asRows(data);
  });
  const shipped = new Set<string>();
  for (const row of rows) {
    const awb = text(row.awb).trim();
    const shipDate = text(row.ship_date).trim();
    if (!awb && !shipDate) continue;
    const id = text(row.sales_order_id);
    if (id) shipped.add(id);
  }
  return shipped;
}

async function loadApprovals(supabase: Awaited<ReturnType<typeof getSupabase>>, ids: string[]): Promise<Set<string>> {
  const rows = await inChunks(ids, async (slice) => {
    const { data, error } = await supabase.from("so_events").select("sales_order_id").in("sales_order_id", slice).eq("event", "approved");
    if (error) {
      if (relationMissing(error)) return [];
      throw new Error(error.message);
    }
    return asRows(data);
  });
  return new Set(rows.map((row) => text(row.sales_order_id)).filter(Boolean));
}

async function loadQboLinks(supabase: Awaited<ReturnType<typeof getSupabase>>, ids: string[]): Promise<Map<string, QboInvoiceFacts>> {
  const sums = new Map<string, { sale: number; total: number }>();
  const rows = await inChunks(ids, async (slice) => {
    const { data, error } = await supabase
      .from("so_invoices")
      .select("sales_order_id, qbo_sale_amount, qbo_total_amt")
      .in("sales_order_id", slice)
      .eq("source", "qbo_import");
    if (error) {
      if (relationMissing(error)) return [];
      throw new Error(error.message);
    }
    return asRows(data);
  });
  for (const row of rows) {
    const id = text(row.sales_order_id);
    if (!id) continue;
    const current = sums.get(id) ?? { sale: 0, total: 0 };
    const sale = Number(row.qbo_sale_amount);
    const total = Number(row.qbo_total_amt);
    if (Number.isFinite(sale)) current.sale += sale;
    if (Number.isFinite(total)) current.total += total;
    sums.set(id, current);
  }
  const links = new Map<string, QboInvoiceFacts>();
  for (const [id, amounts] of sums) {
    links.set(id, {
      present: true,
      saleAmount: Math.round(amounts.sale * 100) / 100,
      totalAmount: Math.round(amounts.total * 100) / 100,
    });
  }
  return links;
}
