# Purchase orders, projects, receiving, and the inventory ledger

Design only. `/purchasing/orders` is still a placeholder. Nothing here is built.

Today the work lives in four places. The **Transactions** sheet is the operational purchase-order record. QuickBooks holds the same orders for payments, the bank, and bills, and it does not track inventory. The **Inventory** sheet is every IN and OUT: item, quantity, storage location, and the reference transaction (a PO for incoming, a sales order for outgoing, an RMA for a customer return, a vendor return for outgoing). A fourth sheet lists serial numbers on serialized items that were sold: transaction reference, operator, timestamp, item ID, and serial number. The Inventory sheet uses that same operator and timestamp.

ITS replaces both sheets. It is the operational source of truth for purchase orders, for inbound projects, and for an inventory movement ledger. QuickBooks stays the financial system. The ledger is generic so a sales order, an RMA, a vendor return, an adjustment, and a cycle count can plug in later without a new quantity mechanism.

## What already exists

Vendors are `public.vendors`, including QuickBooks id, sync token, and sync status. Addresses are jsonb. `tax_id` is the vendor tax identifier.

Items are one row plus EAV attributes (`attributes`, `item_attributes`). `items.quantity` is a single on-hand number. Condition is `New` or `Used`. A new item's note is empty, `Factory Sealed`, or `New Open Box`. There is no grade, no serial flag, no bin, and no ownership flag. Model, part number, and OEM part number are text. Lens already matches SKU, part number, OEM part number, model, and the Spec Code attribute. New SKUs come from `reserve_item_sku()`. Photos are `item_images` in the private `item-images` bucket. Seeded drive taxonomies are HDD (`DSK/HDD`) and SSD (`DSK/SSD`).

`item_transactions` is buy and sell only. Quantity is positive, `unit_price` is required, and `total` is generated. A buy names a vendor. `source` is `manual`, `qbo`, or `ebay`. The same source, reference, and item cannot be inserted twice.

Bins are pallet, crate, and box labels (`20000-P`). `bins.current_location_id` is an unused uuid. There is no locations table and no link from an item to a bin. `bin_events.actor` is free text. `app_settings` is a key/value table. `app_users.id` is the person in the session.

