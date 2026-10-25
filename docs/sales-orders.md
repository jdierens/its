# Sales orders

Phase 1 is the manual sales order: a draft, lines, SKU allocations, customer notes, a customer PO file, and approval. Fulfillment and invoice tables are created now so later phases do not add them. Capture from email and WhatsApp is not in this phase. An eBay pull can create a draft under the one eBay customer for an order dated 1 Jan 2026 or later. Jan reviews that draft and approves it. The pull does not assign `so_number` and does not approve the order. Orders dated before that stay out of the pull.

Sales orders do not share tables, counters, payment terms, or carrier checks with purchase orders. `so_counter` is separate from `po_counter`. Terms live in `so_payment_terms` (Net 7 is stored as `Net7` and sent to QuickBooks as `Net 7`). Ship methods live in `so_ship_methods` (DHL WPX, FedEx IP, UPS Saver, and so on).

## Number

A draft has no number. `so_number` is an integer, and the order is shown as `SO` plus that integer, for example `SO27766`. `so_counter` is seeded at 27766, the next number at go-live.

Approval suggests the lowest unused number at or above the counter. The person approving can type a different number. `approve_sales_order` locks `so_counter`, rejects a number that is already on a sales order, and never moves the counter backwards. A number above the counter moves the counter past it. A number below the counter is allowed when it is free, and the counter stays where it is. Cancelling keeps a number that was already issued.

eBay orders use this same series. `ebay_order_id` is unique when set, and `ebay_sales_record_ref` stores the eBay sales record reference. A draft created from eBay still has no number. Approval assigns it from `so_counter`, the same way as any other draft.

Before the first eBay pull, seed `ebay_order_id` and `ebay_sales_record_ref` from the legacy log map (Order Number and Sales Record No on the row whose REF is that SO number). The map stays out of git. Admin > Integrations > eBay accepts the CSV, updates matching sales orders, and does not create orders. Pull orders stays off until that seed row exists. Inside the 2026 window, an eBay order that already matches `ebay_order_id`, or a single `ebay_sales_record_ref`, updates that sales order instead of inserting another one. The customer on a new draft is the existing eBay Customer record. Buyer name and username are stored on the order. No per-buyer customer is created.

The internal reference is a separate note on the order. The SO number itself is the reference assigned at approval.

## Channel

`source` is how the order arrived: manual, email, WhatsApp, or eBay. `channel` is a different fact, a foreign key to `so_channels`: `ebay`, `broker_reseller`, `direct`, `supermicro_ff`, `oem_end_user`, `take_out`, `project_buy`, and `other`. Row level security is on, and only `service_role` can read or write that table.

`sheet_ref` is indexed and is not unique. `legacy_journal_ref` is nullable text and is not unique. The manual form does not fill either one.

## Invoices

`so_invoices.seq` is 1, 2, 3, and so on for that sales order. The display number is generated: seq 1 is `INV` plus the sales-order number (`INV27766`), and later invoices are `INV27766-2`, `INV27766-3`. The ITS invoice is the one the customer receives. `qbo_invoice_id`, `qbo_doc_number`, and `qbo_synced_at` are on the invoice for the later QuickBooks upload. An invoice cannot be inserted until the sales order has a number.

## Lines

`so_lines.line_kind` is `product`, `kit`, `freight`, `fee`, `service`, `discount`, or `other`. The default is `product`. The item is `so_line_allocations.item_id`, the same role as `po_lines.item_id`, and a product line can be several SKUs. Approval requires those quantities to add up to the line only when the kind is `product`. Freight, a fee, a service, a discount, a kit, and other do not need an item. Any allocation that is present still has to add up. Kit contents are not expanded. There is no link from a sales-order line to a purchase-order line.

## Approve

A product line needs allocations whose quantities add up to the line. Several SKUs on one line are allowed, and a one-to-one line is still one allocation row. Approval also requires a customer, order date, bill-to and ship-to line 1, terms, ship method, sales rep initials, and at least one line. The check is in the database function.

Suggested SKUs are a prefix match after uppercasing and stripping spaces, `/`, and `-`. A customer part shorter than 3 characters does not match. Nothing is picked automatically.

## Addresses and money

Bill-to and ship-to are copied from the customer and can be edited. **Save address to customer** writes them back with `updateContact`. A customer that already has a QuickBooks id is marked `pending`, and the existing customer push sends the change. If ship-to line 2 is blank, attention is copied into line 2. The ship-to phone updates the customer phone.

Choosing a customer also fills customer PO, internal reference, channel, order date, requested ship date, terms, Incoterms, ship method, and carrier account from that customer's latest sales order.

Unit price, extension, order total, internal notes, and the eBay money columns are removed on the server when `can_view_financials` is false. Those columns are `ebay_transaction_fee`, `ebay_label_fee`, `ebay_ad_fee`, and `ebay_order_earnings`, all nullable. Admin, staff, and read-only can see prices. Other roles see parts and quantities. Files can contain prices, so those roles receive no attachments. Admin and staff can edit. Read-only cannot.

`payment_method` is a foreign key to `so_payment_methods`: `wire_ach`, `ebay`, `credit_card`, `check`, `paypal`, and `other`. `payment_date` and `payment_ref` record when and under what reference the payment arrived. Those three are not amounts. Row level security is on for `so_payment_methods`, and only `service_role` can read or write it.

## History

`write_sales_order`, `approve_sales_order`, and `cancel_sales_order` each insert an `so_events` row with the operator initials and the database time. Adding or removing a file does the same. `so_events` rejects updates and deletes.

## Migration

`supabase/migrations/20261024070800_sales_orders.sql` is additive. It also adds nullable `customers.merged_into_customer_id` (no rows are updated) and adds `conversion` to the inventory-movement reference check while keeping every reference type that is already allowed. Apply it by hand. This change does not run it against production.

If the move-inventory migration is applied after this one and its reference-type list does not include `conversion`, that later migration would drop `conversion`. Apply this file after that one, or add `conversion` to that list before applying it second.

Pages: `/sales/orders`, `/sales/orders/new`, and `/sales/orders/[id]`.
