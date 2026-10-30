"use server";

import { fetchContact, updateContact } from "@/lib/contacts";
import { errorText } from "@/lib/errors";
import { salesOrderErrorMessage } from "@/lib/salesOrderErrors";
import type { PostalAddress } from "@/lib/qbo/map";
import {
  addressFromRecord,
  compareSalesOrderList,
  emptyAddress,
  formatSalesOrderNumber,
  lineExtension,
  hideSalesMoney,
  normalizeSalesDraftLines,
  salesOrderListReference,
  partMatches,
  partPrefix,
  salesOrderTotal,
  toSalesOrderPayload,
  withEbayShippingItem,
  type SoAddress,
  type SoDraftInput,
} from "@/lib/salesOrderDraft";
import { salesOperatorId, salesPageAccess } from "@/lib/salesSession";
import { loadSoAttachments, type SoAttachmentView } from "@/lib/soAttachments";
import { operatorInitials } from "@/lib/stockAccess";
import { EBAY_SHIPPING_ITEM_SKU } from "@/lib/ebay/orderMap";
import { mergeBlankContact, type OrderContact } from "@/lib/orderContact";
import { syncPaypalFeeLines } from "@/lib/paypalFee";
import { fetchPaypalFeeCatalog } from "@/lib/paypalFeeSettings";
import { parsePackLabel } from "@/lib/ebay/packs";
import { alnumContains } from "@/lib/itemAlnum";
import { itemIdsMatchingAlnum } from "@/lib/itemAlnumSearch";
import { itemIdsMatchingListQuery } from "@/lib/itemListSearch";
import { rankSalesItemHits, salesItemSearchTokens } from "@/lib/salesItemSearch";
import type { SalesOrderPickStatus } from "@/lib/salesOrderStages";
import { getSupabase } from "@/lib/supabase";

export type SalesCustomerHit = { id: string; name: string };

export type SalesSkuHit = {
  id: string;
  sku: string;
  name: string;
  partNumber: string;
  usHts: string;
  eccn: string;
  itemType?: string;
};

export type SalesLookups = {
  terms: { code: string; label: string }[];
  shipMethods: { code: string; label: string }[];
  channels: { code: string; label: string }[];
  paymentMethods: { code: string; label: string }[];
};

export type SalesCustomerDefaults = {
  id: string;
  name: string;
  billTo: SoAddress;
  shipTo: SoAddress;
  customerPo: string;
  reference: string;
  channel: string;
  orderDate: string;
  shipDate: string;
  terms: string;
  incoterms: string;
  shipMethod: string;
  carrierAccount: string;
  currency: string;
  salesRep: string;
};

export type SalesOrderListItem = {
  id: string;
  number: string;
  customerName: string;
  /** eBay order id, otherwise the customer PO. The internal reference is not shown. */
  orderReference: string;
  status: string;
  orderDate: string | null;
  shipDate: string | null;
  currency: string;
  total: number | null;
};

export type SalesAllocationView = {
  itemId: string;
  sku: string;
  name: string;
  /** items.description. Printed documents use this, not the item name. */
  description: string;
  /** items.condition. Printed on the invoice and order confirmation when set. */
  condition?: string;
  /** items.condition_note. Printed on the invoice and order confirmation when set. */
  conditionNote?: string;
  usHts: string;
  eccn: string;
  /** Product, Kit/Package, Service, or Non-inventory. Blank until the item is loaded. */
  itemType?: string;
  qty: string;
  unitPrice: string;
  extPrice: string;
  /** Fulfilled SKU. Empty when the planned item is what ships. */
  actualItemId?: string;
  actualSku?: string;
  actualName?: string;
  swapReason?: string;
};

export type SalesLineView = {
  id: string;
  lineKind: string;
  customerPartNumber: string;
  customerDescription: string;
  htsCode: string;
  eccn: string;
  lineNote: string;
  /** paypal on the auto-managed PayPal fee line. Blank on every other line. */
  managedFee: string;
  qty: string;
  unitPrice: string;
  extPrice: string;
  condition: string;
  allocations: SalesAllocationView[];
};

export type SalesNoteView = {
  kind: string;
  customerText: string;
  response: string;
  counterText: string;
};

export type SalesEventView = {
  event: string;
  operatorLabel: string;
  occurredAt: string;
  note: string;
};

export type SalesOrderView = {
  id: string;
  number: string | null;
  status: string;
  customerId: string;
  customerName: string;
  customerPo: string;
  reference: string;
  channel: string;
  orderDate: string;
  shipDate: string;
  billTo: SoAddress;
  shipTo: SoAddress;
  terms: string;
  incoterms: string;
  shipMethod: string;
  carrierAccount: string;
  currency: string;
  salesRep: string;
  exportNotes: string;
  internalNotes: string;
  paymentRequirement: string;
  paymentMethod: string;
  paymentDate: string;
  paymentRef: string;
  paymentAmount: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  ebayTransactionFee: string;
  ebayLabelFee: string;
  ebayAdFee: string;
  ebayOrderEarnings: string;
  ebayOrderId: string;
  ebaySalesRecordRef: string;
  buyerName: string;
  buyerUsername: string;
  lines: SalesLineView[];
  notes: SalesNoteView[];
  attachments: SoAttachmentView[];
  events: SalesEventView[];
  total: number | null;
};

