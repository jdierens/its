# Picking

Warehouse → Picking lists approved orders that have a product or kit line. Opening an order starts the pick sheet.

The sheet is a table. Each stock line is two rows. The first row is the item: SKU, name, ordered, picked, and pending. The second row is where to pull it: bin, location, QOH, pick qty, and Pick. Another bin for that SKU is another row under the same item. Project and ownership are not on this page. The quantity box and Pick sit centered on the bin row.

A bin is about seven characters, such as `20000-B`, and a location is a short code such as `HWS.00.00.00`. Those values, quantities, and the other short codes on the picking list, the sheet, and the serial table stay on one line. The table scrolls sideways instead of breaking a code after one extra character.

Service lines, and a product line whose item type is Service, are left off the sheet. Freight stays on the not-picked note, including freight on service item 4343. A kit component swap stays on the sales-order kit line. A product line can fulfill a different SKU: `item_id` stays the planned SKU and `actual_item_id` is the one that ships. Stock, stock units, and the pick move that fulfilled SKU. Approval can set it. Picking can change it only when Admin > Settings has Allow replacement SKU during pick on. That setting is off until an admin turns it on. An eBay line for `106683` can ship `107021`. The sheet shows the fulfilled SKU and the planned SKU under it. Apply `supabase/migrations/20261028073000_so_sku_replacement.sql` by hand. Deploying does not run it.

Scan a bin code in the scan box to pick the first open line that holds it. Scan or type a serial that is already a stock unit and the sheet fills the pull-from location with the bin that unit is in, highlights that row, and says which bin it is pulling from. A serial that is not in inventory, or not in a bin, is rejected and does not fill a location. Pick the quantity from that bin to record where it came from, then add the serial on the compact serial table.

Serials already on the sheet, and serials typed while receiving a small quantity, are rows in a table: one line per serial, with the country of origin and, on a pick, the bin it came from.

Remove and Add actions on the sheet are a trash icon and a plus icon. The name is the button’s tooltip and accessible label.
