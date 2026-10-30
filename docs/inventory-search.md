# Inventory search

Warehouse > **Inventory search** opens `/warehouse/inventory`. It is a stock lookup: type the way receiving Find works, and read on-hand quantity and bins. It does not allocate a sales order and it does not receive into a bin.

The items list already has a search, and Advanced search filters by taxonomy. Those stay catalog tools. The quantity column on Items is `items.quantity`, which receiving does not write. Putting bin totals on that grid would mix a catalog editor with a floor lookup, so this is its own page at the top of Warehouse.

## Search

The field uses receiving Find (`searchReceivingScan`). A `|` is OR, applied before the scan is split on spaces. `7060DX5|7060PX5` and `7060DX5 | 7060PX5` match either term, so a DCS-7060DX5 and a DCS-7060PX5 both stay in the list. Empty segments from a leading, trailing, or doubled pipe are ignored. Each alternative is still one scan: spaces split that alternative, the longest token is tried first, and a tie prefers the token that has both letters and digits. Letters and digits are kept and the same minimum length applies inside each term. That token uses the items-page search: SKU, name, description, model, part number, OEM name, OEM part number, product URL, attribute values, manufacturer, manufacturer alias, and eBay item id, including the punctuation-insensitive match already in the database. There is no second matcher.

Results stay a list. An exact SKU is ranked first. The list defaults to in stock only: the On hand quantity is greater than 0. Clicking On hand still sorts that column. The mode on that same heading, **In stock** or **All**, is the quantity filter. All keeps a match with no open quantity, so On hand is 0 and Bins reads `no bins`. The choice is the `stock` query parameter. `stock=all` shows every match. A missing parameter, or any other value, is in stock only, so a refresh or a shared link keeps the setting. Enter runs the search. The SKU opens the item. Arrow keys move the highlight. A `q` parameter fills the field, for example `/warehouse/inventory?q=106683`.

Click a column heading to sort the rows already on the page. The first click sorts ascending. The next click on that heading sorts descending, and further clicks swap. The active heading shows ↑ or ↓ and sets `aria-sort`. The On hand mode does not change that sort. The list stays in search order until a heading is clicked. A later search on this page keeps that column and direction. Equal values keep search order, so an exact SKU stays ahead of a tie. Below 800px the table is hidden and the same four headings sit above the cards, including the On hand mode.

SKU sorts with numeric order (`20` before `100`). Item sorts by name, then description. A blank name stays blank. The em dash in an empty name cell is only for display. On hand sorts by the quantity. Bins sorts by the cell text after each line drops its `(xqty)` prefix, so `10002-C` comes before `20000-B` even when the first line shows a larger quantity. Those lines stay one bin per line, already in reference order: the first line is the lowest bin reference and later lines break a tie. An empty match sorts as the visible label `no bins`. The quantity on a bin line does not change the order. On hand is the quantity sort.

## On hand

Quantity is the sum of `bin_contents.qty` on open bin cycles. A closed cycle is not counted. That sum is the On hand column, and it is the quantity the filter uses. In stock only keeps rows where it is greater than 0. The filter runs in the search, after on-hand is totaled. In stock asks receiving Find for a wider set of matches (eight times the usual cap), drops quantity 0, then keeps the first 25, so a zero does not take the place of an on-hand match inside that set. If still more text matches exist, the page says to type more. All uses the usual receiving cap and then keeps every match in it, including zero. The bin's location is `bins.current_location_id`. Bins are one total per reference, in reference order, using the same label as a receiving Summary putaway. Several bins stay in one cell, one bin per line. A bin does not break after a period in the location. A location is added the same way a receipt putaway shows it:

```
(x33)20000-B · HWS.00.00.00
(x51)20007-B · HWS.00.00.00
```

A bin with no location is `(x14)10002-C`. Several receipts of the same SKU in one bin add together.

Receiving's "already in this bin" note calls `suggest_bins_for_sku`, which is limited to the project on the receipt. This page does not use that function. It lists every open bin, on any project. The open cycle stores a project. This version does not add an ownership column.

No migration. The page reads `bin_contents`, `bin_cycles`, `bins`, and `locations` with the service role, the same way receiving does. Below 800px the table becomes cards. The label column is only as wide as the field names. Values use the remaining width: text on the left, the on-hand quantity on the right, and the item description across that full value width. The search input is 16px on a phone.
