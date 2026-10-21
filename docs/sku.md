# SKU numbers

A new item gets the next SKU when it is saved. `peek_item_sku` shows that number and does not move `sku_counter`. The preview is the higher of the counter and one past the highest all-digit SKU already in `items`. `create_item` calls `allocate_item_sku` when `p_sku` is blank or `auto`, in the same transaction as the insert. Two saves at once lock the counter row, so each gets its own number. Closing the form does not skip a number.

`reserve_item_sku` still consumes a number on every call. The app does not call it.

An import of older SKUs does not need a separate counter update. Saving a numeric SKU, including a typed SKU or a bulk import, moves the counter to one past that SKU when the saved number is higher. SKUs that are not all digits are left as typed and do not move the counter.

The new-item form fills the SKU and keeps it read-only. **Edit SKU** unlocks the field. That override is on the form for whoever is creating the item. Limiting it to admins waits until sign-in is the deployed gate. The locked number is only a preview. A typed SKU is saved as written.

Bin labels use `bin_counter` and still start at 20000. The two counters are not connected.

Row level security stays off on `sku_counter`, matching `items`.