Capabilities are the names in `docs/roles.md` (pull request #42): `can_view_financials`, `can_edit_financials`, `can_edit_items`, `can_add_photos`, `can_receive`, `can_move_bins`, `can_adjust_counts`. That document is design too. Warehouse roles cannot see money. The clerk proposal can receive, put away, and add photos, and cannot edit or delete items.

Every new table here enables row level security, grants `service_role` only, and grants nothing to `anon` or `authenticated`. Ids are uuid with `gen_random_uuid()`. Live writes set `operator_id` from the session on the server and set `created_at` from the server clock. The client does not send either value. Imports may set `occurred_at` and `operator_label` from a sheet when no `app_users` row matches.

## Recommendation: projects for bulk inbound

A data-center takeout, a consignment harvest, and an owned lot are organized by a **project** with a code such as `AZSIM6930`. Intake references the project. A true purchase order often does not exist yet.

Owned lots and owned takeouts use the same project, plus one upfront purchase order for the lot total. Consignment uses the project alone until settlement. A routine order of known SKUs stays a purchase order with no project.

That keeps one intake pipeline. The money path is the only fork: an upfront PO, or settlement POs generated later. A project can have many purchase orders. A known line and a lot line can share one upfront PO when the buy is mixed.

## Projects

`projects`:

| Column | Notes |
|---|---|
| `id` | uuid, default `gen_random_uuid()` |
| `code` | unique text, the name people already use (`AZSIM6930`) |
| `name` | text |
| `type` | `consignment`, `owned_lot`, or `takeout` |
| `basis` | `consigned` or `owned`. Consignment is always consigned. An owned lot is always owned. A takeout records which of those two applies |
| `vendor_id` | the consignor or the seller |
| `physical_status` | `received`, `processing`, `processed` |
| `financial_status` | `open`, `provisional`, `allocated`, `settling`, `settled` |
| `status` | `active` or `closed`. Closed stops new intake. Settlement can continue |
| `started_on`, `closed_on` | dates |
| `notes` | text |
| `operator_id`, `occurred_at`, `created_at` | same rules as the ledger |

Consignment terms are columns on the project, a snapshot for this job. An optional `consignment_agreements` row can hold a repeating contract. Copying it onto the project keeps later edits to the contract from rewriting this job.

| Term | Notes |
|---|---|
| `model` | `negotiated` or `revenue_share`. Empty on an owned project |
| `consignor_share_percent` | revenue share only. 75 means the consignor gets 75% of net and DDS keeps 25% of net |
| `deduct_marketplace_fees`, `deduct_shipping`, `deduct_payment_fees`, `deduct_refurb` | booleans. Which amounts come out of gross before the split |
| `settlement_cadence` | `per_sale`, `periodic`, or `negotiated_batch` |
| `buyout_allowed` | boolean |
| `allocation_method` | owned lots: `manual`, `market_weight`, `ecommerce_weight`, `equal`, or `category` |
| `disposal_cost` | money. Scrap handling. Default is to add it to the allocation pool |
| `upfront_purchase_order_id` | set for an owned lot or an owned takeout |

Warehouse screens show the code, the type, the consignor name, and pipeline counts. Share, deductions, disposal cost, and allocation stay on financial screens.

## Ledger

`inventory_movements` is the IN/OUT log. `items.quantity` is a cache of movements that already have an `item_id`, updated in the same transaction as the match or the movement. Unidentified quantity stays on the ledger and on the project, and stays out of `items.quantity` until someone matches a SKU. Per-bin quantity is the same sum filtered by bin, including rows that still have no item. A null bin means received and not sitting in a labeled bin.

| Column | Notes |
|---|---|
| `id` | uuid, default `gen_random_uuid()` |
| `item_id` | nullable until the line is identified |
| `project_id` | nullable. Set for every project intake, putaway, and later sale of those units. Stays set after a settlement PO exists |
| `intake_line_id`, `unit_id` | nullable links to the line and the piece |
| `bin_id` | nullable, references `bins` |
| `direction` | `in` or `out` |
| `qty` | numeric, greater than 0 |
| `ownership` | `owned` or `consigned`. Copied from the project basis. Known PO receipts are `owned` |
| `ref_type` | `project`, `purchase_receipt`, `putaway`, `sales_order`, `rma`, `vendor_return`, `adjustment`, `cycle_count`, `opening_balance`, `scrap`, `internal_use` |
| `ref_id` | uuid, nullable. Polymorphic. No foreign key |
| `ref_label` | project code, PO number, or sheet reference |
| `source_movement_id` | the layer an `out` consumed |
| `operator_id` | `app_users.id`, from the session |
| `operator_label` | sheet import only |
| `occurred_at` | server clock on live writes. Sheet timestamp on import |
| `created_at` | server insert time |
| `notes` | optional |

Project intake uses `ref_type = project` and `ref_id` of the project. That reference stays. Settlement does not rewrite it. The chain after settlement is unit → project → settlement PO line.

A putaway is two rows that share one transfer id: `out` of the holding balance and `in` to the destination bin. Both keep the same project, ownership, and item. Item quantity does not change. A known-line receipt of warehouse goods is one `in` with `bin_id` null until putaway.

Cost is not a ledger column. Unit cost lives on the PO line, the allocation, and the buy transaction.

Rows that do not exist yet still have a `ref_type`. No writer inserts `sales_order`, `rma`, `vendor_return`, `cycle_count`, `scrap`, or `internal_use` until that feature exists. Cycle-count rows require `can_adjust_counts`.

## Intake lines

Operators often have no item id. An intake line stores what they can see.

`intake_lines`:

| Column | Notes |
|---|---|
| `id` | uuid |
| `project_id` | set when the goods belong to a project |
| `purchase_order_id`, `po_line_id` | set when the goods are a known PO line. A lot's upfront PO links the project, and the pieces still arrive as intake lines |
| `item_id` | null while unidentified |
| `part_number`, `model`, `description` | what was typed. Part or model is the usual key |
| `qty` | numeric, greater than 0 |
| `unit` | text, default Piece |
| `bin_id` | holding bin, optional |
| `pipeline` | the line's state when it has no unit rows. See the pipeline below |
| `operator_id`, `occurred_at`, `created_at` | session and server clock |

Photos use the existing signed-upload path. Files live under an intake prefix in `item-images` until a SKU exists, then the same bytes attach as `item_images`. A clerk with `can_add_photos` can take them. The warehouse payload is part, model, quantity, bin, serials, and photos. It has no prices.

Matching suggestions reuse the Lens candidate rules: normalized exact part number, OEM part number, and model, then trigram similarity, then a Lens reading of the dock photo (manufacturer, taxonomy, part). Several items can share a part number. The screen lists them and does not pick one by itself. `can_edit_items` confirms a match or creates a SKU through `reserve_item_sku()`. A clerk can enter the line and cannot match it or create the SKU.

On match, the same transaction sets `item_id` on the line, its units, its serials, and its ledger rows, and sets `items.quantity` to the identified ledger sum. There is no second `in`.

## Units and the pipeline

A piece that will be identified, graded, wiped, or serialized gets a `units` row. A quantity-only line (cables, weight) can stay on the intake line until someone splits pieces out of it. HDD and SSD lines create one unit per piece. The pipeline is the same for a consignment project, an owned lot, and a takeout.

`units.pipeline`:

| State | Meaning |
|---|---|
| `received` | Counted on the project. Item may still be null. Holding bin allowed |
| `identified` | `item_id` is set |
| `graded` | Visual grade is recorded, and a required wipe is recorded or explicitly waived |
| `put_away` | Sellable bin is set. Ready to sell |

The order is received → identified → graded → put away. A holding bin at `received` is storage of the pile. `put_away` is the sellable location. Ready to sell means `put_away` plus a resolved item. Project stock is visible in bin and project counts from `received` onward.

`unit_events` records each transition: from state, to state, `operator_id`, `occurred_at`, `created_at`.

Known catalog receipts skip the unidentified step. The unit starts at `identified`. New sealed goods with no wipe requirement can skip grading. The skip stores a reason. HDD (`DSK/HDD`) and SSD (`DSK/SSD`) include a wipe result or a recorded waiver before `put_away`.

Each unit stores `project_id`, `intake_line_id`, `item_id` nullable, `serial_id` nullable, `ownership`, `bin_id`, `condition`, `condition_note`, `grade`, `disposition` (`sellable`, `scrap`, `internal`, `reclaimed`), and `settlement_po_line_id` nullable. The settlement link is filled when a PO line is generated for that unit. `project_id` stays filled.

## Serials

Serialized and non-serialized goods share intake and the ledger. A serial is the identity of one unit.

`taxonomies.serialized` defaults false. `items.serialized` null inherits the taxonomy. A serialized Piece unit has one serial before it can reach `graded`. Weight units are an open question.

`serials`: `item_id` nullable until identified, `unit_id`, `project_id`, `serial` trimmed, `ownership`, `status` (`in_stock`, `sold`, `rma_returned`, `returned_to_vendor`). A partial unique index on `serial` where `status = in_stock` rejects a second in-stock copy anywhere in the company. An RMA moves the existing row.

`serial_events` store `serial_id`, the new status, `movement_id` when a ledger row exists, `ref_type`, `ref_id`, `ref_label`, `operator_id`, `occurred_at`, and `created_at`. The phone accepts a barcode scan or a typed serial. The server enforces the unique index.

Test results hang off the serial (the unit), not off the SKU. A later listing rollup can read the latest result per unit onto an eBay draft. That rollup is later.

## Purchase orders

`purchase_orders.purpose` is `purchase`, `settlement`, or `buyout`. `project_id` is null for a routine known order, required for an owned lot and for every settlement or buy-out.

| Column | Notes |
|---|---|
| `id` | uuid |
| `number` | unique, from a PO counter, same idea as `sku_counter` |
| `vendor_id` | seller or consignor |
| `project_id` | nullable |
| `purpose` | `purchase`, `settlement`, `buyout` |
| `status` | lifecycle below. Settlement and buy-out skip receiving |
| `fulfillment` | `warehouse` or `drop_ship` |
| `currency` | default `USD` |
| `terms` | text, nullable. Money |
| `ordered_on`, `expected_on` | dates |
| `sent_at`, `closed_at` | timestamptz, nullable |
| `ship_to` | jsonb, vendor shipping-address shape |
| `notes` | text |
| `qbo_po_id`, `qbo_doc_number` | nullable financial link |
| `operator_id`, `occurred_at`, `created_at` | session and server clock |

`po_lines.line_kind` is `known` or `lot`.

| | Known line | Lot line |
|---|---|---|
| Item | `item_id` or a description | description only, `item_id` null |
| Quantity | `qty_ordered` greater than 0 | null. Pieces appear as intake lines after processing |
| Price | `unit_cost` | `total_cost` for the whole lot. `unit_cost` null |
| Expectation | condition, condition note, grade, unit | none until processing |

A purchase can mix known lines and one lot line. A lot line requires a project. `qty_received` on a known line is the sum of accepted receipt quantities. It is not typed.

`po_line_units` links a settlement or buy-out line to the units it pays for (`po_line_id`, `unit_id`). A unit sits on at most one non-cancelled settlement line. The unit still points at its project.

### Known-line receipts

`receipts` are one delivery against a purchase PO: `purchase_order_id`, operator, timestamps, notes. `receipt_lines` store `po_line_id` nullable (null means not on the PO), `item_id`, `qty`, `disposition` (`accepted`, `damaged`, `wrong_item`), the condition and grade that arrived, and `unit_cost` copied from an owned accepted line.

Over-receipt is allowed. Damaged and wrong-item rows do not increase `items.quantity` and do not count against `qty_ordered`. A kept wrong item becomes its own accepted line with `po_line_id` null. One known line can split into several receipt lines when condition or grade differs.

Posting an accepted warehouse line with an item:

1. Insert the ledger `in` (`ref_type = purchase_receipt`, `bin_id` null) with the server operator and timestamps. `project_id` copies from the PO when the PO has one.
2. Set `items.quantity` to that item's identified ledger sum.
3. Insert `item_transactions` type `buy`, `source` `po`, vendor from the PO, `unit_price` from the line, reference of the PO number plus the receipt id. The source check gains `po`.
4. If the item is serialized, require the serials and write `serials` plus `serial_events` on those units.

Drop-ship skips the ledger, the quantity cache, putaway, and in-stock serials. Seller refurbished becomes condition `Used` and an empty note. A `_QA` mark becomes grade `Grade A`. Grade is stored on the unit and copied to a new nullable `items.grade`.

### Lot processing

Accepting the bulk sets the project's `physical_status` to `received` and marks the lot line received. That step does not create item ledger rows. Warehouse staff then break the lot down over days: intake lines, Lens, SKUs, quantity, condition, grade, serials, and bins, using the pipeline above. Each sellable unit posts its ledger `in` when it is counted, so those pieces are in stock while the rest of the lot is still a pile. `physical_status` moves to `processing`, then to `processed` when someone marks the breakdown finished.

### Owned-lot cost

The upfront PO `total_cost`, plus disposal cost when that flag is on, is the pool. Scrap and e-waste outputs have allocated value 0. They still record quantity and a disposal note. Price-weight methods skip units with no market or ecommerce price and leave them in the remainder. Category allocation is a weight per taxonomy, then by quantity inside the category. Equal allocation splits the pool across sellable units. Manual allocation types an amount per unit.

`unallocated = pool − sum of allocated amounts`. The running remainder is visible to `can_edit_financials`. Lock requires `physical_status = processed` and a zero remainder, or an explicit write-off row with a note. Lock sets `financial_status = allocated` and `cost_state = final` on the buys.

Until lock, a unit that already has an amount gets a buy with `cost_state = provisional`. A unit with no amount yet has no buy. Provisional COGS is labeled on margin reports. Lock true-ups the buy by the delta and does not post another inventory movement. A later reallocation stores the previous amount, the new amount, the delta, and the operator, then updates the buy the same way. Warehouse responses omit the pool, the remainder, unit cost, and COGS.

### Settlement purchase orders

Settlement and buy-out POs are generated from the project. They are drafts until someone with `can_edit_financials` approves them. Approval inserts the buy (`source = po`) and that buy is the unit's COGS. It does not post another `in`. The PO then syncs to QuickBooks for payment the same way as any other PO, once push exists. The project can hold many of these POs.

**Revenue share.** Gross is the sale price. Net is gross minus the deductions the project flags. Consignor payable is `net × consignor_share_percent`. Example: sell at $100 gross, net $80 after fees, DDS keeps 25% of net ($20), consignor gets 75% of net ($60). The settlement line unit cost is $60.

**Negotiated.** Payable is the agreed unit amount, or a batch total allocated across the included units (equal per unit unless the allocator overrides it).

**Cadence.** `per_sale` opens a draft PO for that sale. `periodic` appends lines to the open draft for the period. `negotiated_batch` builds a PO for the named set of units. A unit's draft line recomputes while the PO is still a draft. After approval, a price change is a new adjustment document.

Consigned units stay at no cost from intake until that approval. They are sellable once `put_away`.

## Status of a purchase order

`draft`, `open`, `partially_received`, `received`, `closed`, `cancelled`. Send moves `draft` to `open` and sets `sent_at`.

| From | To | When |
|---|---|---|
| `draft` | `open` | Send, or approve a settlement |
| `draft` | `cancelled` | Nothing received, or a draft settlement discarded |
| `open` | `partially_received` | A known line still has a balance |
| `open` | `received` | Known lines are filled, and any lot line's bulk has arrived |
| `open` | `cancelled` | Received quantity is still zero |
| `partially_received` | `received` | The balance is filled |
| `partially_received` | `closed` | Closed short, with a note |
| `received` | `closed` | No further receipts |
| `closed`, `cancelled` | none | Terminal |

A lot still in `processing` does not hold the PO at `partially_received`. The vendor delivered the lot. Cancelling a partial order is refused. Close it short, then vendor-return anything already stocked. Voiding a receipt comes later and is the path back from `received` to `partially_received`. Settlement POs use `draft`, `open`, and `closed`. They do not use the receipt states.

## Corner cases

**Unidentified goods.** Bin, quantity, and serial are real before `item_id` exists. The items list quantity ignores them until the match.

**Mixed purchase.** Known lines receive as known lines. The lot line receives as a bulk arrival on the project. Both can share one PO number.

**Consignment intake.** Basis `consigned`. Harvest CPUs, memory, cards, and drives onto intake lines, identify them, grade them, and put them away. No buy at intake.

**Buy-out.** An approved `buyout` PO posts the buy at the negotiated price and a ledger pair, `out` consigned and `in` owned, for those units only. Net quantity stays. Serial ownership flips to owned. The project link stays. The rest of the project stays consigned.

**Consignor reclaim.** `out` with `ref_type = vendor_return`, serial `returned_to_vendor`, no settlement line. A draft line for that unit is removed.

**Scrap and internal use.** `disposition` scrap or internal, ledger `out`, payable stays zero on a revenue-share project. A negotiated project can add a settlement line only when `can_edit_financials` enters one.

**RMA after settlement.** Restock the same unit on the same project, serial `rma_returned` then `in_stock`, ownership still consigned. Claw back the payable ($60 in the example) with a credit on the project. A draft settlement line is reduced instead when the PO was never approved.

**Same SKU, mixed ownership.** Each `in` is a layer carrying project and ownership. A serial sale consumes that unit's layer. A non-serial sale with both owned and consigned layers requires an explicit layer. FIFO applies only when every available layer has the same ownership.

**Credits and cost corrections.** They store the previous `unit_price` and update the buy. Quantity stays. Warehouse payloads omit them.

**Drop-ship.** `fulfillment = drop_ship` on a known purchase. No ledger row and no putaway.

## Grading and drive wipes

Visual grading writes condition, condition note, and grade on the unit, using the Seller refurbished, `_QA`, Factory Sealed, and New Open Box rules above. Different grades from one intake line become separate SKUs when the identifier confirms them.

Drive wipes run in the external system Jan calls SysOps. The product name is unconfirmed. That system exports Excel or CSV with SMART fields: health percent, power-on hours, terabytes or gigabytes written, terabytes or gigabytes read, grown defects, and other columns.

`wipe_imports` store the file name, sha256, project id when chosen, the mapping profile id, operator, and `created_at`. `wipe_mappings` store a name and a jsonb map from canonical fields (`serial`, `health_pct`, `power_on_hours`, `tb_written`, `tb_read`, `gb_written`, `gb_read`, `grown_defects`, `certificate_ref`) to header text. Matching headers ignores case and surrounding space. A saved profile is reusable because exports vary. Unmapped columns stay only in the raw row.

Each imported row keeps `raw` jsonb plus the normalized columns above. The serial match trims, strips separators, and compares case-insensitively to `serials.serial`. A matched row writes `wipe_results` on that serial: the normalized fields, pass or fail, `certificate_ref`, the import id, operator, and timestamps. The unit stores the latest result. Older results stay.

Thresholds live in data, per taxonomy, with a suggested grade: minimum health, maximum power-on hours, maximum grown defects, and optional maximum terabytes written. A fail suggests the configured grade or a scrap review. The grader confirms it. A fail does not scrap the unit by itself and does not change the SKU.

The same file hash is refused as a duplicate import. A new file that repeats a serial adds a new result and leaves the previous row in place. Rows in one file that share a serial are reported. Unmatched serials are listed and do not create units.

## Roles

Jan confirmed who may create, enter, and send a purchase order: admin and staff. That is `can_edit_financials`. There is no separate approver. Warehouse manager and warehouse clerk cannot create, enter, or send. Their receiving screens use `can_receive` and the server returns quantities only.

PO unit cost, lot totals, allocation, remainder, disposal cost, terms, share percent, deductions, payable, settlement amounts, buy rows, credits, and `vendors.tax_id` are money. Editing them requires `can_edit_financials`. Reading them requires `can_view_financials`. Approving a settlement or buy-out PO is the same capability, so warehouse roles cannot approve one either.

Receiving, identifying descriptions, photos, visual grade, wipe upload, and putaway use `can_receive`, `can_add_photos`, and `can_move_bins`. Those responses omit money on the server. Matching an existing item or creating a SKU is `can_edit_items`. The clerk proposal can do the warehouse steps and cannot create the SKU, so an unidentified line waits for a warehouse manager.

`read_only` can see a purchase order, including prices, and cannot create or send one. That role also cannot post a project, a receipt, a movement, a grade, or a serial event. That write block is the roles design. It is not enforced yet.

## QuickBooks

Recommend one direction: ITS to QuickBooks. QuickBooks is not a second inventory book and is not the source of PO lines.

Phase 1 does not push. `qbo_po_id` and `qbo_doc_number` are optional links. Finance can keep entering the bill by hand during that slice. Inventory is entered once, in ITS.

The financial slice pushes a PurchaseOrder when a purchase PO is sent, and a Bill when an owned known-line receipt posts or when an owned-lot PO is approved for the lot total. Item-level allocation stays in ITS. A settlement or buy-out PO pushes the same way once it is approved, and that is what gets paid. Consignment intake never becomes a bill. Payments and the bank stay in QuickBooks. A failed push does not roll back the receipt or the approval. The order shows unsynced.

Import operational history from the sheets. Do not import it from QuickBooks.

## Mobile

Intake, grading, and putaway are phone pages for Android Chrome and iOS Safari. Pick or scan the project code, type a part or model, scan serials, scan the bin reference (`20000-P`), and take photos with the same camera input as Take photo. Wipe import is a file upload and can happen on a desktop. The warehouse payload has no prices.

## Import

One-time imports, then the sheets stop.

**Transactions sheet.** Open purchase orders become purchase POs and known lines. A reference shaped like a project code becomes a project, and the PO links to it when both exist. Match the vendor on QuickBooks id, then on display name. Match a line to an item on SKU when the cell is a SKU. Otherwise keep the description, part, or model on an intake line. Store the sheet reference in `ref_label` and in `qbo_doc_number` when the cell is a QuickBooks number.

**Inventory sheet.** One `opening_balance` movement per item and location. Match the item on SKU or the sheet's item id. Match the location to `bins.reference` when it looks like a bin label. Otherwise keep the location text on the note and leave `bin_id` null. Direction comes from IN or OUT. `occurred_at` and `operator_label` come from the sheet. `operator_id` is set only when the name matches one `app_users` row.

**Serial sheet.** Match item ID, transaction reference, serial, operator, and timestamp onto `serials` and one `serial_events` row. Link `ref_label` to that reference and to a project when the code matches. Status defaults to `sold`, because this sheet tracks sold units. Duplicate in-stock serials are reported and left unmerged.

**Reconciliation.** Compare each item's identified ledger sum with `items.quantity`. List mismatches and leave the cache unchanged until that list is accepted. A second list is unidentified quantity, serialized counts against ledger quantity, and in-stock serials that collide.

Imports are idempotent on the sheet reference plus item or serial.

## Project reports

For each project, and rolled up by consignor:

| Figure | Definition |
|---|---|
| Received | Intake quantity, including unidentified lines |
| On hand | Quantity still in stock, by pipeline state |
| Sold | Units linked to a sale |
| Settled | Units linked to an approved settlement line |
| Owed | Approved payable on settlement POs that are not paid |
| Paid | Settlement POs marked paid or linked to a QuickBooks payment |

Owed, paid, and any cost figures require `can_view_financials`. Warehouse reports are counts and pipeline state.

## Phases

Each phase is a small pull request. The first usable known-line slice is phases 1–3: create a PO, receive it, put it away. Projects come next and do not block that slice. The first ledger migration already includes nullable `project_id`, nullable `item_id`, and `ownership`, so later phases add rows to the same log.

1. **Ledger and known PO.** `inventory_movements`, `purchase_orders`, `po_lines`. Admin and staff create, edit, and send a known-line PO. Warehouse roles do not get that screen. No receipt yet.
2. **Receive known lines.** Receipts, the `po` transaction source, the ledger `in`, and the quantity cache. Warehouse screens are quantities only. Existing items only.
3. **Putaway.** Scan a bin that already exists. The two-row transfer. Unlocated quantity is visible.
4. **Projects and unidentified intake.** Projects, intake lines, units through `identified`, match suggestions, Lens, photos, bin, quantity, and serial before a SKU exists.
5. **Grading and wipes.** Visual grade, SysOps import, pipeline to `graded`. Depends on a sample export.
6. **Project putaway.** Pipeline to `put_away`. Ready-to-sell counts. Same transfer as phase 3.
7. **Sheet imports.** Transactions, Inventory, and serial sheets, plus reconciliation. Needs the header samples. Can start once phase 1's tables are stable.
8. **Owned lots.** Lot line, upfront PO on the project, provisional cost, allocation, lock, scrap, and reallocation.
9. **Consignment settlement.** Draft POs from the project, approval, COGS, buy-out, project and consignor reports. Revenue share and clawback wait until sales exist. Negotiated batch settlement can ship in this phase.
10. **QuickBooks push.** PurchaseOrder on send, Bill on owned receipt or owned-lot approval, settlement PO on approval. Payments stay in QuickBooks.
11. **Later documents.** Sales orders, RMAs, cycle counts, and serials marked `sold`. Mixed-layer picks and post-settlement clawbacks land here.

## Open questions

1. Please send a header row, and a few sample rows, from the Transactions sheet, the Inventory sheet, and the serial sheet.
2. Where do new known-SKU purchase orders start: typed into ITS, or still born on the Transactions sheet until import day?
3. Answered. Admin and staff can create, enter, and send purchase orders. Warehouse roles cannot. They see quantities only.
4. Which deductions define net (marketplace fees, shipping, payment fees, refurb costs)? Is settlement per sale, periodic, or a negotiated batch, and is there one settlement PO per sale or one per period?
5. Is a bin label (`20000-P`) the storage location on the Inventory sheet, or is location a shelf or a room?
6. Which taxonomies are serialized, and is a serial required for every piece before grading can finish?
7. Does freight or other landed cost join the lot pool, or stay outside item cost?
8. Confirm the clerk still cannot create the SKU, so a new item found during intake waits for a warehouse manager.
9. Should a damaged unit count as received against a known PO line?
10. Is the serial sheet only sold units, or does it also contain serials still in stock?
11. Which allocation method should an owned lot default to: manual, market price weight, ecommerce price weight, equal per unit, or by category?
12. May units from a lot be sold while their cost is still provisional?
13. Please confirm the wipe product's name (SysOps or something else) and send a sample export with its header row. Must the wipe certificate file be kept on each unit, or is a certificate reference enough?
14. Please confirm owned lots and takeouts use a project plus an upfront PO, as recommended above.
