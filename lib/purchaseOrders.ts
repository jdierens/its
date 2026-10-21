"use server";

import { errorText } from "@/lib/errors";
import { type PurchaseAccess } from "@/lib/purchaseAccess";
import { normalizeShipments, parseFreightIn, type ShipmentInput } from "@/lib/poCharges";
import { formatExtension, formatUnitPrice } from "@/lib/poLineMoney";
import { loadPoAttachments, type PoAttachmentView } from "@/lib/poAttachments";
import {
  hidePurchaseMoney,
  normalizePurchaseOrderDraft,
  purchaseOrderTotal,
  type PoDraftInput,
} from "@/lib/purchaseOrderDraft";
import { purchaseOperatorId, purchasePageAccess } from "@/lib/purchaseSession";
import { getSupabase } from "@/lib/supabase";

export type PurchaseVendor = { id: string; name: string };

export type PurchaseItemHit = { id: string; sku: string; name: string; description: string };

export type PurchaseOrderListItem = {
  id: string;
  number: string;
  vendorName: string;
  status: string;
  orderedOn: string | null;
  expectedOn: string | null;
  fulfillment: string;
  total: number | null;
};

export type PurchaseOrderLineView = {
  itemId: string;
  itemSku: string;
  itemName: string;
  description: string;
  qty: string;
  unitCost: string;
  extPrice: string;
  condition: string;
  unit: string;
};

export type PurchaseShipmentView = {
  carrier: string;
  trackingNumber: string;
};

export type PurchaseOrderView = {
  id: string;
  number: string;
  status: string;
  vendorId: string;
  vendorName: string;
  fulfillment: string;
  currency: string | null;
  terms: string | null;
  orderedOn: string;
  expectedOn: string;
  vendorNotes: string;
  internalNotes: string | null;
  sentAt: string | null;
  lines: PurchaseOrderLineView[];
  shipments: PurchaseShipmentView[];
  attachments: PoAttachmentView[];
  subtotal: number | null;
  freightIn: string | null;
  total: number | null;
};

export type PoSaveInput = PoDraftInput & {
  freightIn: string;
  shipments: ShipmentInput[];
};

const EDIT_DENIED = "You cannot change a purchase order.";

export async function listPurchaseVendors(): Promise<PurchaseVendor[]> {
  const { data, error } = await (await getSupabase())
    .from("vendors")
    .select("id, display_name")
    .eq("active", true)
    .order("display_name");
  if (error) throw new Error(errorText(error));
  return (data ?? []).map((row) => ({ id: String(row.id), name: String(row.display_name ?? "") }));
}

export async function searchPurchaseItems(query: string): Promise<PurchaseItemHit[]> {
  const needle = query.trim().replace(/[%_,]/g, "");
  if (needle.length < 1) return [];
  const pattern = `%${needle}%`;
  const { data, error } = await (await getSupabase())
    .from("items")
    .select("id, sku, name, description")
    .or(`sku.ilike.${pattern},name.ilike.${pattern},description.ilike.${pattern}`)
    .order("sku")
    .limit(8);
  if (error) throw new Error(errorText(error));
  return (data ?? []).map((row) => ({
    id: String(row.id),
    sku: String(row.sku ?? ""),
    name: String(row.name ?? ""),
    description: String(row.description ?? "").slice(0, 500),
  }));
}

export async function listPurchaseOrders(): Promise<PurchaseOrderListItem[]> {
  const access = await purchasePageAccess();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("id, number, status, ordered_on, expected_on, fulfillment, freight_in, vendors(display_name), po_lines(ext_price)")
    .eq("purpose", "purchase")
    .order("created_at", { ascending: false });
  if (error) throw new Error(errorText(error));

  return (data ?? []).map((row) => {
    const vendor = firstRelation(row.vendors);
    const lines = Array.isArray(row.po_lines) ? row.po_lines : [];
    const priced = lines.map((line) => ({ extPrice: moneyOrNull(line.ext_price) ?? 0 }));
    const subtotal = purchaseOrderTotal(priced);
    const freight = moneyOrNull(row.freight_in);
    const total = subtotal + (freight ?? 0);
    const item = hidePurchaseMoney(
      {
        id: String(row.id),
        number: String(row.number),
        vendorName: String(vendor?.display_name ?? ""),
        status: String(row.status),
        orderedOn: dateValue(row.ordered_on),
        expectedOn: dateValue(row.expected_on),
        fulfillment: String(row.fulfillment),
        total,
      },
      access,
    );
    return item;
  });
}

