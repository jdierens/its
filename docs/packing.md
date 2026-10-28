# Packing

Warehouse → Packing lists sales orders whose pick is finished, and orders already being packed. Opening an order sets the sales order to packing. A packed order stays packed. Freight, fees, services, and any line that was not picked stay off the sheet. That includes service item 4343 (`SER\FREIGHT-OUT`).

Shipping bins come from a packaging list. A box has a fixed length, width, and height in inches. A pallet copies the base length and width, and the operator enters the height. The list starts with a small box, a medium box, a large box, and a standard pallet. Plus adds another type. The trash icon hides a type. Bins already created from it keep the inches they were given.

Plus on a packaging type adds a shipping bin. A line can be split across bins. Plus on a picked line adds the typed quantity to the chosen bin. The trash icon takes that quantity back out. A weight can be typed on a bin at any time. Finish packing stays off until every picked quantity is in a bin and every bin has a weight. A pallet also needs its height.

Finish packing sets the order to packed and stores `packed_at`. Warehouse → Shipping lists those orders. Carrier labels and rate shopping are not on that screen.

The fulfilled SKU is the one that was picked. A replacement shows that SKU, with the planned SKU under it.

Apply `supabase/migrations/20261028233000_sales_order_packing.sql` by hand on project `fxsbpreasbdalwthyzvk` after `supabase/migrations/20261028222000_so_shipping_label.sql` and the picking migrations. Deploying does not run it.
