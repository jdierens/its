import type { EbayListingBrowserRow } from "@/lib/ebay/listingsBrowser";
import { exportStamp, guardSpreadsheetFormula, type ExportTable } from "@/lib/export/table";

/** Columns that match the listings table, with the listing link and pack fields written out. */
export const EBAY_LISTING_EXPORT_HEADERS = [
  "Picture URL",
  "Title",
  "eBay item ID",
  "Listing URL",
  "Custom label",
  "Pack qty",
  "Parent SKU",
  "Qty",
  "Item SKU",
  "Item name",
  "Kept on refresh",
] as const;

export function ebayListingsExportTitle(date: Date): string {
  return `ITS eBay listings ${exportStamp(date)}`;
}

export function ebayListingsExportTable(rows: readonly EbayListingBrowserRow[]): ExportTable {
  return {
    headers: [...EBAY_LISTING_EXPORT_HEADERS],
    rows: rows.map((row) =>
      [
        row.imageUrl ?? "",
        row.title ?? "",
        row.ebayItemId,
        row.listingUrl,
        row.customLabel ?? "",
        String(row.packQty),
        row.parentSku ?? "",
        row.quantityAvailable === null ? "" : String(row.quantityAvailable),
        row.itemSku ?? "",
        row.itemName ?? "",
        row.matchedManually ? "Yes" : "",
      ].map((value) => guardSpreadsheetFormula(value)),
    ),
  };
}

