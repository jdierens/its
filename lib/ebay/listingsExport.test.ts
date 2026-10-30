import assert from "node:assert/strict";
import test from "node:test";
import type { EbayListingBrowserRow } from "./listingsBrowser.ts";
import { ebayListingsExportTable, ebayListingsExportTitle } from "./listingsExport.ts";

function row(patch: Partial<EbayListingBrowserRow> = {}): EbayListingBrowserRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    ebayItemId: "123456789012",
    title: "32GB DDR5",
    customLabel: "107075-4PK",
    parentSku: "107075",
    quantityAvailable: 3,
    listingUrl: "https://www.ebay.com/itm/123456789012",
    imageUrl: "https://i.ebayimg.com/images/g/example/s-l500.jpg",
    itemId: "22222222-2222-4222-8222-222222222222",
    itemSku: "107075",
    itemName: "32GB DDR5",
    packQty: 4,
    matchedManually: true,
    ...patch,
  };
}

test("eBay listing export follows the table columns", () => {
  const table = ebayListingsExportTable([
    row(),
    row({
      title: "=HYPERLINK(\"https://evil.example\")",
      customLabel: null,
      parentSku: null,
      quantityAvailable: null,
      imageUrl: null,
      itemId: null,
      itemSku: null,
      itemName: null,
      packQty: 1,
      matchedManually: false,
    }),
  ]);
  assert.deepEqual(table.headers, [
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
  ]);
  assert.deepEqual(table.rows[0], [
    "https://i.ebayimg.com/images/g/example/s-l500.jpg",
    "32GB DDR5",
    "123456789012",
    "https://www.ebay.com/itm/123456789012",
    "107075-4PK",
    "4",
    "107075",
    "3",
    "107075",
    "32GB DDR5",
    "Yes",
  ]);
  assert.equal(table.rows[1]?.[1], "'=HYPERLINK(\"https://evil.example\")");
  assert.equal(table.rows[1]?.[4], "");
  assert.equal(table.rows[1]?.[7], "");
  assert.equal(table.rows[1]?.[10], "");
});

test("eBay listing spreadsheet title uses Pacific time", () => {
  assert.equal(ebayListingsExportTitle(new Date("2026-10-19T18:00:00.000Z")), "ITS eBay listings 2026-10-19 11:00");
  assert.equal(ebayListingsExportTitle(new Date("2026-12-19T18:00:00.000Z")), "ITS eBay listings 2026-12-19 10:00");
});