const EDIT_DENIED = "You cannot change a sales order.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listSalesLookups(): Promise<SalesLookups> {
  const supabase = await getSupabase();
  const [terms, methods, channels, paymentMethods] = await Promise.all([
    supabase.from("so_payment_terms").select("code, label, sort_order").order("sort_order"),
    supabase.from("so_ship_methods").select("code, carrier, method, sort_order").order("sort_order"),
    supabase.from("so_channels").select("code, label, sort_order").order("sort_order"),
    supabase.from("so_payment_methods").select("code, label, sort_order").order("sort_order"),
  ]);
  if (terms.error) throw new Error(salesError(terms.error));
  if (methods.error) throw new Error(salesError(methods.error));
  if (channels.error) throw new Error(salesError(channels.error));
  if (paymentMethods.error) throw new Error(salesError(paymentMethods.error));
  return {
    terms: (terms.data ?? []).map((row) => ({ code: String(row.code), label: String(row.label) })),
    channels: (channels.data ?? []).map((row) => ({ code: String(row.code), label: String(row.label) })),
    paymentMethods: (paymentMethods.data ?? []).map((row) => ({ code: String(row.code), label: String(row.label) })),
    shipMethods: (methods.data ?? []).map((row) => {
      const carrier = String(row.carrier ?? "");
      const method = String(row.method ?? "");
      return { code: String(row.code), label: carrier === method ? carrier : `${carrier} ${method}`.trim() };
    }),
  };
}

export async function searchSalesCustomers(query: string): Promise<SalesCustomerHit[]> {
  const needle = query.trim().replace(/[%_,]/g, "");
  if (needle.length < 1) return [];
  const pattern = `%${needle}%`;
  const { data, error } = await (await getSupabase())
    .from("customers")
    .select("id, display_name")
    .eq("active", true)
    .is("merged_into_customer_id", null)
    .or(`display_name.ilike.${pattern},company_name.ilike.${pattern}`)
    .order("display_name")
    .limit(20);
  if (error) throw new Error(salesError(error));
  return (data ?? []).map((row) => ({ id: String(row.id), name: String(row.display_name ?? "") }));
}

export async function salesCustomerDefaults(customerId: string): Promise<SalesCustomerDefaults | null> {
  if (!UUID.test(customerId)) return null;
  const contact = await fetchContact("customer", customerId);
  if (!contact || !contact.active) return null;
  const { data, error } = await (await getSupabase())
    .from("sales_orders")
    .select("customer_po, reference, channel, order_date, ship_date, terms, incoterms, ship_method, carrier_account, currency, sales_rep")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(salesError(error));
  const billTo = addressFromRecord(contact.billingAddress);
  const shipSource = contact.shippingAddress.line1 ? contact.shippingAddress : contact.billingAddress;
  const shipTo = addressFromRecord(shipSource);
  shipTo.phone = contact.phone;
  return {
    id: contact.id,
    name: contact.displayName,
    billTo,
    shipTo,
    customerPo: text(data?.customer_po),
    reference: text(data?.reference),
    channel: text(data?.channel),
    orderDate: dateValue(data?.order_date) ?? "",
    shipDate: dateValue(data?.ship_date) ?? "",
    terms: text(data?.terms),
    incoterms: text(data?.incoterms),
    shipMethod: text(data?.ship_method),
    carrierAccount: text(data?.carrier_account),
    currency: text(data?.currency) || "USD",
    salesRep: text(data?.sales_rep),
  };
}

export async function suggestSalesSkus(part: string): Promise<SalesSkuHit[]> {
  const term = (parsePackLabel(part)?.baseSku ?? part).trim();
  const compact = partPrefix(term);
  if (compact.length < 3) return [];
  const raw = term.replace(/[%_,]/g, "");
  if (!raw) return [];
  const pattern = `%${raw}%`;
  const compactPattern = `%${compact}%`;
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("items")
    .select("id, sku, name, part_number, oem_part_number, us_hts, eccn, item_type")
    .or(
      [
        `part_number.ilike.${pattern}`,
        `oem_part_number.ilike.${pattern}`,
        `sku.ilike.${pattern}`,
        `part_number.ilike.${compactPattern}`,
        `oem_part_number.ilike.${compactPattern}`,
        `sku.ilike.${compactPattern}`,
      ].join(","),
    )
    .limit(40);
  if (error) {
    if (/part_number|oem_part_number|column/i.test(errorText(error))) return [];
    throw new Error(salesError(error));
  }
  const ilikeRows = [...(data ?? [])];
  const seen = new Set(ilikeRows.map((row) => String(row.id)));
  const alnumIds = await itemIdsMatchingAlnum(supabase, term, {
    columns: ["sku", "part_number", "oem_part_number"],
    limit: 40,
  });
  const missing = alnumIds.filter((id) => !seen.has(id));
  const extraRows: typeof ilikeRows = [];
  if (missing.length > 0) {
    const extra = await supabase.from("items").select("id, sku, name, part_number, oem_part_number, us_hts, eccn, item_type").in("id", missing);
    if (extra.error) throw new Error(salesError(extra.error));
    extraRows.push(...(extra.data ?? []));
  }
  const rows = [...extraRows, ...ilikeRows];
  return rows
    .filter((row) => salesSkuRowMatches(term, row))
    .slice(0, 8)
    .map((row) => ({
      id: String(row.id),
      sku: String(row.sku ?? ""),
      name: String(row.name ?? ""),
      partNumber: String(row.part_number ?? row.oem_part_number ?? ""),
      usHts: text(row.us_hts),
      eccn: text(row.eccn),
      itemType: text(row.item_type),
    }));
}

