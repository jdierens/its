# Inventory search

Warehouse > **Inventory search** opens `/warehouse/inventory`. It is a stock lookup: type the way receiving Find works, and read on-hand quantity and bins. It does not allocate a sales order and it does not receive into a bin.

The items list already has a search, and Advanced search filters by taxonomy. Those stay catalog tools. The quantity column on Items is `items.quantity`, which receiving does not write. Putting bin totals on that grid would mix a catalog editor with a floor lookup, so this is its own page at the top of Warehouse.

## Search

The field uses receiving Find (`searchReceivingScan`). A scan is split on spaces. The longest token is tried first, and a tie prefers the token that has both letters and digits. That token uses the items-page search: SKU, name, description, model, part number, OEM name, OEM part number, product URL, attribute values, manufacturer, manufacturer alias, and eBay item id, including the punctuation-insensitive match already in the database. There is no second matcher.

Results stay a list. An exact SKU is ranked first and is not hidden. A match with no open quantity stays in the list so the SKU can still be found. On hand is 0 and Bins reads `no bins`. Enter runs the search. The SKU opens the item. Arrow keys move the highlight. A `q` parameter fills the field, for example `/warehouse/inventory?q=106683`.

## On hand

Quantity is the sum of `bin_contents.qty` on open bin cycles. A closed cycle is not counted. The bin's location is `bins.current_location_id`. Bins are one total per reference, in reference order, using the same label as a receiving Summary putaway. Several bins stay in one cell, one bin per line. A location is added the same way a receipt putaway shows it:

```
(x33)20000-B · HWS.00.00.00
(x51)20007-B · HWS.00.00.00
```

A bin with no location is `(x14)10002-C`. Several receipts of the same SKU in one bin add together.

Receiving's "already in this bin" note calls `suggest_bins_for_sku`, which is limited to the project on the receipt. This page does not use that function. It lists every open bin, on any project. The open cycle stores a project. This version does not add an ownership column.

No migration. The page reads `bin_contents`, `bin_cycles`, `bins`, and `locations` with the service role, the same way receiving does. Below 800px the table becomes cards. The search input is 16px on a phone.
