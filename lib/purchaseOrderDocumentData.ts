import { addressFromRecord, pacificToday } from "@/lib/salesOrderDraft";
import { purchasePageAccess } from "@/lib/purchaseSession";
import {
  buildPurchaseOrderDocument,
  type PurchaseOrderDocument,
} from "@/lib/purchaseOrderDocument";
import { getSupabase } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadPurchaseOrderDocument(
  id: string,
): Promise<{ document: PurchaseOrderDocument; orderId: string } | { error: string }> {
  const access = await purchasePageAccess();
  if (!access.canViewMoney) return { error: "You cannot open this document." };
  if (!UUID.test(id)) return { error: "Purchase order not found." };

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(
      "id, number, vendor_id, fulfillment, terms, ordered_on, expected_on, vendor_notes, freight_in, currency, ship_to, vendors(display_name, phone, primary_email, billing_address), po_lines(line_no, description, qty_ordered, unit_cost, ext_price, condition, items(sku, name)), po_shipments(tracking_number, created_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: "Purchase order not found." };
  if (!data) return { error: "Purchase order not found." };
  if (!data.number) return { error: "Approve the purchase order before printing it." };

  const vendor = firstRelation(data.vendors);
  const lines = (Array.isArray(data.po_lines) ? data.po_lines : [])
    .slice()
    .sort((a, b) => Number(a.line_no) - Number(b.line_no))
    .map((line) => {
      const item = firstRelation(line.items);
      return {
        sku: text(item?.sku),
        description: text(line.description) || text(item?.name),
        condition: text(line.condition),
        qty: line.qty_ordered == null ? "" : String(line.qty_ordered),
        unitPrice: money(line.unit_cost),
        extPrice: money(line.ext_price),
      };
    });
  const tracking = (Array.isArray(data.po_shipments) ? data.po_shipments : [])
    .slice()
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
    .map((row) => text(row.tracking_number))
    .filter(Boolean)
    .join(", ");
  const orderedOn = dateValue(data.ordered_on);
  const document = buildPurchaseOrderDocument({
    number: String(data.number),
    documentDate: orderedOn || pacificToday(),
    orderDate: orderedOn,
    expectedOn: dateValue(data.expected_on),
    terms: text(data.terms),
    fulfillment: text(data.fulfillment),
    vendorName: text(vendor?.display_name),
    vendorAddress: addressFromRecord(vendor?.billing_address),
    vendorPhone: text(vendor?.phone),
    vendorEmail: text(vendor?.primary_email),
    shipTo: addressFromRecord(data.ship_to),
    tracking,
    vendorNotes: text(data.vendor_notes),
    currency: text(data.currency) || "USD",
    freight: money(data.freight_in),
    lines,
  });
  if (!document) return { error: "Approve the purchase order before printing it." };
  return { document, orderId: String(data.id) };
}

function firstRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function money(value: unknown): number {
  if (value == null || value === "") return 0;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function dateValue(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return value.slice(0, 10);
}