function salesSkuRowMatches(
  term: string,
  row: { sku?: unknown; part_number?: unknown; oem_part_number?: unknown },
): boolean {
  const fields = [String(row.part_number ?? ""), String(row.oem_part_number ?? ""), String(row.sku ?? "")];
  return fields.some((field) => partMatches(term, field) || alnumContains(field, term));
}

export type SalesItemSearch = { ok: true; hits: SalesSkuHit[] } | { ok: false; message: string };

/** Find SKU. Same matches as the items page, plus the longest word in the query. */
export async function searchSalesItems(query: string): Promise<SalesItemSearch> {
  try {
    const tokens = salesItemSearchTokens(query);
    if (tokens.length === 0) return { ok: true, hits: [] };
    const supabase = await getSupabase();
    const idLists = await Promise.all(tokens.map((token) => itemIdsMatchingListQuery(supabase, token, { perSourceLimit: 40 })));
    const ids = [...new Set(idLists.flatMap((list) => list ?? []))].slice(0, 120);
    if (ids.length === 0) return { ok: true, hits: [] };
    const { data, error } = await supabase.from("items").select("id, sku, name, part_number, oem_part_number, us_hts, eccn, item_type").in("id", ids);
    if (error) throw new Error(salesError(error));
    const hits = (data ?? []).map((row) => {
      const part = String(row.part_number ?? "");
      const oem = String(row.oem_part_number ?? "");
      const needles = tokens.map((token) => token.toLowerCase());
      const fieldHit = (value: string, needle: string) => value.toLowerCase().includes(needle) || alnumContains(value, needle);
      const partHit = needles.some((needle) => fieldHit(part, needle));
      const oemHit = needles.some((needle) => fieldHit(oem, needle));
      return {
        id: String(row.id),
        sku: String(row.sku ?? ""),
        name: String(row.name ?? ""),
        partNumber: oemHit && !partHit ? oem : part || oem,
        usHts: text(row.us_hts),
        eccn: text(row.eccn),
        itemType: text(row.item_type),
      };
    });
    return { ok: true, hits: rankSalesItemHits(tokens, hits) };
  } catch (error) {
    return { ok: false, message: salesOrderErrorMessage(error) };
  }
}

export async function listSalesOrders(scope: "drafts" | "all" = "drafts"): Promise<SalesOrderListItem[]> {
  const access = await salesPageAccess();
  let query = (await getSupabase())
    .from("sales_orders")
    .select(
      "id, so_number, status, order_date, ship_date, currency, customer_po, reference, ebay_order_id, created_at, customers(display_name), so_lines(ext_price)",
    )
    .order("order_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (scope === "drafts") query = query.eq("status", "draft");
  const { data, error } = await query;
  if (error) throw new Error(salesError(error));
  const rows = [...(data ?? [])].sort((left, right) =>
    compareSalesOrderList(
      { orderDate: dateValue(left.order_date), createdAt: String(left.created_at ?? "") },
      { orderDate: dateValue(right.order_date), createdAt: String(right.created_at ?? "") },
    ),
  );
  return rows.map((row) => {
    const customer = firstRelation(row.customers);
    const lines = (Array.isArray(row.so_lines) ? row.so_lines : []).map((line) => ({
      extPrice: line.ext_price == null ? "" : Number(line.ext_price).toFixed(2),
    }));
    const item = hideSalesMoney(
      {
        id: String(row.id),
        number: formatSalesOrderNumber(row.so_number) ?? "Draft",
        customerName: String(customer?.display_name ?? ""),
        orderReference: salesOrderListReference({
          ebayOrderId: text(row.ebay_order_id),
          customerPo: text(row.customer_po),
        }),
        status: String(row.status),
        orderDate: dateValue(row.order_date),
        shipDate: dateValue(row.ship_date),
        currency: text(row.currency) || "USD",
        total: salesOrderTotal(lines),
      },
      access.canViewMoney,
    );
    return item;
  });
}

const ORDER_HEAD =
  "id, so_number, status, customer_id, customer_po, reference, channel, order_date, ship_date, bill_to, ship_to, terms, incoterms, ship_method, carrier_account, currency, sales_rep, export_notes, internal_notes, payment_requirement, payment_method, payment_date, payment_ref";

function salesOrderSelect(
  withPayment: boolean,
  withAllocPrice: boolean,
  withLineNote: boolean,
  withReplacement: boolean,
  withManagedFee: boolean,
  withContact: boolean,
): string {
  const payment = withPayment ? ", payment_amount" : "";
  const contact = withContact ? ", contact_name, contact_email, contact_phone" : "";
  const note = withLineNote ? ", line_note" : "";
  const managed = withManagedFee ? ", managed_fee" : "";
  const item = "sku, name, description, condition, condition_note, us_hts, eccn, item_type";
  // actual_item_id is a second FK to items. A bare items(...) embed is ambiguous.
  const plannedItem = `items!so_line_allocations_item_id_fkey(${item})`;
  const replacement = withReplacement
    ? ", actual_item_id, swap_reason, actual:items!so_line_allocations_actual_item_id_fkey(sku, name)"
    : "";
  const allocations = withAllocPrice
    ? `so_line_allocations(item_id, qty, unit_price, ext_price, alloc_no${replacement}, ${plannedItem})`
    : `so_line_allocations(item_id, qty${replacement}, ${plannedItem})`;
  return `${ORDER_HEAD}${contact}${payment}, ebay_order_id, ebay_sales_record_ref, buyer, ebay_transaction_fee, ebay_label_fee, ebay_ad_fee, ebay_order_earnings, customers(display_name), so_lines(id, line_no, line_kind, customer_part_number, customer_description, qty, unit_price, ext_price, condition, hts_code, eccn${note}${managed}, ${allocations}), so_customer_notes(kind, customer_text, response, counter_text, created_at), so_events(event, operator_label, occurred_at, note)`;
}

function missingColumn(error: { message?: string } | null, column: string): boolean {
  if (!error?.message) return false;
  return new RegExp(column, "i").test(error.message) && /schema cache|could not find|does not exist/i.test(error.message);
}

/** Latest pick list that was not cancelled. Null when picking has not started, or the table is not there yet. */
export async function loadSalesOrderPickStatus(orderId: string): Promise<SalesOrderPickStatus> {
  if (!UUID.test(orderId)) return null;
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("so_pick_lists")
      .select("status")
      .eq("sales_order_id", orderId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data?.length) return null;
    const status = String(data[0].status);
    if (status === "open" || status === "picked" || status === "short") return status;
    return null;
  } catch {
    return null;
  }
}

