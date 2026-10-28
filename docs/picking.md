# Picking

Warehouse → Picking lists approved orders that have a product or kit line. Opening an order starts the pick sheet.

The sheet is a table. Each stock line is a row, and each bin that holds that SKU is a row under it. Ordered, picked, and still to pick sit with the SKU. Bin, location, project, ownership, and on hand sit on the bin row. The quantity box and Pick button are centered on that row.

Scan a bin code in the scan box to pick the first open line that holds it. Scan or type a serial that is already a stock unit and the sheet fills the pull-from location with the bin that unit is in, highlights that row, and says which bin it is pulling from. A serial that is not in inventory, or not in a bin, is rejected and does not fill a location. Pick the quantity from that bin to record where it came from, then add the serial on the compact serial table.

Serials already on the sheet, and serials typed while receiving a small quantity, are rows in a table: one line per serial, with the country of origin and, on a pick, the bin it came from.

Remove and Add actions on the sheet are a trash icon and a plus icon. The name is the button’s tooltip and accessible label.
