# SKU numbers

A new item gets the next SKU automatically. `reserve_item_sku` locks one row in `sku_counter` and returns a number. That number is one past the higher of the counter and the highest all-digit SKU already in `items`. The counter starts empty, so the first reservation is computed from the table. Today that highest SKU is 107132, so the next new item is 107133.

An import of older SKUs does not need a separate counter update. Saving a numeric SKU, including a bulk import, moves the counter to one past that SKU when the saved number is higher. SKUs that are not all digits are left as typed and do not move the counter.

The new-item form fills the SKU and keeps it read-only. **Edit SKU** unlocks the field. That override is on the form for whoever is creating the item. Limiting it to admins waits until sign-in is the deployed gate. The number shown was already reserved, so leaving the page without saving skips that number.

Bin labels use `bin_counter` and still start at 20000. The two counters are not connected.

Row level security stays off on `sku_counter`, matching `items`.