export async function loadSalesOrder(id: string): Promise<SalesOrderView | null> {
  if (!UUID.test(id)) return null;
  const access = await salesPageAccess();
  const supabase = await getSupabase();
  let withPayment = true;
  let withAllocPrice = true;
  let withLineNote = true;
  let withReplacement = true;
  let withManagedFee = true;
  let withContact = true;
  const loadOrder = () =>
    supabase
      .from("sales_orders")
      .select(salesOrderSelect(withPayment, withAllocPrice, withLineNote, withReplacement, withManagedFee, withContact))
      .eq("id", id)
      .maybeSingle();
  let loaded: { data: any; error: { message?: string } | null } = await loadOrder();
  for (let attempt = 0; attempt < 7 && loaded.error; attempt += 1) {
    const message = loaded.error.message ?? "";
    if (withPayment && missingColumn(loaded.error, "payment_amount")) withPayment = false;
    else if (withContact && (missingColumn(loaded.error, "contact_name") || missingColumn(loaded.error, "contact_email") || missingColumn(loaded.error, "contact_phone")))
      withContact = false;
    else if (withManagedFee && missingColumn(loaded.error, "managed_fee")) withManagedFee = false;
    else if (withLineNote && missingColumn(loaded.error, "line_note")) withLineNote = false;
    else if (
      withReplacement &&
      (/more than one relationship|ambiguous/i.test(message) ||
        (/actual_item_id|so_line_allocations_actual_item_id_fkey/i.test(message) &&
          /schema cache|could not find|does not exist|relationship/i.test(message)))
    ) {
      withReplacement = false;
    } else if (
      withAllocPrice &&
      /so_line_allocations/i.test(message) &&
      /unit_price|ext_price|alloc_no/i.test(message) &&
      /schema cache|could not find|does not exist/i.test(message)
    ) {
      withAllocPrice = false;
    } else break;
    loaded = await loadOrder();
  }
  if (loaded.error) throw new Error(salesError(loaded.error));
  const data = loaded.data ? { ...loaded.data, payment_amount: loaded.data.payment_amount ?? null } : null;
  if (!data) return null;

  const customer = firstRelation(data.customers);
  const lines = ((Array.isArray(data.so_lines) ? data.so_lines : []) as any[])
    .slice()
    .sort((a, b) => Number(a.line_no) - Number(b.line_no))
    .map((line) => {
      const visible = hideSalesMoney(
        {
          unitPrice: line.unit_price == null ? "" : formatPrice(line.unit_price),
          extPrice: line.ext_price == null ? "" : Number(line.ext_price).toFixed(2),
        },
        access.canViewMoney,
      );
      const allocations = ((Array.isArray(line.so_line_allocations) ? line.so_line_allocations : []) as any[])
        .slice()
        .sort(
          (left, right) =>
            Number(left.alloc_no ?? 0) - Number(right.alloc_no ?? 0) || String(left.item_id).localeCompare(String(right.item_id)),
        )
        .map((row) => {
          const item = firstRelation(row.items);
          const qty = formatQty(row.qty);
          let unitPrice = row.unit_price == null ? "" : formatPrice(row.unit_price);
          let extPrice = row.ext_price == null ? "" : Number(row.ext_price).toFixed(2);
          if (!unitPrice && visible.unitPrice) {
            unitPrice = visible.unitPrice;
            extPrice = lineExtension(qty, unitPrice) ?? "";
          } else if (unitPrice && !extPrice) {
            extPrice = lineExtension(qty, unitPrice) ?? "";
          }
          if (!access.canViewMoney) {
            unitPrice = "";
            extPrice = "";
          }
          const actual = firstRelation(row.actual);
          const actualId = row.actual_item_id ? String(row.actual_item_id) : "";
          return {
            itemId: String(row.item_id),
            sku: String(item?.sku ?? ""),
            name: String(item?.name ?? ""),
            description: String(item?.description ?? ""),
            condition: text(item?.condition),
            conditionNote: text(item?.condition_note),
            usHts: text(item?.us_hts),
            eccn: text(item?.eccn),
            itemType: text(item?.item_type),
            qty,
            unitPrice,
            extPrice,
            actualItemId: actualId && actualId !== String(row.item_id) ? actualId : "",
            actualSku: String(actual?.sku ?? ""),
            actualName: String(actual?.name ?? ""),
            swapReason: text(row.swap_reason),
          };
        });
      return {
        id: text(line.id),
        lineKind: text(line.line_kind) || "product",
        customerPartNumber: text(line.customer_part_number),
        customerDescription: text(line.customer_description),
        htsCode: text(line.hts_code),
        eccn: text(line.eccn),
        lineNote: text(line.line_note),
        managedFee: text(line.managed_fee),
        qty: formatQty(line.qty),
        unitPrice: visible.unitPrice,
        extPrice: visible.extPrice,
        condition: text(line.condition),
        allocations,
      };
    });

  const notes = ((Array.isArray(data.so_customer_notes) ? data.so_customer_notes : []) as any[])
    .slice()
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
    .map((note) => ({
      kind: text(note.kind) || "other",
      customerText: text(note.customer_text),
      response: text(note.response),
      counterText: text(note.counter_text),
    }));

  const events = ((Array.isArray(data.so_events) ? data.so_events : []) as any[])
    .slice()
    .sort((a, b) => String(b.occurred_at ?? "").localeCompare(String(a.occurred_at ?? "")))
    .map((event) => ({
      event: text(event.event),
      operatorLabel: text(event.operator_label),
      occurredAt: text(event.occurred_at),
      note: text(event.note),
    }));

  const shown = hideSalesMoney(
    {
      internalNotes: text(data.internal_notes),
      total: salesOrderTotal(lines),
      ebayTransactionFee: moneyText(data.ebay_transaction_fee),
      ebayLabelFee: moneyText(data.ebay_label_fee),
      ebayAdFee: moneyText(data.ebay_ad_fee),
      ebayOrderEarnings: moneyText(data.ebay_order_earnings),
      paymentAmount: moneyText(data.payment_amount),
    },
    access.canViewMoney,
  );

  return {
    id: String(data.id),
    number: formatSalesOrderNumber(data.so_number),
    status: String(data.status),
    customerId: String(data.customer_id ?? ""),
    customerName: String(customer?.display_name ?? ""),
    customerPo: text(data.customer_po),
    reference: text(data.reference),
    channel: text(data.channel),
    orderDate: dateValue(data.order_date) ?? "",
    shipDate: dateValue(data.ship_date) ?? "",
    billTo: addressFromRecord(data.bill_to),
    shipTo: addressFromRecord(data.ship_to),
    terms: text(data.terms),
    incoterms: text(data.incoterms),
    shipMethod: text(data.ship_method),
    carrierAccount: text(data.carrier_account),
    currency: text(data.currency) || "USD",
    salesRep: text(data.sales_rep),
    exportNotes: text(data.export_notes),
    internalNotes: shown.internalNotes,
    paymentRequirement: text(data.payment_requirement) || "terms",
    paymentMethod: text(data.payment_method),
    paymentDate: dateValue(data.payment_date) ?? "",
    paymentRef: text(data.payment_ref),
    paymentAmount: shown.paymentAmount,
    contactName: text(data.contact_name),
    contactEmail: text(data.contact_email),
    contactPhone: text(data.contact_phone),
    ebayTransactionFee: shown.ebayTransactionFee,
    ebayLabelFee: shown.ebayLabelFee,
    ebayAdFee: shown.ebayAdFee,
    ebayOrderEarnings: shown.ebayOrderEarnings,
    ebayOrderId: text(data.ebay_order_id),
    ebaySalesRecordRef: text(data.ebay_sales_record_ref),
    buyerName: buyerNames(data.buyer).name,
    buyerUsername: buyerNames(data.buyer).username,
    lines,
    notes,
    attachments: await loadSoAttachments(String(data.id)),
    events,
    total: shown.total,
  };
}

