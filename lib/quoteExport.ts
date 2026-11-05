import { loadXlsx } from "@/lib/data/parseTable";
import { parseMoney } from "@/lib/pricing/quotes";
import {
  quoteBidders,
  quoteColumnCaption,
  quoteExtText,
  quoteExtWhole,
  quotePrintNotes,
  parseQuoteQty,
  type QuoteBidderClass,
  type QuotePrintNote,
} from "@/lib/quoteReviews";

/** A quote line the spreadsheet reads. */
export type QuoteExportSource = {
  sku: string;
  itemName: string;
  partNumber: string;
  qty: string;
  replyQty?: string;
};

export type QuoteExportLine = {
  sku: string;
  name: string;
  /** Whole number with thousands separators. Empty when the quantity is empty. */
  qty: string;
  qtyNumber: number | null;
};

/** Reply quantity when it is filled in, otherwise the request quantity. */
export function quoteExportQty(line: { qty: string; replyQty?: string }): string {
  const reply = (line.replyQty ?? "").trim();
  return reply || line.qty.trim();
}

/** Whole quantity with thousands separators. 71712 is `71,712`. */
export function quoteExportQtyText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function quoteExportQtyNumber(value: string): number | null {
  const parsed = parseQuoteQty(value);
  if (!parsed.ok || parsed.qty == null) return null;
  return Math.round(parsed.qty);
}

/**
 * Rows for Export XLS.
 * Name falls back to the part number when the item name is empty.
 * Qty is the reply quantity when that is filled in, otherwise the request quantity.
 */
export function quoteExportLines(lines: QuoteExportSource[]): QuoteExportLine[] {
  const rows: QuoteExportLine[] = [];
  for (const line of lines) {
    const sku = line.sku.trim();
    const name = line.itemName.trim() || line.partNumber.trim();
    const rawQty = quoteExportQty(line);
    const qtyNumber = quoteExportQtyNumber(rawQty);
    const qty = qtyNumber != null ? quoteExportQtyText(qtyNumber) : rawQty;
    if (!sku && !name && !qty) continue;
    rows.push({ sku, name, qty, qtyNumber });
  }
  return rows;
}

export function quoteExportMoney(amount: number | null, currency = "USD"): string {
  return quoteExtText(amount, currency);
}

/** Margin percent. The ratio is profit divided by the sales extension, not a number already scaled by 100. */
export function quoteExportPercent(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio);
}

/**
 * Forecasted gross profit.
 * FSP is the sales price. DDS is the cost reference in this margin.
 * FGP$ is the FSP extension minus the DDS extension.
 * FGP% is that profit divided by the FSP extension. It is never divided by DDS.
 * A missing price leaves both empty. A zero FSP extension has dollars and no percent.
 */
export function quoteForecastProfit(ddsExt: number | null, fspExt: number | null): { dollars: number | null; ratio: number | null } {
  if (ddsExt == null || fspExt == null) return { dollars: null, ratio: null };
  const dollars = fspExt - ddsExt;
  return { dollars, ratio: fspExt === 0 ? null : dollars / fspExt };
}

/**
 * Footer profit. Dollars are the sum of the line profits.
 * The percent is that sum divided by the sum of the FSP extensions on those same lines.
 */
export function quoteForecastProfitTotal(lines: { dollars: number | null; sales: number | null }[]): { dollars: number | null; ratio: number | null } {
  let dollars = 0;
  let sales = 0;
  let any = false;
  for (const line of lines) {
    if (line.dollars == null || line.sales == null) continue;
    dollars += line.dollars;
    sales += line.sales;
    any = true;
  }
  if (!any) return { dollars: null, ratio: null };
  return { dollars, ratio: sales === 0 ? null : dollars / sales };
}

export type QuoteExportColumn = {
  key: string;
  header: string;
  caption: string;
  name: string;
  bidderClass: "dds" | QuoteBidderClass;
};

export type QuoteExportPrice = { unit: string; ext: number | null };

export type QuoteExportPriceRow = {
  name: string;
  qty: string;
  qtyNumber: number | null;
  prices: QuoteExportPrice[];
  fgpDollars: number | null;
  fgpRatio: number | null;
  fgpSales: number | null;
};

export type QuoteExportDocument = {
  columns: QuoteExportColumn[];
  rows: QuoteExportPriceRow[];
  notes: QuotePrintNote[];
  showProfit: boolean;
  totals: {
    qty: number | null;
    exts: (number | null)[];
    fgp: { dollars: number | null; ratio: number | null };
  };
};

type ExportBid = {
  bidderName: string;
  unitPrice: string;
  columnCode?: string;
  bidNote?: string;
  bidderClass?: string;
};

type ExportLine = QuoteExportSource & {
  unitPrice: string;
  bids: ExportBid[];
};

