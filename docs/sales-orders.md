# Sales orders

Phase 1 is the manual sales order: a draft, lines, SKU allocations, customer notes, a customer PO file, and approval. Fulfillment and invoice tables are created now so later phases do not add them. Capture from email, WhatsApp, and eBay is not in this phase.

Sales orders do not share tables, counters, payment terms, or carrier checks with purchase orders. `so_counter` is separate from `po_counter`. Terms live in `so_payment_terms` (Net 7 is stored as `Net7` and sent to QuickBooks as `Net 7`). Ship methods live in `so_ship_methods` (DHL WPX, FedEx IP, UPS Saver, and so on).

## Number

A draft has no number. `approve_sales_order` assigns plain digits from `reserve_sales_order_number`, which locks `so_counter` and skips numbers already used. The counter is seeded at 1 as a placeholder. Set `next_number` from QuickBooks before the first real approval. If the draft already has an all-digit `qbo_doc_number`, approval uses that number and moves the counter past it. Cancelling keeps a number that was already issued.

## Approve

Every line needs allocations whose quantities add up to the line. Several SKUs on one line are allowed, and a one-to-one line is still one allocation row. Approval also requires a customer, order date, bill-to and ship-to line 1, terms, ship method, sales rep initials, and at least one line. The check is in the database function.

Suggested SKUs are a prefix match after uppercasing and stripping spaces, `/`, and `-`. A customer part shorter than 3 characters does not match. Nothing is picked automatically.

## Addresses and money

Bill-to and ship-to are copied from the customer and can be edited. **Save address to customer** writes them back with `updateContact`. A customer that already has a QuickBooks id is marked `pending`, and the existing customer push sends the change. If ship-to line 2 is blank, attention is copied into line 2. The ship-to phone updates the customer phone.

Choosing a customer also fills customer PO, internal reference, order date, requested ship date, terms, Incoterms, ship method, and carrier account from that customer's latest sales order.

Unit price, extension, order total, and internal notes are removed on the server when `can_view_financials` is false. Admin, staff, and read-only can see prices. Other roles see parts and quantities. Files can contain prices, so those roles receive no attachments. Admin and staff can edit. Read-only cannot.

## History

`write_sales_order`, `approve_sales_order`, and `cancel_sales_order` each insert an `so_events` row with the operator initials and the database time. Adding or removing a file does the same. `so_events` rejects updates and deletes.

## Migration

`supabase/migrations/20261024070800_sales_orders.sql` is additive. It also adds nullable `customers.merged_into_customer_id` (no rows are updated) and adds `conversion` to the inventory-movement reference check while keeping every reference type that is already allowed. Apply it by hand. This change does not run it against production.

If the move-inventory migration is applied after this one and its reference-type list does not include `conversion`, that later migration would drop `conversion`. Apply this file after that one, or add `conversion` to that list before applying it second.

Pages: `/sales/orders`, `/sales/orders/new`, and `/sales/orders/[id]`.
