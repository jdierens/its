# Quote reviews

A quote review is one list, reviewed as one event. Pricing office (`/pricing`) is still the placeholder for selling prices. Quote reviews are **Pricing > Quote reviews** (`/pricing/quotes`).

Apply `supabase/migrations/20261103180000_quote_events.sql`, then `supabase/migrations/20261104140000_quote_event_flow.sql`, by hand. Deploying does not run them. Apply the second file with this release. Until it is applied, the page says the tables are missing and does not write. The previous release still expects the four-way direction token, so apply the file once this release is the one being served.

## Who can open it

Quote reviews are prices. Viewing uses `can_view_financials`. Creating and editing uses `can_edit_financials`, which is admin and staff. `read_only` can view and cannot edit. A pricing officer can view and cannot edit unless that person is also admin or staff. Warehouse manager and warehouse clerk do not open the page. There is no separate clerk role that can see these prices. Status can be changed in either direction. Nothing on the event is locked.

## Two axes

Side and direction are separate. The list and the header lead with the pattern name: **Inbound Buy Request**, **Inbound Sell Request**, **Outbound Sell Request**, or **Outbound Buy Offer**. Buy, Sell, Inbound, and Outbound chips sit after that name. The page does not use “ask” as a type label.

- **Side** is the goods flow. **Buy** wins as a purchase order. **Sell** wins as a sales order.
- **Direction** is who started the ask. **Inbound** means someone else started it. **Outbound** means DDS started it.

The pattern names are:

- **Inbound Sell Request.** They asked DDS to sell. The originator is a customer, or a prospect when that company is not a customer yet. BrightStar / Josh Robinson and Globaltek / Tyler Moore are this pattern. Globaltek is also a vendor. The sell request uses the customer record and leaves `vendor_id` empty.
- **Inbound Buy Request.** They asked DDS to buy. The originator is a vendor. Mainstream Global / Joe is this pattern. Other prices on the lines are parties competing with DDS.
- **Outbound Sell Request.** DDS started a sell. The originator is DDS. The counterparty is a customer or a prospect. Hong Li’s Hong Kong market prices are this pattern, linked to the Mainstream inbound buy.
- **Outbound Buy Offer.** DDS started a buy and expects a quote back. The counterparty is a vendor.

`legacy_direction` keeps the old token (`inbound_ask`, `outbound_ask`, `inbound_response`, `outbound_offer`) for rows that had one. The page does not show it. New rows leave it null.

## Event

Each row on the list is one `quote_events` row.

- `received_on` is when the list was received or created. `due_on` is optional. A due date before the received date saves, and the page says so.
- `originator_kind` is `customer`, `prospect`, `vendor`, or `dds`.
- Inbound sell requires `customer_id` or `prospect_id`. Inbound buy requires `vendor_id`. Outbound sets `originator_kind` to `dds`. An outbound sell may also name a customer or a prospect. An outbound buy may also name a vendor.
- `counterparty_name` is the contact. The company comes from the customer, vendor, or prospect, so the list does not depend on the notes.
- `quote_prospects` is a light company that is not a customer yet. New prospect on the quote saves one. It is not a QuickBooks customer. Pick the customer later, once the company exists.
- `channel` is `whatsapp`, `email`, `sheet`, or `other`.
- `status` is `open`, `reviewing`, `bid_sent`, `won`, `lost`, or `passed`.
- `reference` is the short name of the list. It is not a generated number.
- `currency` is the currency for our prices and other bids. It defaults to USD.

The list shows the type, the originator company and contact, line count, total quantity, the sum of DDS line extensions, and the sum of quantity times the lowest other unit price when another bid has a price. Filters are originator (company, contact, or list name), status, side, direction, and due soon. Due soon is an open, reviewing, or bid-sent event whose due date is today in Pacific time or within the next 7 days, including overdue dates. Closed events are not due soon.

## Lines and bids

The list and the line tables use a 13px cell and an 11px heading, with short row padding, so more prices fit across the screen.