export async function loadPurchaseOrder(id: string): Promise<PurchaseOrderView | null> {
  const access = await purchasePageAccess();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(
      "id, number, status, vendor_id, fulfillment, currency, terms, freight_in, ordered_on, expected_on, vendor_notes, internal_notes, sent_at, vendors(display_name), po_lines(line_no, item_id, description, qty_ordered, unit_cost, ext_price, condition, unit, items(sku, name)), po_shipments(carrier, tracking_number, created_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(errorText(error));
  if (!data) return null;

  const vendor = firstRelation(data.vendors);
  const lines = (Array.isArray(data.po_lines) ? data.po_lines : [])
    .slice()
    .sort((a, b) => Number(a.line_no) - Number(b.line_no))
    .map((line) => {
      const item = firstRelation(line.items);
      const unitCost = moneyOrNull(line.unit_cost);
      const extPrice = moneyOrNull(line.ext_price);
      const visible = hidePurchaseMoney({ unitCost, extPrice }, access);
      return {
        itemId: line.item_id ? String(line.item_id) : "",
        itemSku: String(item?.sku ?? ""),
        itemName: String(item?.name ?? ""),
        description: String(line.description ?? ""),
        qty: formatQty(line.qty_ordered),
        unitCost: visible.unitCost == null ? "" : formatUnitPrice(visible.unitCost),
        extPrice: visible.extPrice == null ? "" : formatExtension(visible.extPrice),
        condition: String(line.condition ?? "Used"),
        unit: String(line.unit ?? "Piece"),
      };
    });

  const priced = (Array.isArray(data.po_lines) ? data.po_lines : []).map((line) => ({
    extPrice: moneyOrNull(line.ext_price) ?? 0,
  }));
  const subtotal = purchaseOrderTotal(priced);
  const freight = moneyOrNull(data.freight_in);
  const shipments = (Array.isArray(data.po_shipments) ? data.po_shipments : [])
    .slice()
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
    .map((row) => ({
      carrier: String(row.carrier ?? ""),
      trackingNumber: String(row.tracking_number ?? ""),
    }));
  const shown = hidePurchaseMoney(
    {
      id: String(data.id),
      number: String(data.number),
      status: String(data.status),
      vendorId: String(data.vendor_id),
      vendorName: String(vendor?.display_name ?? ""),
      fulfillment: String(data.fulfillment),
      currency: String(data.currency ?? "USD"),
      terms: data.terms ? String(data.terms) : "",
      orderedOn: dateValue(data.ordered_on) ?? "",
      expectedOn: dateValue(data.expected_on) ?? "",
      vendorNotes: data.vendor_notes ? String(data.vendor_notes) : "",
      internalNotes: data.internal_notes ? String(data.internal_notes) : "",
      sentAt: data.sent_at ? String(data.sent_at) : null,
      lines,
      shipments,
      attachments: await loadPoAttachments(String(data.id)),
      subtotal,
      freightIn: freight == null ? "" : formatQty(freight),
      total: subtotal + (freight ?? 0),
    },
    access,
  );
  return {
    ...shown,
    terms: shown.terms,
    lines,
    shipments,
    attachments: shown.attachments,
    internalNotes: shown.internalNotes,
    freightIn: shown.freightIn == null ? null : String(shown.freightIn),
  };
}

export async function savePurchaseOrder(id: string | null, input: PoSaveInput): Promise<{ id: string }> {
  const access = await purchasePageAccess();
  if (!access.canEdit) throw new Error(EDIT_DENIED);
  const normalized = normalizePurchaseOrderDraft(input);
  if (!normalized.ok) throw new Error(normalized.error);
  const charges = normalizeCharges(input, access);

  const supabase = await getSupabase();
  const itemIds = normalized.value.lines.map((line) => line.itemId).filter((itemId): itemId is string => Boolean(itemId));
  if (itemIds.length > 0) {
    const { data, error } = await supabase.from("items").select("id").in("id", itemIds);
    if (error) throw new Error(errorText(error));
    if ((data ?? []).length !== new Set(itemIds).size) throw new Error("Choose an item from the list.");
  }

  const internalNotes = access.canViewMoney ? normalized.value.internalNotes : id ? await readInternalNotes(id) : null;

  const { data, error } = await supabase.rpc("write_known_purchase_order", {
    p_id: id,
    p_vendor_id: normalized.value.vendorId,
    p_fulfillment: normalized.value.fulfillment,
    p_terms: normalized.value.terms,
    p_ordered_on: normalized.value.orderedOn,
    p_expected_on: normalized.value.expectedOn,
    p_internal_notes: internalNotes,
    p_vendor_notes: normalized.value.vendorNotes,
    p_operator_id: await purchaseOperatorId(),
    p_lines: normalized.value.lines,
  });
  if (error) throw new Error(friendlyPurchaseError(error));
  const orderId = String(data);
  await persistCharges(orderId, charges, access);
  return { id: orderId };
}

export async function savePurchaseOrderCharges(
  id: string,
  input: { freightIn: string; shipments: ShipmentInput[]; vendorNotes: string; internalNotes: string },
): Promise<void> {
  const access = await purchasePageAccess();
  if (!access.canEdit) throw new Error(EDIT_DENIED);
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("purchase_orders").select("id, status").eq("id", id).maybeSingle();
  if (error) throw new Error(errorText(error));
  if (!data) throw new Error("Purchase order not found.");
  if (data.status === "cancelled") throw new Error("A cancelled purchase order cannot be changed.");
  await persistCharges(id, normalizeCharges(input, access), access);
}

export async function sendPurchaseOrder(id: string): Promise<void> {
  const access = await purchasePageAccess();
  if (!access.canEdit) throw new Error(EDIT_DENIED);
  const { data, error } = await (await getSupabase())
    .from("purchase_orders")
    .update({ status: "open", sent_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .eq("purpose", "purchase")
    .select("id");
  if (error) throw new Error(errorText(error));
  if (!data || data.length !== 1) throw new Error("Only a draft purchase order can be sent.");
}

export async function cancelPurchaseOrder(id: string): Promise<void> {
  const access = await purchasePageAccess();
  if (!access.canEdit) throw new Error(EDIT_DENIED);
  const { data, error } = await (await getSupabase())
    .from("purchase_orders")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "draft")
    .eq("purpose", "purchase")
    .select("id");
  if (error) throw new Error(errorText(error));
  if (!data || data.length !== 1) throw new Error("Only a draft purchase order can be cancelled.");
}

async function readInternalNotes(id: string): Promise<string | null> {
  const { data, error } = await (await getSupabase())
    .from("purchase_orders")
    .select("internal_notes")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(errorText(error));
  return data?.internal_notes ? String(data.internal_notes) : null;
}

function normalizeCharges(
  input: { freightIn: string; shipments: ShipmentInput[]; vendorNotes: string; internalNotes: string },
  access: PurchaseAccess,
): { freightIn: number | null; vendorNotes: string | null; internalNotes: string | null; shipments: { carrier: string; trackingNumber: string }[] } {
  const shipments = normalizeShipments(input.shipments);
  if (!shipments.ok) throw new Error(shipments.error);
  const vendorNotes = noteOrNull(input.vendorNotes, "Vendor notes");
  if (!access.canViewMoney) return { freightIn: null, vendorNotes, internalNotes: null, shipments: shipments.value };
  const freightIn = parseFreightIn(input.freightIn);
  if (freightIn === "invalid") throw new Error("Freight in must be a USD amount, zero or more.");
  return { freightIn, vendorNotes, internalNotes: noteOrNull(input.internalNotes, "Internal notes"), shipments: shipments.value };
}

async function persistCharges(
  orderId: string,
  charges: { freightIn: number | null; vendorNotes: string | null; internalNotes: string | null; shipments: { carrier: string; trackingNumber: string }[] },
  access: PurchaseAccess,
): Promise<void> {
  const supabase = await getSupabase();
  const patch: { vendor_notes: string | null; freight_in?: number | null; internal_notes?: string | null } = {
    vendor_notes: charges.vendorNotes,
  };
  if (access.canViewMoney) {
    patch.freight_in = charges.freightIn;
    patch.internal_notes = charges.internalNotes;
  }
  const updated = await supabase.from("purchase_orders").update(patch).eq("id", orderId);
  if (updated.error) throw new Error(friendlyPurchaseError(updated.error));
  const { error } = await supabase.rpc("replace_po_shipments", {
    p_order_id: orderId,
    p_operator_id: await purchaseOperatorId(),
    p_rows: charges.shipments,
  });
  if (error) throw new Error(friendlyPurchaseError(error));
}

function noteOrNull(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > 4000) throw new Error(`${label} are too long.`);
  return trimmed || null;
}

function friendlyPurchaseError(error: { message?: string }): string {
  const text = errorText(error);
  if (text.includes("Only a draft")) return "Only a draft purchase order can be edited.";
  if (text.includes("Add a line")) return "Add a line.";
  if (text.includes("purchase_orders_vendor_id_fkey")) return "Choose a vendor.";
  if (text.includes("po_lines_item_id_fkey")) return "Choose an item from the list.";
  if (text.includes("purchase_orders_terms_check")) return "Choose terms.";
  if (text.includes("purchase_orders_freight_in_check")) return "Freight in must be a USD amount, zero or more.";
  if (text.includes("po_lines_known_check")) return "Quantity, unit price, and extension do not match.";
  if (text.includes("po_shipments_order_tracking_unique")) return "That tracking number is already on this order.";
  if (text.includes("po_shipments_carrier_check")) return "Choose a carrier.";
  return text;
}

function firstRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function numberValue(value: unknown): number {
  return moneyOrNull(value) ?? 0;
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function dateValue(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.slice(0, 10);
}

function formatQty(value: unknown): string {
  const amount = numberValue(value);
  if (Number.isInteger(amount)) return String(amount);
  return amount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
