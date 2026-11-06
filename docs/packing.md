# Packing

Warehouse → Packing lists sales orders whose pick is finished, orders already being packed, and shipped orders whose pick is finished and whose pack is still empty. Opening an order sets the sales order to packing. A packed order stays packed. Freight, fees, services, and any line that was not picked stay off the sheet. That includes service item 4343 (`SER\FREIGHT-OUT`).

Shipping bins come from a packaging list. A box has a fixed length, width, and height in inches. A pallet copies the base length and width, and the operator enters the height. The list starts with a small box, a medium box, a large box, and a standard pallet. Plus adds another type. The trash icon hides a type. Bins already created from it keep the inches they were given.

Plus on a packaging type adds a shipping bin. A line can be split across bins. Plus on a picked line adds the quantity in the field to the chosen bin. That field starts at 1 while the line still has room, and it stays at 1 after an assign while more of the line is left. A different whole number, up to what is still unpacked, can be typed instead. The trash icon takes that quantity back out. A weight can be typed on a bin at any time. Finish packing stays off until every picked quantity is in a bin and every bin has a weight. A pallet also needs its height.

Finish packing sets an order that is still packing to packed and stores `packed_at`. Warehouse → Shipping lists those orders. Carrier labels and rate shopping are not on that screen.

An order that already shipped without this step stays shipped. That includes a historic eBay order whose status is shipped, whose ship date and shipment rows are already stored, and whose `packed_at` is still empty. The pack sheet can add bins, assign the picked quantity, and store weights. Finish stores `packed_at` and leaves the status, the ship date, and the shipment rows as they are. Cancelled, invoiced, and closed orders stay closed. Warehouse → Packing lists that order once the pick is finished and `packed_at` is still empty. The sales order stage control opens the sheet before that, and the sheet says to finish the pick first. The pack stage icon stays yellow until a package exists or `packed_at` is set. That rule is unchanged.

The fulfilled SKU is the one that was picked. A replacement shows that SKU, with the planned SKU under it.

The header beside the sales order number is the same stage control as the sales order and the pick sheet. It goes back to those pages. On an order that has not shipped, packing in that control stays off until the pick is finished.

Apply `supabase/migrations/20261028233000_sales_order_packing.sql` by hand on project `fxsbpreasbdalwthyzvk` after `supabase/migrations/20261028222000_so_shipping_label.sql` and the picking migrations. Apply `supabase/migrations/20261102143000_pack_shipped_orders.sql` after that. Apply `supabase/migrations/20261104183000_pick_shipped_orders.sql` after that so a shipped order with a finished pick and no `packed_at` is on Warehouse → Packing. Deploying does not run these files.
