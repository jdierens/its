import {
  buildCustomerDocument,
  shippingColumns,
  type CustomerDocument,
  type CustomerDocumentKind,
  type CustomerDocumentLineInput,
} from "@/lib/customerDocument";
import { pacificToday } from "@/lib/salesOrderDraft";
import { loadSalesOrder } from "@/lib/salesOrders";
import { salesPageAccess } from "@/lib/salesSession";
import { getSupabase } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadCustomerDocument(
  id: string,
  kind: CustomerDocumentKind,
): Promise<{ document: CustomerDocument; orderId: string } | { error: string }> {
  const access = await salesPageAccess();
  if (!access.canViewMoney) return { error: "You cannot open this document." };
  if (!UUID.test(id)) return { error: "Sales order not found." };
  const order = await loadSalesOrder(id);
  if (!order) return { error: "Sales order not found." };
  const soNumber = Number(String(order.number ?? "").replace(/^SO/i, ""));
  if (!order.number || !Number.isSafeInteger(soNumber) || soNumber < 1) {
    return { error: "Approve the sales order before printing it." };
  }

  const supabase = await getSupabase();
  const [lineExtra, terms, methods, customer, packages, shipment, serials] = await Promise.all([
    supabase.from("so_lines").select("id, hts_code, eccn, so_line_allocations(id, alloc_no)").eq("sales_order_id", id),
    supabase.from("so_payment_terms").select("code, label").eq("code", order.terms).maybeSingle(),
    supabase.from("so_ship_methods").select("code, carrier, method").eq("code", order.shipMethod).maybeSingle(),
    order.customerId
      ? supabase.from("customers").select("primary_email, phone").eq("id", order.customerId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("so_packages").select("box_number, weight_lb, length_in, width_in, height_in").eq("sales_order_id", id).order("box_number"),
    supabase.from("so_shipments").select("awb").eq("sales_order_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    serialsByAllocation(id),
  ]);

  const compliance = new Map<string, { hts: string; eccn: string; serials: string[][] }>();
  if (!lineExtra.error) {
    for (const row of lineExtra.data ?? []) {
      const allocations = (Array.isArray(row.so_line_allocations) ? row.so_line_allocations : [])
        .slice()
        .sort((left, right) => Number(left.alloc_no ?? 0) - Number(right.alloc_no ?? 0));
      compliance.set(String(row.id), {
        hts: text(row.hts_code),
        eccn: text(row.eccn),
        serials: allocations.map((allocation) => serials.get(String(allocation.id)) ?? []),
      });
    }
  }

  const lines: CustomerDocumentLineInput[] = order.lines.map((line) => {
    const extra = compliance.get(line.id);
    return {
      customerPartNumber: line.customerPartNumber,
      customerDescription: line.customerDescription,
      qty: line.qty,
      unitPrice: line.unitPrice,
      extPrice: line.extPrice,
      htsCode: line.htsCode,
      eccn: line.eccn,
      condition: line.condition,
      lineNote: line.lineNote,
      allocations: line.allocations.map((allocation, index) => ({
        sku: allocation.sku,
        name: allocation.name,
        description: allocation.description,
        condition: allocation.condition,
        conditionNote: allocation.conditionNote,
        qty: allocation.qty,
        unitPrice: allocation.unitPrice,
        extPrice: allocation.extPrice,
        htsCode: allocation.usHts,
        eccn: allocation.eccn,
        serials: extra?.serials[index] ?? [],
      })),
    };
  });

  const foundMethod = methods.error ? null : methods.data;
  const columns = shippingColumns({
    method: text(foundMethod?.method) || order.shipMethod,
    carrier: text(foundMethod?.carrier),
    carrierAccount: order.carrierAccount,
  });
  const email = order.contactEmail.trim() || (customer.error ? "" : text(customer.data?.primary_email));
  const phone = order.contactPhone.trim() || order.shipTo.phone.trim() || (customer.error ? "" : text(customer.data?.phone));
  const shipTail = [order.contactName.trim(), phone, email].filter(Boolean);
  const document = buildCustomerDocument({
    kind,
    soNumber,
    documentDate: pacificToday(),
    orderDate: order.orderDate,
    salesRep: order.salesRep,
    paymentTerms: terms.error ? order.terms : text(terms.data?.label) || order.terms,
    incoterms: order.incoterms,
    shipMethod: columns.method,
    shipAccount: columns.account,
    orderRef: order.ebayOrderId || order.customerPo,
    tracking: shipment.error ? "" : text(shipment.data?.awb),
    customerName: order.customerName,
    billTo: order.billTo,
    shipTo: order.shipTo,
    shipTail,
    currency: order.currency || "USD",
    exportNotes: order.exportNotes,
    packages: packages.error
      ? []
      : (packages.data ?? []).map((box) => ({
          boxNumber: Number(box.box_number),
          weightLb: box.weight_lb == null ? null : Number(box.weight_lb),
          lengthIn: box.length_in == null ? null : Number(box.length_in),
          widthIn: box.width_in == null ? null : Number(box.width_in),
          heightIn: box.height_in == null ? null : Number(box.height_in),
        })),
    lines,
  });
  if (!document) return { error: "Approve the sales order before printing it." };
  return { document, orderId: order.id };
}

async function serialsByAllocation(orderId: string): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  const supabase = await getSupabase();
  const lists = await supabase.from("so_pick_lists").select("id").eq("sales_order_id", orderId);
  if (lists.error || (lists.data ?? []).length === 0) return found;
  const picks = await supabase
    .from("so_picks")
    .select("id, allocation_id")
    .in(
      "pick_list_id",
      (lists.data ?? []).map((row) => row.id),
    );
  if (picks.error || (picks.data ?? []).length === 0) return found;
  const units = await supabase
    .from("so_units")
    .select("pick_id, serial_number")
    .in(
      "pick_id",
      (picks.data ?? []).map((row) => row.id),
    );
  if (units.error) return found;
  const allocationByPick = new Map((picks.data ?? []).map((row) => [String(row.id), text(row.allocation_id)]));
  for (const unit of units.data ?? []) {
    const allocationId = allocationByPick.get(String(unit.pick_id));
    if (!allocationId) continue;
    const serial = text(unit.serial_number);
    if (!serial) continue;
    const list = found.get(allocationId) ?? [];
    list.push(serial);
    found.set(allocationId, list);
  }
  return found;
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}
