"use server";

import { fetchContact, updateContact } from "@/lib/contacts";
import { errorText } from "@/lib/errors";
import type { PostalAddress } from "@/lib/qbo/map";
import {
  addressFromRecord,
  compareSalesOrderList,
  formatSalesOrderNumber,
  hideSalesMoney,
  salesOrderListReference,
  partMatches,
  partPrefix,
  salesOrderTotal,
  toSalesOrderPayload,
  type SoAddress,
  type SoDraftInput,
} from "@/lib/salesOrderDraft";
import { salesOperatorId, salesPageAccess } from "@/lib/salesSession";
import { loadSoAttachments, type SoAttachmentView } from "@/lib/soAttachments";
import { operatorInitials } from "@/lib/stockAccess";
import { parsePackLabel } from "@/lib/ebay/packs";
import { getSupabase } from "@/lib/supabase";

export type SalesCustomerHit = { id: string; name: string };

export type SalesSkuHit = { id: string; sku: string; name: string; partNumber: string };

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
  qty: string;
};

export type SalesLineView = {
  lineKind: string;
  customerPartNumber: string;
  customerDescription: string;
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
const MIGRATION = "Apply supabase/migrations/20261024070800_sales_orders.sql before using sales orders.";
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
  const { data, error } = await (await getSupabase())
    .from("items")
    .select("id, sku, name, part_number, oem_part_number")
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
  return (data ?? [])
    .filter(
      (row) =>
        partMatches(term, String(row.part_number ?? "")) ||
        partMatches(term, String(row.oem_part_number ?? "")) ||
        partMatches(term, String(row.sku ?? "")),
    )
    .slice(0, 8)
    .map((row) => ({
      id: String(row.id),
      sku: String(row.sku ?? ""),
      name: String(row.name ?? ""),
      partNumber: String(row.part_number ?? row.oem_part_number ?? ""),
    }));
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

export async function loadSalesOrder(id: string): Promise<SalesOrderView | null> {
  if (!UUID.test(id)) return null;
  const access = await salesPageAccess();
  const { data, error } = await (await getSupabase())
    .from("sales_orders")
    .select(
      "id, so_number, status, customer_id, customer_po, reference, channel, order_date, ship_date, bill_to, ship_to, terms, incoterms, ship_method, carrier_account, currency, sales_rep, export_notes, internal_notes, payment_requirement, payment_method, payment_date, payment_ref, ebay_order_id, ebay_sales_record_ref, buyer, ebay_transaction_fee, ebay_label_fee, ebay_ad_fee, ebay_order_earnings, customers(display_name), so_lines(line_no, line_kind, customer_part_number, customer_description, qty, unit_price, ext_price, condition, so_line_allocations(item_id, qty, items(sku, name))), so_customer_notes(kind, customer_text, response, counter_text, created_at), so_events(event, operator_label, occurred_at, note)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(salesError(error));
  if (!data) return null;

  const customer = firstRelation(data.customers);
  const lines = (Array.isArray(data.so_lines) ? data.so_lines : [])
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
      const allocations = (Array.isArray(line.so_line_allocations) ? line.so_line_allocations : []).map((row) => {
        const item = firstRelation(row.items);
        return {
          itemId: String(row.item_id),
          sku: String(item?.sku ?? ""),
          name: String(item?.name ?? ""),
          qty: formatQty(row.qty),
        };
      });
      return {
        lineKind: text(line.line_kind) || "product",
        customerPartNumber: text(line.customer_part_number),
        customerDescription: text(line.customer_description),
        qty: formatQty(line.qty),
        unitPrice: visible.unitPrice,
        extPrice: visible.extPrice,
        condition: text(line.condition),
        allocations,
      };
    });

  const notes = (Array.isArray(data.so_customer_notes) ? data.so_customer_notes : [])
    .slice()
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
    .map((note) => ({
      kind: text(note.kind) || "other",
      customerText: text(note.customer_text),
      response: text(note.response),
      counterText: text(note.counter_text),
    }));

  const events = (Array.isArray(data.so_events) ? data.so_events : [])
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

export async function saveSalesOrder(input: SoDraftInput): Promise<{ id: string; addressWarning: string | null }> {
  const access = await salesPageAccess();
  if (!access.canEdit || !access.canViewMoney) throw new Error(EDIT_DENIED);
  const draft = meaningfulDraft(input);
  if (!UUID.test(draft.customerId)) throw new Error("Choose a customer.");
  const rep = draft.salesRep.trim().toUpperCase();
  if (rep && !/^[A-Z]{2}$/.test(rep)) throw new Error("Sales rep initials are 2 letters.");
  for (const line of draft.lines) {
    if (!line.customerPartNumber.trim() && !line.customerDescription.trim()) {
      throw new Error("Enter a part number or a description.");
    }
    if (!(Number(line.qty) > 0)) throw new Error("Enter a quantity above 0.");
  }
  for (const note of draft.notes) {
    if (note.response === "countered" && !note.counterText.trim()) throw new Error("Enter the counter text.");
  }
  for (const amount of [draft.ebayTransactionFee, draft.ebayLabelFee, draft.ebayAdFee, draft.ebayOrderEarnings]) {
    if (amount.trim() && !/^-?[0-9]+(\.[0-9]+)?$/.test(amount.trim())) throw new Error("Enter a valid amount.");
  }

  const persisted = access.canViewMoney ? draft : { ...draft, internalNotes: input.id ? await readInternalNotes(input.id) : "" };
  const { data, error } = await (await getSupabase()).rpc("write_sales_order", {
    p_payload: toSalesOrderPayload(persisted),
    p_initials: await operatorInitials(),
    p_operator_id: await salesOperatorId(),
  });
  if (error) throw new Error(salesError(error));
  const id = rpcId(data);
  const addressWarning = input.saveAddressToCustomer ? await saveAddressToCustomer(draft) : null;
  return { id, addressWarning };
}

export async function suggestSalesOrderNumber(): Promise<number> {
  const { data, error } = await (await getSupabase()).rpc("suggest_sales_order_number");
  if (error) throw new Error(salesError(error));
  const numeric = Number(data);
  if (!Number.isSafeInteger(numeric) || numeric < 1) throw new Error("Could not suggest a sales order number.");
  return numeric;
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
    lines: input.lines.filter(
      (line) =>
        line.customerPartNumber.trim() ||
        line.customerDescription.trim() ||
        line.allocations.some((row) => row.itemId),
    ),
    notes: input.notes.filter((note) => note.customerText.trim()),
  };
}

