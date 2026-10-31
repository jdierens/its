# Inventory search

Warehouse > **Inventory search** opens `/warehouse/inventory`. It is a stock lookup: leave the box blank to list the inventory, or type the way receiving Find works, and read for-sale quantity and bins. It does not allocate a sales order and it does not receive into a bin.

The items list already has a search, and Advanced search filters by taxonomy. Those stay catalog tools. The quantity column on Items is `items.quantity`, which receiving does not write. Putting bin totals on that grid would mix a catalog editor with a floor lookup, so this is its own page at the top of Warehouse.

## Search

The field uses receiving Find (`searchReceivingScan`). A `|` is OR, applied before the scan is split on spaces. `7060DX5|7060PX5` and `7060DX5 | 7060PX5` match either term, so a DCS-7060DX5 and a DCS-7060PX5 both stay in the list. Empty segments from a leading, trailing, or doubled pipe are ignored. Each alternative is still one scan: spaces split that alternative, the longest token is tried first, and a tie prefers the token that has both letters and digits. Letters and digits are kept and the same minimum length applies inside each term. That token uses the items-page search: SKU, name, description, model, part number, OEM name, OEM part number, product URL, attribute values, manufacturer, manufacturer alias, and eBay item id, including the punctuation-insensitive match already in the database. There is no second matcher.

A blank field lists the inventory. It does not wait for a query and it does not show an empty state that asks for one. The same qty filter applies. In stock, the default, lists every item whose for-sale quantity is above 0. All lists every item, including quantity 0.

Results stay a list. An exact SKU is ranked first when a query is typed. A blank list is in SKU order until a heading is clicked. The list defaults to in stock only: for-sale quantity is greater than 0. The **Qty** heading is that filter. Click Qty to include zeros, and click it again to return to in stock only. The heading does not say "on hand" or "in stock". Pressed Qty means in stock only. The arrow beside Qty sorts that column. All keeps a match with no open for-sale quantity, so Qty is 0 and Bins reads `no bins`. The choice is the `stock` query parameter. `stock=all` shows every match. A missing parameter, or any other value, is in stock only, so a refresh or a shared link keeps the setting. Enter runs the search. The SKU opens the item. Arrow keys move the highlight on the current page. A `q` parameter fills the field, for example `/warehouse/inventory?q=106683`.

Each row shows the primary item photo, the same thumbnail as the items list, and the taxonomy. The taxonomy cell is the short code badge used on Items. A missing short code falls back to the long code, then the name. The tooltip carries the long code and the name when the badge is the short code.

Click a column heading to sort the filtered list, not only the rows on the screen. Photo, SKU, Item, Taxo, Qty, and Bins all sort. The first click sorts ascending. The next click on that heading sorts descending, and further clicks swap. The active heading shows ↑ or ↓ and sets `aria-sort`. Qty's arrow is that control; the word Qty itself switches the filter and does not change the sort. The list stays in search order until a heading is clicked. A later search on this page keeps that column and direction. Equal values keep the previous order, so an exact SKU stays ahead of a tie. Below 800px the table is hidden and the same headings sit above the cards.

The summary above the table is the filtered list: how many rows match, and the sum of for-sale qty across those rows. It says the total is for this filter, not this page. Sort does not change either number. Damaged pieces are not in the total.

Pages are 50 rows. The controls are first, previous, next, and last, the same pager as receiving and the items list. `page`, `sort`, and `dir` are query parameters. A page past the end opens the last page. Changing the search, the qty filter, or the sort returns to the first page.

SKU sorts with numeric order (`20` before `100`). Item sorts by name, then description. A blank name stays blank. The em dash in an empty name cell is only for display. Taxo sorts by short code, then long code, then name. Photo sorts by whether a picture is set; ascending lists rows without one first. Qty sorts by the for-sale quantity. Bins sorts by the cell text after each line drops its `(xqty)` prefix, so `10002-C` comes before `20000-B` even when the first line shows a larger quantity. Those lines stay one bin per line, already in reference order: the first line is the lowest bin reference and later lines break a tie. An empty match sorts as the visible label `no bins`. The quantity on a bin line does not change the order.

## On hand

Quantity is the sum of `bin_contents.qty` on open bin cycles. That column is for sale. `damaged_qty` on the same row is still in the bin and is not added. A damaged-only match has Qty 0, so the in-stock filter hides it, and All shows the damaged count beside 0. A closed cycle is not counted. That for-sale sum is the Qty column, and it is the quantity the filter and the total use. In stock only keeps rows where it is greater than 0. The filter runs in the search, after qty is totaled, and before the page is sliced. A typed search still asks receiving Find for up to 1,000 ranked matches, then filters and pages that set. If still more text matches exist, the page says to type more. A blank search does not use that cap: in stock reads the open for-sale balances, and all reads every item. The bin's location is `bins.current_location_id`. Bins are one total per reference, in reference order, using the same label as a receiving Summary putaway. Several bins stay in one cell, one bin per line. A bin does not break after a period in the location. A location is added the same way a receipt putaway shows it:

```
(x33)20000-B · HWS.00.00.00
(x51)20007-B · HWS.00.00.00
```

A bin with no location is `(x14)10002-C`. Several receipts of the same SKU in one bin add together.

Receiving's "already in this bin" note calls `suggest_bins_for_sku`, which is limited to the project on the receipt. This page does not use that function. It lists every open bin, on any project. The open cycle stores a project. This version does not add an ownership column.

No migration. The page reads `items`, `taxonomies`, `item_images`, `bin_contents`, `bin_cycles`, `bins`, and `locations` with the service role, the same way receiving and the items list do. The photo is the primary image, the lowest `sort_order`, signed the same way as the items grid. Below 800px the table becomes cards. The label column is only as wide as the field names. Values use the remaining width: text on the left, the quantity on the right, and the item description across that full value width. The search input is 16px on a phone.