async function itemIdForSku(sku: string): Promise<string | null> {
  const { data, error } = await (await getSupabase()).from("items").select("id, sku").ilike("sku", sku).limit(5);
  if (error) throw new Error(error.message);
  const wanted = sku.trim().toLowerCase();
  const hit = (data ?? []).find((row) => String(row.sku ?? "").trim().toLowerCase() === wanted);
  return hit ? String(hit.id) : null;
}

async function salesOrderIsEbay(input: SoDraftInput): Promise<boolean> {
  if (input.channel.trim().toLowerCase() === "ebay") return true;
  if (!input.id || !UUID.test(input.id)) return false;
  const { data, error } = await (await getSupabase())
    .from("sales_orders")
    .select("source, channel, ebay_order_id, ebay_sales_record_ref")
    .eq("id", input.id)
    .maybeSingle();
  if (error || !data) return false;
  return (
    data.source === "ebay" ||
    data.channel === "ebay" ||
    text(data.ebay_order_id) !== "" ||
    text(data.ebay_sales_record_ref) !== ""
  );
}

/**
 * Inserts one allocation on a draft or approved line that has none.
 * Does not rewrite the order and does not write an so_events row, so an eBay pull can still refresh the draft.
 * operator_id stays null.
 */
export async function saveEmptyLineAllocation(input: {
  lineId: string;
  itemId: string;
  qty: string;
  unitPrice?: string;
}): Promise<void> {
  const access = await salesPageAccess();
  if (!access.canEdit) throw new Error(EDIT_DENIED);
  if (!UUID.test(input.lineId) || !UUID.test(input.itemId)) return;
  const qty = Number(input.qty);
  if (!(qty > 0)) return;
  const supabase = await getSupabase();
  const line = await supabase.from("so_lines").select("id, sales_order_id").eq("id", input.lineId).maybeSingle();
  if (line.error) throw new Error(salesError(line.error));
  if (!line.data?.sales_order_id) return;
  const order = await supabase.from("sales_orders").select("status").eq("id", line.data.sales_order_id).maybeSingle();
  if (order.error) throw new Error(salesError(order.error));
  if (order.data?.status !== "draft" && order.data?.status !== "approved") return;
  const existing = await supabase.from("so_line_allocations").select("id").eq("so_line_id", input.lineId).limit(1);
  if (existing.error) throw new Error(salesError(existing.error));
  if ((existing.data ?? []).length > 0) return;
  const row: Record<string, unknown> = {
    so_line_id: input.lineId,
    item_id: input.itemId,
    qty,
    alloc_no: 1,
    operator_id: null,
  };
  const unit = Number(input.unitPrice);
  if (input.unitPrice && input.unitPrice.trim() && Number.isFinite(unit) && unit >= 0) {
    row.unit_price = unit;
    row.ext_price = Math.round(qty * unit * 100) / 100;
  }
  const inserted = await supabase.from("so_line_allocations").insert(row);
  if (!inserted.error) return;
  const message = inserted.error.message ?? "";
  if (/unit_price|ext_price|alloc_no/i.test(message) && /schema cache|could not find|does not exist/i.test(message)) {
    const retry = await supabase.from("so_line_allocations").insert({
      so_line_id: input.lineId,
      item_id: input.itemId,
      qty,
      operator_id: null,
    });
    if (retry.error) throw new Error(salesError(retry.error));
    return;
  }
  throw new Error(salesError(inserted.error));
}