async function saveAddressToCustomer(input: SoDraftInput): Promise<string | null> {
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
        billingAddress: postalFrom(input.billTo, false),
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
  const textValue = errorText(error);
  if (/schema cache|does not exist|Could not find/i.test(textValue) && /sales_order|so_|customers/i.test(textValue)) {
    return MIGRATION;
  }
  const match = textValue.match(
    /Choose a customer\.|Choose a channel\.|Choose a payment method\.|Enter a valid amount\.|Enter a payment date\.|Sales rep initials are 2 letters\.|That sales order can no longer be edited\.|Sales order not found\.|Enter a quantity above 0\.|Only a draft can be approved\.|Enter the order date\.|Enter a bill-to address\.|Enter a ship-to address\.|Choose terms\.|Choose a ship method\.|Enter the sales rep initials\.|Enter a sales order number\.|Add a line before approving\.|Line \d+ must be allocated to SKUs that add up to the quantity\.|Sales order number SO\d+ is already used\.|That sales order is already \w+\./,
  );
  if (match) return match[0];
  if (textValue.includes("so_lines_text_check")) return "Enter a part number or a description.";
  if (textValue.includes("so_customer_notes_counter_check")) return "Enter the counter text.";
  if (textValue.includes("so_line_allocations_item_id_fkey")) return "Choose a SKU from the suggestions.";
  return textValue;
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
