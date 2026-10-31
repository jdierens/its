import { alnumFieldContains, alnumQueryAlternatives } from "@/lib/itemAlnum";
import { formatDataDate } from "@/lib/formatDate";
import { formatSalesMoney, salesOrderStatusLabel } from "@/lib/salesOrderDraft";

/**
 * An ecommerce order is an eBay order.
 * The same signals the sales-order form uses, plus source ebay.
 */
export function salesOrderIsEcommerce(input: {
  source?: string | null;
  channel?: string | null;
  ebayOrderId?: string | null;
  ebaySalesRecordRef?: string | null;
}): boolean {
  if ((input.ebayOrderId ?? "").trim()) return true;
  if ((input.ebaySalesRecordRef ?? "").trim()) return true;
  const source = (input.source ?? "").trim().toLowerCase();
  const channel = (input.channel ?? "").trim().toLowerCase();
  return source === "ebay" || channel === "ebay";
}

export const SALES_ORDER_ECOMMERCE_KEY = "its.salesOrders.ecommerce";

export type SalesOrderEcommerceView = "show" | "hide";

/** Show eBay orders unless this browser last chose Hide. */
export function readSalesOrderEcommerce(storage: Pick<Storage, "getItem">): SalesOrderEcommerceView {
  try {
    return storage.getItem(SALES_ORDER_ECOMMERCE_KEY) === "hide" ? "hide" : "show";
  } catch {
    return "show";
  }
}

export function writeSalesOrderEcommerce(storage: Pick<Storage, "setItem">, view: SalesOrderEcommerceView): void {
  try {
    storage.setItem(SALES_ORDER_ECOMMERCE_KEY, view);
  } catch {
    // Private mode and blocked storage still leave the switch usable for this visit.
  }
}

export type SalesOrderListSortKey = "number" | "customer" | "reference" | "status" | "orderDate" | "shipDate" | "total";

export type SalesOrderListSortDir = "asc" | "desc";

export type SalesOrderListSort = {
  key: SalesOrderListSortKey;
  dir: SalesOrderListSortDir;
};

/** The list opens newest order date first, which is what the heading marker shows. */
export const SALES_ORDER_LIST_DEFAULT_SORT: SalesOrderListSort = { key: "orderDate", dir: "desc" };

/** First click on a different heading sorts ascending. Another click on it swaps direction. */
export function toggleSalesOrderListSort(current: SalesOrderListSort, key: SalesOrderListSortKey): SalesOrderListSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: "asc" };
}

export type SalesOrderListSortRow = {
  number: string;
  customerName: string;
  orderReference: string;
  status: string;
  orderDate: string | null;
  shipDate: string | null;
  total: number | null;
};

export type SalesOrderListSearchRow = SalesOrderListSortRow & {
  currency: string;
};

export type SalesOrderListRow = SalesOrderListSearchRow & {
  ecommerce: boolean;
};

const TEXT_SORT: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", TEXT_SORT);
}

/** Blank values stay at the bottom in either direction. */
function directed(leftEmpty: boolean, rightEmpty: boolean, ascending: number, dir: SalesOrderListSortDir): number {
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) return 0;
    return leftEmpty ? 1 : -1;
  }
  return dir === "asc" ? ascending : -ascending;
}

function numbered(value: string): boolean {
  return /^SO\d+$/i.test(value.trim());
}

export function compareSalesOrderListColumn(
  left: SalesOrderListSortRow,
  right: SalesOrderListSortRow,
  sort: SalesOrderListSort,
): number {
  switch (sort.key) {
    case "number":
      return directed(!numbered(left.number), !numbered(right.number), compareText(left.number.trim(), right.number.trim()), sort.dir);
    case "customer":
      return directed(
        !left.customerName.trim(),
        !right.customerName.trim(),
        compareText(left.customerName.trim(), right.customerName.trim()),
        sort.dir,
      );
    case "reference":
      return directed(
        !left.orderReference.trim(),
        !right.orderReference.trim(),
        compareText(left.orderReference.trim(), right.orderReference.trim()),
        sort.dir,
      );
    case "status": {
      const leftLabel = salesOrderStatusLabel(left.status);
      const rightLabel = salesOrderStatusLabel(right.status);
      return directed(!leftLabel.trim(), !rightLabel.trim(), compareText(leftLabel, rightLabel), sort.dir);
    }
    case "orderDate":
      return directed(!left.orderDate, !right.orderDate, compareText(left.orderDate ?? "", right.orderDate ?? ""), sort.dir);
    case "shipDate":
      return directed(!left.shipDate, !right.shipDate, compareText(left.shipDate ?? "", right.shipDate ?? ""), sort.dir);
    case "total":
      return directed(left.total == null, right.total == null, (left.total ?? 0) - (right.total ?? 0), sort.dir);
  }
}

/** Equal values keep the order they arrived in. No sort leaves that order unchanged. */
export function sortSalesOrders<T extends SalesOrderListSortRow>(rows: readonly T[], sort: SalesOrderListSort | null): T[] {
  if (!sort) return [...rows];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const compared = compareSalesOrderListColumn(left.row, right.row, sort);
      if (compared !== 0) return compared;
      return left.index - right.index;
    })
    .map((item) => item.row);
}

/** Fields the sales-order list search matches. Total is absent when money is hidden. */
export function salesOrderSearchFields(row: SalesOrderListSearchRow): string[] {
  const fields = [
    row.number,
    row.customerName,
    row.orderReference,
    row.status,
    salesOrderStatusLabel(row.status),
    row.orderDate ?? "",
    formatDataDate(row.orderDate),
    row.shipDate ?? "",
    formatDataDate(row.shipDate),
  ];
  if (row.total != null && Number.isFinite(row.total)) {
    fields.push(row.total.toFixed(2));
    fields.push(formatSalesMoney(row.total, row.currency));
  }
  return fields;
}

function fieldMatches(field: string, term: string): boolean {
  if (field.toLowerCase().includes(term.toLowerCase())) return true;
  return alnumFieldContains(field, term);
}

/**
 * A row matches when any `|` alternative matches a visible field.
 * Empty segments are ignored. A query with no term keeps every row.
 * Punctuation is ignored the same way as inventory search, so `120345678901`
 * matches an order reference of `12-03456-78901`.
 */
export function salesOrderMatchesSearch(row: SalesOrderListSearchRow, query: string): boolean {
  const terms = alnumQueryAlternatives(query);
  if (terms.length === 0) return true;
  const fields = salesOrderSearchFields(row);
  return terms.some((term) => fields.some((field) => fieldMatches(field, term)));
}

/** Hide ecommerce when asked, then search, then sort. */
export function visibleSalesOrders<T extends SalesOrderListRow>(
  rows: readonly T[],
  options: { query: string; hideEcommerce: boolean; sort: SalesOrderListSort | null },
): T[] {
  const filtered = rows.filter((row) => {
    if (options.hideEcommerce && row.ecommerce) return false;
    return salesOrderMatchesSearch(row, options.query);
  });
  return sortSalesOrders(filtered, options.sort);
}
