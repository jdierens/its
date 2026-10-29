# Picking

Warehouse → Picking lists approved orders that have a product or kit line. The list and the pick ticket header show Order reference, the same column as the sales order list. That value is the eBay order id when the order has one, and otherwise the customer PO. The stored internal reference is not shown. Apply `supabase/migrations/20261029020000_pick_order_reference.sql` by hand so the eBay order id is on the pick payload. Deploying does not run it. Until that file is applied, the reference falls back to the customer PO. Opening an order starts the pick sheet. Opening it does not create a warehouse bin and does not take a number from the bin counter.

Until someone scans a bin, staging is the label `staging bin SO27767` for sales order 27767. That label is tied to the sales order number. It is not a bin such as `20018-B`. A pick still leaves the stock bin. Scan an existing bin, for example `20111-B`, and choose Use bin to put the pick in that bin. A code that is not already a bin is refused. Apply `supabase/migrations/20261028183000_pick_staging_choice.sql` by hand. Deploying does not run it.

The sheet is a table. Each stock line is a group. The item row is SKU, name, ordered, picked, and pending. Under that row, the bin titles are Bin, location, QOH, pick qty, and action, then one row for each bin. Picked lines up with pick qty. Pending lines up with the Pick button. Another bin for that SKU is another row under the same titles. Project and ownership are not on this page. Print ticket prints the pickable lines without the scan boxes and buttons.

Freight, fees, services, and any line that is not picked are left off the page. That includes service item 4343 (`SER\FREIGHT-OUT`). They are not listed under Not picked.

A bin is about seven characters, such as `20000-B`, and a location is a short code such as `HWS.00.00.00`. Those values, quantities, and the other short codes on the picking list, the sheet, and the serial table stay on one line. The table scrolls sideways instead of breaking a code after one extra character.

A kit component swap stays on the sales-order kit line. A product line can fulfill a different SKU: `item_id` stays the planned SKU and `actual_item_id` is the one that ships. Stock, stock units, and the pick move that fulfilled SKU. Approval can set it. Picking can change it only when Admin > Settings has Allow replacement SKU during pick on. That setting is off until an admin turns it on. An eBay line for `106683` can ship `107021`. The sheet shows the fulfilled SKU and the planned SKU under it. Apply `supabase/migrations/20261028073000_so_sku_replacement.sql` by hand. Deploying does not run it.

Scan a bin code in the scan box to pick the first open line that holds it. Scan or type a serial that is already a stock unit and the sheet fills the pull-from location with the bin that unit is in, highlights that row, and says which bin it is pulling from. A serial that is not in inventory, or not in a bin, is rejected and does not fill a location. Pick the quantity from that bin to record where it came from, then add the serial on the compact serial table.

Pasting a spreadsheet range into a line’s serial field adds each serial the same way as Add. A Google Sheets column is one serial per line (`V8H8GBDR`, then `V8HD2PXR`, and so on), including a Windows line break. A row is separated by tabs. Blank cells are dropped. A known unit is pulled from the bin it is in. The sheet says how many were accepted and lists the ones that were not, with the reason: not in inventory, already on the item, a different item, or the pick already has a serial for every piece. One serial, typed or pasted, still waits for Enter, which only fills the pull-from bin.

Serials already on the sheet, and serials typed while receiving a small quantity, are rows in a table: one line per serial, with the country of origin and, on a pick, the bin it came from.

Remove and Add actions on the sheet are a trash icon and a plus icon. The name is the button’s tooltip and accessible label.

Finishing the pick leaves the sales order on picking. The sheet links to packing. Opening packing sets the order to packing. Warehouse → Packing is written up in [Packing](packing.md).
