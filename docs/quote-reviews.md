# Quote reviews

A quote review is one list, reviewed as one event. It is the page for a vendor or customer quote that used to live only as separate rows on an item's Pricing panel. Pricing office (`/pricing`) is still the placeholder for selling prices. Quote reviews are **Pricing > Quote reviews** (`/pricing/quotes`).

Apply `supabase/migrations/20261103180000_quote_events.sql` by hand. Deploying does not run it. Until it is applied, the page says so and does not write.

## Who can open it

Quote reviews are prices. Viewing uses `can_view_financials`. Creating and editing uses `can_edit_financials`, which is admin and staff. `read_only` can view and cannot edit. A pricing officer can view and cannot edit unless that person is also admin or staff. Warehouse manager and warehouse clerk do not open the page. There is no separate clerk role that can see these prices. Status can be changed in either direction. Nothing on the event is locked.

## Event

Each row on the list is one `quote_events` row.

- `received_on` is when the list was received or created. `due_on` is optional. A due date before the received date saves, and the page says so.
- The counterparty is `vendors` when the list is from a vendor, and `counterparty_name` when it is a contact. Both can be set. The list links the vendor.
- `channel` is `whatsapp`, `email`, `sheet`, or `other`.
- `direction` is `inbound_ask` (they want our bid), `outbound_ask` (we sent a list for pricing), `inbound_response` (a priced reply came back), or `outbound_offer` (we sent our offer).
- `status` is `open`, `reviewing`, `bid_sent`, `won`, `lost`, or `passed`.
- `reference` is the short name of the list. It is not a generated number.
- `currency` is the currency for our prices and competing bids. It defaults to USD.

The list shows line count, total quantity, the sum of our line extensions, and the sum of quantity times the lowest competing unit price when a competing bid has a price. Filters are counterparty (vendor name, contact, or list name), status, and due soon. Due soon is an open, reviewing, or bid-sent event whose due date is today in Pacific time or within the next 7 days, including overdue dates. Closed events are not due soon.

## Lines and bids

`quote_event_lines` is the spreadsheet. `item_id` is null until the part is matched, and deleting the item clears it. `part_number` can stand alone. `part_number_norm` is generated the same way as `price_quotes.part_number_norm`: uppercase, with whitespace, `-`, and `/` removed. `sku` and `item_name` are the text on the list. `condition` and `qty` are free. `our_unit_price` is our price. `our_ext` is quantity times that price, rounded to cents by the database, and null when either input is null. `decision` is `bid`, `pass`, `counter`, or empty. `decision_note` is the line note.

`quote_event_bids` is a competing bidder and unit price on one line. The lowest unit price is the best competing price. A bidder can be saved without a price. A price needs a name.

Find item searches SKU, name, and part number. The line can stay unmatched. On-hand quantity and the latest buy and sell for a matched item are shown beside the line. They are a hook, not a full market strip.

An empty line is dropped on save. A quote can be saved with no lines. A bad price or quantity is refused. A due date is not.

## Related quotes

`quote_event_relations` is one row per unordered pair. `from_event_id` is the event the `relation_type` is spoken from, and `to_event_id` is the other event. The unique index on the lesser and greater id rejects a second row in either direction. `relation_type` is `same_list`, `forwarded_for_pricing`, `response_to`, or `other`.

Linking from the open quote stores that quote as `from_event_id`. On the other quote the same row reads the other way: "Response from" or "Forwarded as". Unlink deletes that one row.

**Create related quote** inserts a new event and that link, then copies the saved lines. The copy keeps `item_id`, `part_number`, `sku`, `item_name`, `condition`, and `qty`. It leaves `our_unit_price`, `decision`, `decision_note`, and every competing bid empty. Currency is copied from the source. Status on the new event is open. The new direction and counterparty are whatever you enter. An inbound ask suggests an outbound ask linked as forwarded for pricing. An outbound ask suggests an inbound response linked as response to. The copy reads the saved lines, so unsaved edits on the source are not included.

## Item pricing

`price_quotes.quote_event_line_id` is an optional foreign key, null on existing rows, and set null when the line is deleted. Item Pricing does not read or write it yet. A later change can point a manual quote at a line without changing the quotes that are already there.

## Out of scope

Sheet and photo import is not on this page. Files are not stored on a quote review. Purchase orders and sales orders keep their own PDFs. Creating a purchase order or estimate from an event is not built. The page does not change cost or inventory.

Row level security is on for the four new tables, with no anon or authenticated policy. Only `service_role` can read or write them. That is the same grant `price_quotes` has after the lockdown. The server checks `can_view_financials` and `can_edit_financials` before it uses that role.