/** Freight lines on an eBay order keep an allocation to item 4343 when the form did not send one. */
async function attachEbayShipping(input: SoDraftInput): Promise<SoDraftInput> {
  const missing = input.lines.some(
    (line) => (line.lineKind || "product") === "freight" && !line.allocations.some((row) => row.itemId && Number(row.qty) > 0),
  );
  if (!missing || !(await salesOrderIsEbay(input))) return input;
  const itemId = await itemIdForSku(EBAY_SHIPPING_ITEM_SKU);
  if (!itemId) throw new Error("eBay shipping could not be allocated to item 4343.");
  return { ...input, lines: withEbayShippingItem(input.lines, itemId, true) };
}

export async function saveSalesOrder(input: SoDraftInput): Promise<{ id: string; addressWarning: string | null }> {
  const access = await salesPageAccess();
  if (!access.canEdit || !access.canViewMoney) throw new Error(EDIT_DENIED);
  const draft = meaningfulDraft(input);
  if (!UUID.test(draft.customerId)) throw new Error("Choose a customer.");
  const rep = draft.salesRep.trim().toUpperCase();
  if (rep && !/^[A-Z]{2}$/.test(rep)) throw new Error("Sales rep initials are 2 letters.");
  for (const line of draft.lines) {
    const hasSku = line.allocations.some((row) => row.itemId);
    const hasText = Boolean(line.customerPartNumber.trim() || line.customerDescription.trim());
    if (!hasText && !hasSku) throw new Error("Enter a part number or a description.");
    if (hasSku && line.allocations.some((row) => row.itemId && !(Number(row.qty) > 0))) {
      throw new Error("Enter a quantity above 0.");
    }
    if (!(Number(line.qty) > 0)) throw new Error("Enter a quantity above 0.");
  }
  for (const note of draft.notes) {
    if (note.response === "countered" && !note.counterText.trim()) throw new Error("Enter the counter text.");
  }
  for (const amount of [draft.ebayTransactionFee, draft.ebayLabelFee, draft.ebayAdFee, draft.ebayOrderEarnings, draft.paymentAmount]) {
    if (amount.trim() && !/^-?[0-9]+(\.[0-9]+)?$/.test(amount.trim())) throw new Error("Enter a valid amount.");
  }

  const persisted = access.canViewMoney ? draft : { ...draft, internalNotes: input.id ? await readInternalNotes(input.id) : "" };
  const allocated = await attachEbayShipping(persisted);
  const ebay = await salesOrderIsEbay(allocated);
  if (!ebay && allocated.paymentMethod.trim().toLowerCase() === "ebay") {
    throw new Error("eBay is only for an eBay order.");
  }
  const method = ebay ? "ebay" : allocated.paymentMethod;
  const paypal = method.trim().toLowerCase() === "paypal";
  const fees = syncPaypalFeeLines(allocated.lines, {
    paymentMethod: method,
    shipCountry: allocated.shipTo.country,
    billCountry: allocated.billTo.country,
    catalog: paypal ? await fetchPaypalFeeCatalog() : null,
    createLine: (previous, item, unitPrice) => ({
      lineKind: "fee",
      managedFee: "paypal",
      customerPartNumber: item.sku,
      customerDescription: item.description.trim() || item.name || "PayPal fee",
      lineNote: previous?.lineNote ?? "",
      qty: "1",
      unitPrice,
      condition: previous?.condition ?? "",
      allocations: [{ itemId: item.id, qty: "1", unitPrice }],
    }),
  });
  if (fees.error) throw new Error(fees.error);
  if (method.trim()) {
    const knownMethod = await (await getSupabase()).from("so_payment_methods").select("code").eq("code", method.trim()).maybeSingle();
    if (knownMethod.error) throw new Error(salesError(knownMethod.error));
    if (!knownMethod.data) {
      throw new Error("Apply supabase/migrations/20261029010000_sales_order_paypal_fee.sql before using this payment method.");
    }
  }
  const stored = {
    ...allocated,
    paymentMethod: method,
    billTo: ebay ? emptyAddress() : allocated.billTo,
    contactName: ebay ? "" : allocated.contactName.trim(),
    contactEmail: ebay ? "" : allocated.contactEmail.trim(),
    contactPhone: ebay ? "" : allocated.contactPhone.trim(),
    lines: fees.lines,
  };
  const { data, error } = await (await getSupabase()).rpc("write_sales_order", {
    p_payload: toSalesOrderPayload(stored),
    p_initials: await operatorInitials(),
    p_operator_id: await salesOperatorId(),
  });
  if (error) throw new Error(salesError(error));
  const id = rpcId(data);
  const addressWarning = input.saveAddressToCustomer ? await saveAddressToCustomer(stored, ebay) : null;
  return { id, addressWarning };
}

