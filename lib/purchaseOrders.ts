"use server";

import { readAppUser } from "@/lib/appUserRecord";
import { authRequired } from "@/lib/authRequired";
import { errorText } from "@/lib/errors";
import { purchaseAccessForRole, type PurchaseAccess } from "@/lib/purchaseAccess";
import {
  hidePurchaseMoney,
  normalizePurchaseOrderDraft,
  purchaseOrderTotal,
  type PoDraftInput,
} from "@/lib/purchaseOrderDraft";
import { sessionUser } from "@/lib/sessionUser";
import { getSupabase } from "@/lib/supabase";

export type PurchaseVendor = { id: string; name: string };

export type PurchaseItemHit = { id: string; sku: string; name: string };

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
  description: string;
  qty: string;
  unitCost: string;
  condition: string;
  unit: string;
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
  notes: string;
  sentAt: string | null;
  lines: PurchaseOrderLineView[];
  total: number | null;
};

const EDIT_DENIED = "You cannot change a purchase order.";

export async function purchasePageAccess(): Promise<PurchaseAccess> {
  if (!authRequired()) return purchaseAccessForRole(null, false);
  const session = await sessionUser();
  if (!session) return purchaseAccessForRole(null, true);
  const user = await readAppUser(session.id);
  if (!user || user.status !== "approved") return purchaseAccessForRole(null, true);
  return purchaseAccessForRole(user.role, true);
}

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
    .select("id, sku, name")
    .or(`sku.ilike.${pattern},name.ilike.${pattern}`)
    .order("sku")
    .limit(8);
  if (error) throw new Error(errorText(error));
  return (data ?? []).map((row) => ({
    id: String(row.id),
    sku: String(row.sku ?? ""),
    name: String(row.name ?? ""),
  }));
}

export async function listPurchaseOrders(): Promise<PurchaseOrderListItem[]> {
  const access = await purchasePageAccess();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("id, number, status, ordered_on, expected_on, fulfillment, vendors(display_name), po_lines(qty_ordered, unit_cost)")
    .eq("purpose", "purchase")
    .order("created_at", { ascending: false });
  if (error) throw new Error(errorText(error));

  return (data ?? []).map((row) => {
    const vendor = firstRelation(row.vendors);
    const lines = Array.isArray(row.po_lines) ? row.po_lines : [];
    const priced = lines.map((line) => ({
      qty: numberValue(line.qty_ordered),
      unitCost: numberValue(line.unit_cost),
    }));
    const total = priced.every((line) => line.unitCost != null) ? purchaseOrderTotal(priced.map((line) => ({ qty: line.qty, unitCost: line.unitCost ?? 0 }))) : null;
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
      "id, number, status, vendor_id, fulfillment, currency, terms, ordered_on, expected_on, notes, sent_at, vendors(display_name), po_lines(line_no, item_id, description, qty_ordered, unit_cost, condition, unit, items(sku))",
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
      const unitCost = numberValue(line.unit_cost);
      const visible = hidePurchaseMoney({ unitCost }, access);
      return {
        itemId: line.item_id ? String(line.item_id) : "",
        itemSku: String(item?.sku ?? ""),
        description: String(line.description ?? ""),
        qty: formatQty(line.qty_ordered),
        unitCost: visible.unitCost == null ? "" : formatQty(visible.unitCost),
        condition: String(line.condition ?? "Used"),
        unit: String(line.unit ?? "Piece"),
      };
    });

  const priced = (Array.isArray(data.po_lines) ? data.po_lines : []).map((line) => ({
    qty: numberValue(line.qty_ordered),
    unitCost: numberValue(line.unit_cost) ?? 0,
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
      notes: data.notes ? String(data.notes) : "",
      sentAt: data.sent_at ? String(data.sent_at) : null,
      lines,
      total: purchaseOrderTotal(priced),
    },
    access,
  );
  return {
    ...shown,
    terms: shown.terms,
    lines,
  };
}

export async function savePurchaseOrder(id: string | null, input: PoDraftInput): Promise<{ id: string }> {
  const access = await purchasePageAccess();
  if (!access.canEdit) throw new Error(EDIT_DENIED);
  const normalized = normalizePurchaseOrderDraft(input);
  if (!normalized.ok) throw new Error(normalized.error);

  const supabase = await getSupabase();
  const itemIds = normalized.value.lines.map((line) => line.itemId).filter((itemId): itemId is string => Boolean(itemId));
  if (itemIds.length > 0) {
    const { data, error } = await supabase.from("items").select("id").in("id", itemIds);
    if (error) throw new Error(errorText(error));
    if ((data ?? []).length !== new Set(itemIds).size) throw new Error("Choose an item from the list.");
  }

  const { data, error } = await supabase.rpc("write_known_purchase_order", {
    p_id: id,
    p_vendor_id: normalized.value.vendorId,
    p_fulfillment: normalized.value.fulfillment,
    p_terms: normalized.value.terms,
    p_ordered_on: normalized.value.orderedOn,
    p_expected_on: normalized.value.expectedOn,
    p_notes: normalized.value.notes,
    p_operator_id: await operatorId(),
    p_lines: normalized.value.lines,
  });
  if (error) throw new Error(friendlyPurchaseError(error));
  return { id: String(data) };
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

async function operatorId(): Promise<string | null> {
  if (!authRequired()) return null;
  const session = await sessionUser();
  if (!session) throw new Error("Sign in required.");
  return session.id;
}

function friendlyPurchaseError(error: { message?: string }): string {
  const text = errorText(error);
  if (text.includes("Only a draft")) return "Only a draft purchase order can be edited.";
  if (text.includes("Add a line")) return "Add a line.";
  if (text.includes("purchase_orders_vendor_id_fkey")) return "Choose a vendor.";
  if (text.includes("po_lines_item_id_fkey")) return "Choose an item from the list.";
  return text;
}

function firstRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function numberValue(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : 0;
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