/** File name for the spreadsheet. The button says XLS. The file is xlsx, which Excel opens. */
export function quoteExportFilename(reference: string): string {
  const base = reference
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "quote"}.xlsx`;
}

function exportExt(line: ExportLine, unit: string): number | null {
  return quoteExtWhole(quoteExportQty(line), unit);
}

function bidFor(line: ExportLine, name: string): ExportBid | undefined {
  return line.bids.find((bid) => bid.bidderName.trim().toLowerCase() === name.toLowerCase());
}

function hasUnit(unit: string): boolean {
  const parsed = parseMoney(unit);
  return parsed.ok && parsed.amount != null;
}

/**
 * PDF table. DDS is the first price column. Each other bidder, including FSP,
 * follows in first-seen order. The heading is the 3-character code when one is set.
 * FGP$ and FGP% are included when some line has both a DDS unit and an FSP unit.
 * The FSP used for the margin is the first FSP bidder that has a unit price.
 */
export function quoteExportDocument(input: {
  ddsColumnCode: string;
  ddsBidNote: string;
  lines: ExportLine[];
}): QuoteExportDocument {
  const visible = input.lines.filter((line) => {
    const sku = line.sku.trim();
    const name = line.itemName.trim() || line.partNumber.trim();
    const qty = quoteExportQty(line);
    if (sku || name || qty || hasUnit(line.unitPrice)) return true;
    return line.bids.some((bid) => bid.bidderName.trim() || hasUnit(bid.unitPrice));
  });
  const names = quoteBidders(visible);
  const ddsHead = quoteColumnCaption(input.ddsColumnCode, "DDS", "DDS");
  const columns: QuoteExportColumn[] = [
    { key: "dds", header: ddsHead.label, caption: ddsHead.caption, name: "DDS", bidderClass: "dds" },
  ];
  for (const name of names) {
    const sample = visible.map((line) => bidFor(line, name)).find((bid) => bid);
    const head = quoteColumnCaption(sample?.columnCode ?? "", name);
    const bidderClass = sample?.bidderClass === "mkt" || sample?.bidderClass === "fsp" ? sample.bidderClass : "cmp";
    columns.push({ key: `bid:${name.toLowerCase()}`, header: head.label, caption: head.caption, name, bidderClass });
  }

  const fspName =
    names.find((name) => {
      const sample = visible.map((line) => bidFor(line, name)).find((bid) => bid);
      if (sample?.bidderClass !== "fsp") return false;
      return visible.some((line) => hasUnit(line.unitPrice) && hasUnit(bidFor(line, name)?.unitPrice ?? ""));
    }) ?? null;
  const showProfit = fspName != null;

  const rows: QuoteExportPriceRow[] = visible.map((line) => {
    const name = line.itemName.trim() || line.partNumber.trim();
    const rawQty = quoteExportQty(line);
    const qtyNumber = quoteExportQtyNumber(rawQty);
    const prices = columns.map((column) => {
      const unit = column.bidderClass === "dds" ? line.unitPrice.trim() : (bidFor(line, column.name)?.unitPrice ?? "").trim();
      return { unit, ext: exportExt(line, unit) };
    });
    const ddsExt = prices[0]?.ext ?? null;
    const fspColumn = fspName ? columns.findIndex((column) => column.name.toLowerCase() === fspName.toLowerCase()) : -1;
    const fspExt = fspColumn >= 0 ? prices[fspColumn]?.ext ?? null : null;
    const profit = showProfit ? quoteForecastProfit(ddsExt, fspExt) : { dollars: null, ratio: null };
    return {
      name,
      qty: qtyNumber != null ? quoteExportQtyText(qtyNumber) : rawQty,
      qtyNumber,
      prices,
      fgpDollars: profit.dollars,
      fgpRatio: profit.ratio,
      fgpSales: profit.dollars == null ? null : fspExt,
    };
  });

  const exts = columns.map((_, index) => {
    let total = 0;
    let any = false;
    for (const row of rows) {
      const amount = row.prices[index]?.ext;
      if (amount == null) continue;
      total += amount;
      any = true;
    }
    return any ? total : null;
  });
  let qty = 0;
  let hasQty = false;
  for (const row of rows) {
    if (row.qtyNumber == null) continue;
    qty += row.qtyNumber;
    hasQty = true;
  }

  return {
    columns,
    rows,
    notes: quotePrintNotes({ ddsColumnCode: input.ddsColumnCode, ddsBidNote: input.ddsBidNote, lines: visible }),
    showProfit,
    totals: {
      qty: hasQty ? qty : null,
      exts,
      fgp: quoteForecastProfitTotal(rows.map((row) => ({ dollars: row.fgpDollars, sales: row.fgpSales }))),
    },
  };
}

function asBytes(value: Uint8Array | number[] | ArrayBuffer): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

type SheetCell = { t?: string; v?: string | number; z?: string };
type WorkSheet = { [address: string]: SheetCell | undefined };

/** SKU, Name, and Qty. Quantity is a whole number so a total can be summed in the sheet. */
export async function quoteExportWorkbook(rows: QuoteExportLine[]): Promise<Uint8Array> {
  const XLSX = await loadXlsx();
  if (!XLSX.utils.book_new || !XLSX.utils.aoa_to_sheet || !XLSX.utils.book_append_sheet || !XLSX.write) {
    throw new Error("The spreadsheet writer is unavailable.");
  }
  const grid: (string | number)[][] = [
    ["SKU", "Name", "Qty"],
    ...rows.map((row) => [row.sku, row.name, row.qtyNumber ?? ""]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(grid as string[][]) as WorkSheet;
  for (let index = 0; index < rows.length; index += 1) {
    const cell = sheet[`C${index + 2}`];
    if (cell && cell.t === "n") cell.z = "#,##0";
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Quote");
  return asBytes(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}
