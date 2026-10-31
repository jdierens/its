# Damaged inventory

Damaged goods are in the warehouse and are not for sale. A starting-inventory row with DMG set, or a receipt checked Damaged, stays in its bin. Search, picks, and the quantity available to sell do not include it. A damaged row whose residual value is $0 is still left off the sheet and is not received. That path stays valid.

## Balance

`bin_contents` is still one row per item in an open bin cycle.

| Column | Meaning |
| --- | --- |
| `qty` | For sale. Inventory search Qty, pick bins, and `item_for_sale_qty` use this. |
| `damaged_qty` | In the bin, not for sale. |

A row remains while either quantity is above 0, so a bin that holds only damaged goods keeps its open cycle. `bin_occupied_qty` is the sum of both and is what receiving uses to decide that the bin is not empty.

`stock_units.stock_status` is `available`, `damaged`, `quarantine`, or `hold`, the same values as `inventory_movements.stock_status`. Receiving writes `available` or `damaged` only. Quarantine and hold are not a location and have no screen. A unit created on a damaged receipt is `damaged`. Picks select `available` units. Updating a damaged unit onto a pick is refused.

`stock_events.damaged` records the checkbox. The receipt row is still append-only. A later change is a `stock_event_edits` row whose `new_values` include `damaged`. A quantity correction that does not mention the flag leaves it in place. `receipt_lines.damaged` reads that latest edit.

## Receiving

The line has a Damaged checkbox, unchecked. Save posts through `receive_into_bin` with `p_damaged`. The quantity is added to for-sale `qty` and then moved onto `damaged_qty` in the same transaction. Serials and country of origin on that line are damaged units.

Recent entries shows the word Damaged in front of the note. The DMG box calls `set_receipt_damaged`. Marking a posted line moves its quantity from `qty` to `damaged_qty`, and the units from that receipt that are still in the bin follow. Clearing it moves them back. The move is refused when the source balance is short, or when the bin would then have more identified pieces than the quantity they belong to.

Import has a `damaged` column. Blank is no. `DMG` and `damage` map to it. `yes` posts the row as damaged.

## What still counts as for sale

Inventory search Qty is `qty` only. When damaged pieces exist, the cell also shows that count. It is not part of the number or the total, and in stock does not keep a match whose for-sale quantity is 0.

A pick bin list is `bin_contents.qty` above 0, so a damaged-only balance is not offered and a mixed bin offers only the for-sale quantity. eBay orders are picked on that same sheet. There is no push of ITS quantity to eBay. `item_for_sale_qty(item)` is the open-cycle for-sale total a later listing quantity should use.

Moving items still moves for-sale `qty`. Damaged quantity stays in the source bin. Moving it is a later change.

## Write-down, later

A write-down lowers the carrying cost of damaged goods that still have residual value. It references `bin_contents.id` for `damaged_qty`, and `stock_units.id` where `stock_status` is `damaged`. Quantity and `stock_status` stay as they are. The adjustment stores the previous cost. This change does not add that screen, a cost column, or an `inventory_movements` row. Receipts still do not post the ledger; picks and bin transfers do, and those rows stay `stock_status = available` because they move for-sale quantity.

## Migration

Apply `supabase/migrations/20261031060000_damaged_inventory.sql` by hand after `supabase/migrations/20261030153100_qbo_sync_log_chunk_phase.sql`. It is additive. Deploying does not run it. Row level security is unchanged. New functions are granted to `service_role` only. Until it is applied, a receipt left unchecked still receives for sale, and checking Damaged is refused.