export async function suggestSalesOrderNumber(): Promise<number> {
  const { data, error } = await (await getSupabase()).rpc("suggest_sales_order_number");
  if (error) throw new Error(salesError(error));
  const numeric = Number(data);
  if (!Number.isSafeInteger(numeric) || numeric < 1) throw new Error("Could not suggest a sales order number.");
  return numeric;
}

export type SalesSave =
  | { ok: true; id: string; addressWarning: string | null }
  | { ok: false; message: string };

const CONTACT_EDITABLE = new Set(["draft", "approved", "picking"]);

/** Fills a blank contact on a non-eBay order. A value already stored stays. */
export async function fillBlankOrderContact(orderId: string, found: OrderContact): Promise<OrderContact> {
  const access = await salesPageAccess();
  if (!access.canEdit || !UUID.test(orderId)) return found;
  const supabase = await getSupabase();
  const loaded = await supabase
    .from("sales_orders")
    .select("status, source, channel, ebay_order_id, ebay_sales_record_ref, contact_name, contact_email, contact_phone")
    .eq("id", orderId)
    .maybeSingle();
  if (loaded.error) {
    if (
      missingColumn(loaded.error, "contact_name") ||
      missingColumn(loaded.error, "contact_email") ||
      missingColumn(loaded.error, "contact_phone")
    ) {
      return found;
    }
    throw new Error(salesError(loaded.error));
  }
  const row = loaded.data;
  if (!row) return found;
  const ebay =
    row.source === "ebay" ||
    row.channel === "ebay" ||
    text(row.ebay_order_id) !== "" ||
    text(row.ebay_sales_record_ref) !== "";
  if (ebay || !CONTACT_EDITABLE.has(String(row.status))) return found;
  const current = { person: text(row.contact_name), email: text(row.contact_email), phone: text(row.contact_phone) };
  const merged = mergeBlankContact(current, found);
  if (merged.person === current.person && merged.email === current.email && merged.phone === current.phone) return merged;
  const updated = await supabase
    .from("sales_orders")
    .update({
      contact_name: merged.person || null,
      contact_email: merged.email || null,
      contact_phone: merged.phone || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (updated.error) {
    if (missingColumn(updated.error, "contact_name")) return merged;
    throw new Error(salesError(updated.error));
  }
  return merged;
}

/** Save a draft. Failures are returned so production does not replace them with the digest page. */
export async function saveSalesOrderForForm(input: SoDraftInput): Promise<SalesSave> {
  try {
    const saved = await saveSalesOrder(input);
    return { ok: true, id: saved.id, addressWarning: saved.addressWarning };
  } catch (error) {
    return { ok: false, message: salesOrderErrorMessage(error) };
  }
}

export type SalesApproval =
  | { ok: true; id: string; soNumber: string; addressWarning: string | null }
  | { ok: false; message: string };

/**
 * Save, then approve. Expected failures are returned as `message`.
 * Throwing them would cross the server-action boundary, and production
 * replaces that text with the generic Server Components digest.
 */
export async function approveSalesOrderFromDraft(input: SoDraftInput, soNumber: number): Promise<SalesApproval> {
  try {
    const saved = await saveSalesOrder(input);
    const approved = await approveSalesOrder(saved.id, soNumber);
    return { ok: true, id: saved.id, soNumber: approved.soNumber, addressWarning: saved.addressWarning };
  } catch (error) {
    return { ok: false, message: salesOrderErrorMessage(error) };
  }
}

export async function approveSalesOrder(id: string, soNumber: number): Promise<{ soNumber: string }> {
  const access = await salesPageAccess();
  if (!access.canEdit || !access.canViewMoney) throw new Error(EDIT_DENIED);
  if (!UUID.test(id)) throw new Error("Sales order not found.");
  if (!Number.isSafeInteger(soNumber) || soNumber < 1) throw new Error("Enter a sales order number.");
  const { data, error } = await (await getSupabase()).rpc("approve_sales_order", {
    p_order: id,
    p_initials: await operatorInitials(),
    p_operator_id: await salesOperatorId(),
    p_number: soNumber,
  });
  if (error) throw new Error(salesError(error));
  const row = rpcRow(data);
  return { soNumber: formatSalesOrderNumber(row.so_number) ?? "" };
}

export async function cancelSalesOrder(id: string): Promise<void> {
  const access = await salesPageAccess();
  if (!access.canEdit) throw new Error(EDIT_DENIED);
  if (!UUID.test(id)) throw new Error("Sales order not found.");
  const { error } = await (await getSupabase()).rpc("cancel_sales_order", {
    p_order: id,
    p_initials: await operatorInitials(),
    p_operator_id: await salesOperatorId(),
  });
  if (error) throw new Error(salesError(error));
}

function meaningfulDraft(input: SoDraftInput): SoDraftInput {
  return {
    ...input,
    salesRep: input.salesRep.trim().toUpperCase(),
    lines: normalizeSalesDraftLines(input.lines),
    notes: input.notes.filter((note) => note.customerText.trim()),
  };
}

async function saveAddressToCustomer(input: SoDraftInput, ebay: boolean): Promise<string | null> {
  try {
    const contact = await fetchContact("customer", input.customerId);
    if (!contact) return "The order was saved. The customer record was not found, so the address was not saved.";
    const shipping = postalFrom(input.shipTo, true);
    await updateContact(
      "customer",
      contact.id,
      {
        displayName: contact.displayName,
        companyName: contact.companyName,
        givenName: contact.givenName,
        familyName: contact.familyName,
        primaryEmail: contact.primaryEmail,
        phone: input.shipTo.phone.trim() || contact.phone,
        billingAddress: ebay ? contact.billingAddress : postalFrom(input.billTo, false),
        shippingAddress: shipping,
        taxId: contact.taxId,
        notes: contact.notes,
        active: contact.active,
      },
      contact.qboId,
    );
    return null;
  } catch (error) {
    return `The order was saved. The customer address was not: ${errorText(error)}`;
  }
}

function postalFrom(address: SoAddress, attentionIntoLine2: boolean): PostalAddress {
  const line2 = address.line2.trim() || (attentionIntoLine2 ? address.attention.trim() : "");
  return {
    line1: address.line1.trim() || null,
    line2: line2 || null,
    city: address.city.trim() || null,
    countrySubDivisionCode: address.countrySubDivisionCode.trim() || null,
    postalCode: address.postalCode.trim() || null,
    country: address.country.trim() || null,
  };
}

async function readInternalNotes(id: string): Promise<string> {
  const { data, error } = await (await getSupabase()).from("sales_orders").select("internal_notes").eq("id", id).maybeSingle();
  if (error) throw new Error(salesError(error));
  return text(data?.internal_notes);
}

function salesError(error: { message?: string }): string {
  return salesOrderErrorMessage(error);
}

function rpcId(data: unknown): string {
  const row = rpcRow(data);
  if (!row.id) throw new Error("Sales order was not saved.");
  return String(row.id);
}

function rpcRow(data: unknown): { id?: string; so_number?: string } {
  const row = typeof data === "string" ? (JSON.parse(data) as { id?: string; so_number?: string }) : data;
  if (!row || typeof row !== "object") throw new Error("Sales order was not saved.");
  return row as { id?: string; so_number?: string };
}

function firstRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function buyerNames(value: unknown): { name: string; username: string } {
  if (!value || typeof value !== "object") return { name: "", username: "" };
  const row = value as { name?: unknown; username?: unknown };
  return {
    name: typeof row.name === "string" ? row.name : "",
    username: typeof row.username === "string" ? row.username : "",
  };
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function dateValue(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.slice(0, 10);
}

function formatQty(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  if (Number.isInteger(amount)) return String(amount);
  return amount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function moneyText(value: unknown): string {
  if (value == null || value === "") return "";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return amount.toFixed(2);
}

function formatPrice(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return amount.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