Above the editor, **Overview** is one row per request line: part, SKU, quantity, condition, **DDS unit**, **DDS ext**, then one column per other price (LNT, XYS, and the rest). A bidder cell shows the unit and, under it, the extension for the request quantity. A related quote adds a column for its DDS price when it has one, and a column for each of its bidders, matched on part number. Hong’s market prices show on the Mainstream overview that way.

The line grid under that is the request on the left and the DDS response on the right.

Request columns are the part number, quantity, optional target price, optional condition, and optional special requirements. `qty` is the request quantity. `target_price` is optional. `special_requirements` is optional.

DDS columns are the SKU, the item name, the reply quantity, **DDS unit**, **DDS ext**, lead time, notes, and the decision. `our_unit_price` is DDS unit. `reply_qty` is the reply quantity. When it is empty, DDS ext uses the request quantity. `our_ext` is that quantity times DDS unit, rounded to cents by the database, and null when either input is null. `lead_time` is optional. Empty means in stock, and the page shows In stock. `decision` is `bid`, `pass`, `counter`, or empty. `decision_note` is the reply note.

`item_id` is null until the part is matched, and deleting the item clears it. `part_number` can stand alone. `part_number_norm` is generated the same way as `price_quotes.part_number_norm`: uppercase, with whitespace, `-`, and `/` removed.

Other responses sit under the grid as a numbered strip: `1. CompA`, `2. CompB`, and so on. Choosing a name opens that party’s reply for every line: SKU, name, quantity, unit price, lead time, and note. Those fields live on `quote_event_bids`. Empty SKU, name, or quantity on a bid uses the line’s values as the placeholder. DDS unit and DDS ext stay in the main grid. A bidder can be saved without a price. A price needs a name.

Find item searches SKU, name, and part number. The line can stay unmatched. On-hand quantity and the latest buy and sell for a matched item are shown beside the line. They are a hook, not a full market strip.

An empty line is dropped on save. A quote can be saved with no lines. A bad price or quantity is refused. A due date is not.

## Related quotes

`quote_event_relations` is one row per unordered pair. `from_event_id` is the event the `relation_type` is spoken from, and `to_event_id` is the other event. The unique index on the lesser and greater id rejects a second row in either direction. `relation_type` is `same_list`, `forwarded_for_pricing`, `response_to`, or `other`.

Linking from the open quote stores that quote as `from_event_id`. On the other quote the same row reads the other way: "Response from" or "Forwarded as". Unlink deletes that one row.

**Create related quote** inserts a new event and that link, then copies the saved request lines. The copy keeps `item_id`, `part_number`, `sku`, `item_name`, `condition`, `qty`, `target_price`, and `special_requirements`. It leaves DDS unit, reply quantity, lead time, `decision`, `decision_note`, and every other bid empty. Currency is copied from the source. Status on the new event is open. Side, direction, and originator are whatever you enter. An inbound buy suggests an outbound sell linked as response to. An inbound sell suggests an outbound buy linked as forwarded for pricing. The copy reads the saved lines, so unsaved edits on the source are not included.

Hong Li is an outbound sell related response-to the Mainstream inbound buy. His market prices moved off the Mainstream bidder rows onto that related event. Mainstream’s remaining bidders are the parties competing with DDS.

## Item pricing

`price_quotes.quote_event_line_id` is an optional foreign key, null on existing rows, and set null when the line is deleted. Item Pricing does not read or write it yet. A later change can point a manual quote at a line without changing the quotes that are already there.

## Out of scope

Sheet and photo import is not on this page. Files are not stored on a quote review. Purchase orders and sales orders keep their own PDFs. Creating a purchase order or sales order from an event is not built. The page does not change cost or inventory. Prospects are not a full contacts book.

Row level security is on for the quote tables, including `quote_prospects`, with no anon or authenticated policy. Only `service_role` can read or write them. That is the same grant `price_quotes` has after the lockdown. The server checks `can_view_financials` and `can_edit_financials` before it uses that role.
