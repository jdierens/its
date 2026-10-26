import { guardSpreadsheetFormula } from "@/lib/export/table";
import type { ReceivingEntry } from "@/lib/receivingSettings";

export type ReceiptSummaryRow = {
  sku: string;
  name: string;
  search: string;
  qty: number;
  lines: number;
  pending: boolean;
};

export const RECEIPT_SUMMARY_HEADERS = ["SKU", "Item name", "Search", "Qty", "Lines", "Status"] as const;

export const RECEIPT_DETAIL_HEADERS = [
  "Date",
  "Initials",
  "Project",
  "Incoming bin",
  "System",
  "System Qty",
  "Search",
  "SKU",
  "Item name",
  "Item Qty",
  "Putaway",
  "Comment",
  "Cleaned",
  "Wiped",
] as const;

function byItemName(a: ReceiptSummaryRow, b: ReceiptSummaryRow): number {
  const name = (a.name.trim() || "\uffff").localeCompare(b.name.trim() || "\uffff", undefined, { sensitivity: "base" });
  if (name !== 0) return name;
  return a.sku.localeCompare(b.sku, undefined, { sensitivity: "base", numeric: true });
}

function bySearch(a: ReceiptSummaryRow, b: ReceiptSummaryRow): number {
  const search = (a.search.trim() || "\uffff").localeCompare(b.search.trim() || "\uffff", undefined, { sensitivity: "base" });
  if (search !== 0) return search;
  return a.sku.localeCompare(b.sku, undefined, { sensitivity: "base", numeric: true });
}

/**
 * One row per item, quantity summed, sorted by item name.
 * Lines with no item are grouped by the exact trimmed search and listed after the SKUs.
 */
export function summarizeReceipts(entries: readonly ReceivingEntry[]): ReceiptSummaryRow[] {
  const matched = new Map<string, ReceiptSummaryRow>();
  const pending = new Map<string, ReceiptSummaryRow>();
  for (const entry of entries) {
    if (entry.itemId.trim() === "") {
      const search = (entry.searchQuery ?? "").trim();
      const row = pending.get(search) ?? { sku: "", name: "", search, qty: 0, lines: 0, pending: true };
      row.qty += entry.qty;
      row.lines += 1;
      pending.set(search, row);
      continue;
    }
    const row = matched.get(entry.itemId) ?? {
      sku: entry.sku.trim(),
      name: entry.itemName.trim(),
      search: "",
      qty: 0,
      lines: 0,
      pending: false,
    };
    if (!row.sku && entry.sku.trim()) row.sku = entry.sku.trim();
    if (!row.name && entry.itemName.trim()) row.name = entry.itemName.trim();
    row.qty += entry.qty;
    row.lines += 1;
    matched.set(entry.itemId, row);
  }
  return [...matched.values()].sort(byItemName).concat([...pending.values()].sort(bySearch));
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function receiptTableCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers, ...rows].map((row) => row.map((value) => csvCell(value)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function textCell(value: string | null | undefined): string {
  return guardSpreadsheetFormula(value ?? "");
}

function numberCell(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(value);
}

function flagCell(value: boolean | null): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "";
}

export function summaryCsv(rows: readonly ReceiptSummaryRow[]): string {
  return receiptTableCsv(
    RECEIPT_SUMMARY_HEADERS,
    rows.map((row) => [
      textCell(row.sku),
      textCell(row.name),
      textCell(row.search),
      numberCell(row.qty),
      numberCell(row.lines),
      row.pending ? "Pending item" : "",
    ]),
  );
}

export function receiptsDetailCsv(entries: readonly ReceivingEntry[]): string {
  return receiptTableCsv(
    RECEIPT_DETAIL_HEADERS,
    entries.map((entry) => [
      textCell(entry.receivedOn),
      textCell(entry.initials),
      textCell(entry.project),
      textCell(entry.incomingBin),
      textCell(entry.originatingSystem),
      numberCell(entry.originQty),
      textCell(entry.searchQuery),
      textCell(entry.sku),
      textCell(entry.itemName),
      numberCell(entry.qty),
      textCell(entry.putaway),
      textCell(entry.comment),
      flagCell(entry.cleaned),
      flagCell(entry.wiped),
    ]),
  );
}

export function receiptReportFileName(kind: "summary" | "receipts", project: string, day: string): string {
  const slug = project
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "export";
  const prefix = kind === "summary" ? "receipt-summary" : "receipts";
  return `${prefix}-${slug || "no-project"}-${date}.csv`;
}
