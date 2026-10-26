import { guardSpreadsheetFormula } from "@/lib/export/table";
import type { ReceivingEntry } from "@/lib/receivingSettings";
import { parseReceivingBinCode } from "@/lib/stockReceive";

export type ReceiptSummaryRow = {
  sku: string;
  name: string;
  search: string;
  qty: number;
  lines: number;
  /** Quantity in each putaway bin, `(x14)10002-C | (x8)10037`. */
  locations: string;
  pending: boolean;
};

export const RECEIPT_SUMMARY_HEADERS = ["SKU", "Item", "Qty", "Putaway", "Lines", "Status"] as const;

/** Item name when a SKU is linked. The stored search when the line is still pending. */
export function summaryItemLabel(row: { pending: boolean; name: string; search: string }): string {
  return row.pending ? row.search.trim() : row.name.trim();
}

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

/** Bin code for a summary cell. A putaway label keeps the code before the location dot. */
export function summaryBinReference(entry: { binReference?: string | null; putaway?: string | null }): string {
  const direct = (entry.binReference ?? "").trim();
  const head = ((entry.putaway ?? "").split("·")[0] ?? "").trim();
  const raw = direct || head;
  return parseReceivingBinCode(raw)?.reference ?? raw;
}

/** `(x14)10002-C | (x8)10037`, bins in reference order. Blank bins are left out. */
export function formatPutawayQty(counts: ReadonlyMap<string, number>): string {
  return [...counts.entries()]
    .filter(([bin, qty]) => bin.trim() && Number.isFinite(qty) && qty !== 0)
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: "base" }))
    .map(([bin, qty]) => `(x${qty})${bin.trim()}`)
    .join(" | ");
}

type SummaryBucket = {
  sku: string;
  name: string;
  search: string;
  qty: number;
  lines: number;
  pending: boolean;
  bins: Map<string, number>;
};

function addPutaway(bucket: SummaryBucket, entry: ReceivingEntry) {
  const bin = summaryBinReference(entry);
  if (!bin) return;
  bucket.bins.set(bin, (bucket.bins.get(bin) ?? 0) + entry.qty);
}

function finishBucket(bucket: SummaryBucket): ReceiptSummaryRow {
  return {
    sku: bucket.sku,
    name: bucket.name,
    search: bucket.search,
    qty: bucket.qty,
    lines: bucket.lines,
    locations: formatPutawayQty(bucket.bins),
    pending: bucket.pending,
  };
}

/**
 * One row per item, quantity summed, sorted by item name.
 * Lines with no item are grouped by the exact trimmed search and listed after the SKUs.
 * Locations are the quantity in each putaway bin.
 */
export function summarizeReceipts(entries: readonly ReceivingEntry[]): ReceiptSummaryRow[] {
  const matched = new Map<string, SummaryBucket>();
  const pending = new Map<string, SummaryBucket>();
  for (const entry of entries) {
    if (entry.itemId.trim() === "") {
      const search = (entry.searchQuery ?? "").trim();
      const row = pending.get(search) ?? { sku: "", name: "", search, qty: 0, lines: 0, pending: true, bins: new Map() };
      row.qty += entry.qty;
      row.lines += 1;
      addPutaway(row, entry);
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
      bins: new Map(),
    };
    if (!row.sku && entry.sku.trim()) row.sku = entry.sku.trim();
    if (!row.name && entry.itemName.trim()) row.name = entry.itemName.trim();
    row.qty += entry.qty;
    row.lines += 1;
    addPutaway(row, entry);
    matched.set(entry.itemId, row);
  }
  return [...matched.values()].map(finishBucket).sort(byItemName).concat([...pending.values()].map(finishBucket).sort(bySearch));
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
      textCell(summaryItemLabel(row)),
      numberCell(row.qty),
      textCell(row.locations),
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
