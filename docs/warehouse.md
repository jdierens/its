# Warehouse moves

Move inventory is the floor screen for a physical change. An operator scans a bin or a location, chooses what moves, scans where it goes, and confirms. Every move stores that person's two initials and the server time.

Apply `supabase/migrations/20261024064500_move_inventory.sql` before using the screen. It is additive and has not been applied.

## Where a bin sits

A bin is either inside one parent bin or at a location. `bins.parent_bin_id` is the parent. `bins.current_location_id` stays the effective location, so the bin screen and receiving keep reading that column. For a nested bin that location is the root ancestor's location. When an ancestor moves, every descendant's effective location is updated in the same transaction.

A bin cannot go into itself or into one of its descendants. Size is a rank on `bin_types`, not a list in the function. A bin can go into a bin of the same rank or a higher one, never a lower one. Today the rows are box 1, crate 2, and pallet 3, so a box can go in a box, a crate, or a pallet, a crate can go on a crate or a pallet, and a pallet can go on a pallet or at a location. Any bin can also be put at a location. A later type is a new `bin_types` row. `bins.type` references that table, and the move screen treats any one-letter suffix as a bin code.

## What the functions do

`move_bin(p_bin_ref, p_target_bin_ref, p_target_location_code, p_initials, p_client_request_id)` takes exactly one target. It writes one `bin_events` row of type `moved`, including `from_parent_bin_id` and `to_parent_bin_id`. Descendants are not given their own row. They move because their parent moved. `unnest` is that same function with a location target. `move_bin_to_location` stays as a wrapper for the bin screen and does not take a request id.

`move_item_qty` moves part or all of one quantity from one bin to another. It will not take the source below 0 or move a quantity into the same bin. The source quantity comes off that bin's open cycle. The target uses its open cycle, or opens one the way receiving does when the bin is empty. The ledger gets an `out` row and an `in` row on `inventory_movements` with the same `transfer_id`, `operator_label`, `occurred_at`, and a reason. `items.quantity` is not changed.

`empty_bin_into` moves every child bin and every quantity in the source into the target. The source bin stays where it is. `move_bins` moves several selected bins in one transaction.

`move_bin_items` moves the full on-hand quantity of each selected item from one bin into another in one transaction. The source bin stays where it is. Apply `supabase/migrations/20261026220253_move_bin_items.sql` by hand before using it. It is not applied automatically. A second signature, `move_bin_items(text, text, jsonb, text, text)`, moves several edited quantities in one request. Apply `supabase/migrations/20261026233415_move_bin_item_lines.sql` by hand before that. It is not applied automatically.

## The bin page

Clicking the current location still moves the whole bin to a location code when no item is selected. Check one or more rows in Items summary, then use that same location control and scan a bin code. Move sends every selected line, at its full on-hand quantity, into that bin. A location code cannot take a loose quantity.

A repeat of the same `p_client_request_id` returns the first result and does not move again. The functions are security definer, with a fixed empty search path. Execute is granted to `service_role` only.

## The screen

The source can be a bin code or a location code. The search, the place description, and the actions share one row. Move this bin and Empty into target sit beside the source search. The path, such as `HWR.01.03.02 > Pallet 30012-P > Crate 10099-C > Box 2345-B`, and "Now at …" sit in that same row. A path that only repeats the place line is not shown twice.

Child bins and items are one contents table: what, boxes, items, and quantity. Check a child bin or an item in that table. The operator moves the whole bin, selected child bins, one or more item quantities, or empties the bin into another bin. Each checked item starts at the full amount in the bin and its quantity can be edited. Confirm moves every checked item together. A location can take a bin. A quantity goes into a bin.

The target uses the same row: search, description, and Confirm. Its contents table is read-only, so you can see what is already there. The target is checked as it is typed. A nesting problem is shown before Confirm. The summary is one line, for example `Move Crate 10099-C (3 boxes, 41 items) from Pallet 30012-P to HWR.01.01.01`. Confirm leaves the target filled and reloads the source and the target. Recent entries stay on the source bin. Move another from the same source keeps the source and clears the target. Undo writes the reverse move and reloads both sides.

An unknown bin code uses the same prompt as receiving: "No bin with that code. Use New bin." Register this bin creates it. That button sits on the search row.

Recent moves list only the bin or location in the source field. A bin includes its own moves, bins moved into or out of it, and item transfers into or out of it. A location includes bin moves that start or end there. The rest of the warehouse is not listed. Until a source is chosen, the list stays empty. The columns are Date/time, Initials, What, From, To, and Qty, in the same packed table as receiving. The region is capped at 16rem and scrolls. Qty is right-aligned. Labels sit above the fields, inputs are 16px on a phone, and the choices are at least 44px tall.

Apply `supabase/migrations/20261102203000_scoped_recent_moves.sql` before that scoped list works. It is additive and has not been applied. The older warehouse-wide function is left in place.

Recent entries sit beside that list. They use the bin in the source field. The list stays empty until that field is a bin. A location code leaves it empty. Scanning the target leaves this list on the source. After a move, the source reloads, so the list shows what is still in the move-from bin. Each row is something in that bin now: for-sale quantity on the open cycle, or a bin nested inside it. The time is the latest receive, put-away, or transfer into the bin, and a nested bin uses the move that put it there. Newest arrival is first. The columns are Date/time, Initials, What, From, and Qty, in the same packed table. Qty is the for-sale amount still in the bin; a nested bin leaves Qty blank. The region is capped at 16rem and scrolls. On a wide screen the two lists share one row. On a phone they stack. Damaged-only quantity is not listed.

`list_bin_entries` from `supabase/migrations/20261102210000_bin_entries.sql` is already applied on project `fxsbpreasbdalwthyzvk`. The screen passes it the source bin.

## Inventory search

Warehouse > Inventory search (`/warehouse/inventory`) is the floor lookup for for-sale quantity and bin locations. A blank search lists the inventory. It uses the same search as receiving Find when a query is typed. The write-up is in [Inventory search](inventory-search.md).
