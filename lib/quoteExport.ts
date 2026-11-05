import { loadXlsx } from "@/lib/data/parseTable";
import { parseQuoteQty, quoteExtText, quoteOverviewExt } from "@/lib/quoteReviews";

/** A quote line the spreadsheet and the PDF both read. */
export type QuoteExportSource = {
  sku: string;
  itemName: string;
  partNumber: string;
  qty: string;
  replyQty?: string;
  unitPrice: string;
  fspUnit: string;
};

export type QuoteExportLine = {
  sku: string;
  name: string;
  qty: string;
  qtyNumber: number | null;
  bidUnit: string;
  bidExt: number | null;
  fmpUnit: string;
  fmpExt: number | null;
};

export type QuoteExportTotals = {
  qty: number | null;
  bidExt: number | null;
  fmpExt: number | null;
};

/** Reply quantity when it is filled in, otherwise the request quantity. Both extensions use this quantity. */
export function quoteExportQty(line: { qty: string; replyQty?: string }): string {
  const reply = (line.replyQty ?? "").trim();
  return reply || line.qty.trim();
}

/**
 * Rows for Export XLS and Export PDF.
 * Name falls back to the part number when the item name is empty.
 * Bid is the DDS unit. FMP is the forecasted sales price (`fsp_unit`).
 * Extensions are the same whole dollars as the quote overview.
 */
export function quoteExportLines(lines: QuoteExportSource[]): QuoteExportLine[] {
  const rows: QuoteExportLine[] = [];
  for (const line of lines) {
    const sku = line.sku.trim();
    const name = line.itemName.trim() || line.partNumber.trim();
    const qty = quoteExportQty(line);
    const bidUnit = line.unitPrice.trim();
    const fmpUnit = line.fspUnit.trim();
    if (!sku && !name && !qty && !bidUnit && !fmpUnit) continue;
    const parsedQty = parseQuoteQty(qty);
    rows.push({
      sku,
      name,
      qty,
      qtyNumber: parsedQty.ok ? parsedQty.qty : null,
      bidUnit,
      bidExt: quoteOverviewExt(line, bidUnit, "dds"),
      fmpUnit,
      fmpExt: quoteOverviewExt(line, fmpUnit, "dds"),
    });
  }
  return rows;
}

export function quoteExportTotals(rows: QuoteExportLine[]): QuoteExportTotals {
  let qty = 0;
  let hasQty = false;
  let bidExt = 0;
  let hasBid = false;
  let fmpExt = 0;
  let hasFmp = false;
  for (const row of rows) {
    if (row.qtyNumber != null) {
      qty += row.qtyNumber;
      hasQty = true;
    }
    if (row.bidExt != null) {
      bidExt += row.bidExt;
      hasBid = true;
    }
    if (row.fmpExt != null) {
      fmpExt += row.fmpExt;
      hasFmp = true;
    }
  }
  return {
    qty: hasQty ? Math.round(qty * 100) / 100 : null,
    bidExt: hasBid ? bidExt : null,
    fmpExt: hasFmp ? fmpExt : null,
  };
}

export function quoteExportQtyText(value: number | null): string {
  if (value == null) return "";
  return String(value);
}

export function quoteExportMoney(amount: number | null, currency = "USD"): string {
  return quoteExtText(amount, currency);
}

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

function asBytes(value: Uint8Array | number[] | ArrayBuffer): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

/** SKU, Name, and Qty. Quantity is a number when it parses, so a total can be summed in the sheet. */
export async function quoteExportWorkbook(rows: QuoteExportLine[]): Promise<Uint8Array> {
  const XLSX = await loadXlsx();
  if (!XLSX.utils.book_new || !XLSX.utils.aoa_to_sheet || !XLSX.utils.book_append_sheet || !XLSX.write) {
    throw new Error("The spreadsheet writer is unavailable.");
  }
  const grid: (string | number)[][] = [
    ["SKU", "Name", "Qty"],
    ...rows.map((row) => [row.sku, row.name, row.qtyNumber ?? ""]),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid as string[][]), "Quote");
  return asBytes(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}
