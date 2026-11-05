# Quote requests

A quote request is one list, reviewed as one event. Pricing office (`/pricing`) is still the placeholder for selling prices. Quote requests are **Pricing > Quote requests** (`/pricing/quotes`). The address stays `/pricing/quotes`.

Apply `supabase/migrations/20261103180000_quote_events.sql`, then `supabase/migrations/20261104140000_quote_event_flow.sql`, then `supabase/migrations/20261105040000_quote_line_alts_and_awards.sql`, then `supabase/migrations/20261105060000_quote_won_partial.sql`, then `supabase/migrations/20261105155000_quote_line_fsp.sql`, then `supabase/migrations/20261105180000_quote_bid_columns.sql`, by hand. Deploying does not run them. Apply the latest file with this release. Until the quote tables exist, the page says they are missing and does not write. Until the won-partial file is applied, awarding only some lines cannot store that status. Until the FSP file is applied, opening a quote request cannot load `fsp_unit`. Until the column-code file is applied, opening a quote request cannot load `dds_column_code`.

## Who can open it

Quote requests are prices. Viewing uses `can_view_financials`. Creating and editing uses `can_edit_financials`, which is admin and staff. `read_only` can view and cannot edit. A pricing officer can view and cannot edit unless that person is also admin or staff. Warehouse manager and warehouse clerk do not open the page. There is no separate clerk role that can see these prices. Status can be changed in either direction. Nothing on the event is locked.

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
- The customer and vendor fields are type-to-filter lists. Each keystroke asks the server for names that contain that text, a short list, instead of loading the customer table. The customer search hides eBay-sourced customers in the query: `primary_email` ending in `@members.ebay.com` (QuickBooks buyer cards from eBay’s anonymized mailbox), and the customer named `eBay Customer` (the one record the order pull uses). A display name that only contains “ebay”, such as a reseller, stays. Those rows are not deleted. A quote that already points at one still shows that customer. Search on the quote list still matches them, including names past the first thousand.
- `counterparty_name` is the contact. The company comes from the customer, vendor, or prospect, so the list does not depend on the notes.
- `quote_prospects` is a light company that is not a customer yet. New prospect on the quote saves one. It is not a QuickBooks customer. Pick the customer later, once the company exists.
- `channel` is `whatsapp`, `email`, `sheet`, or `other`.
- `status` is `open`, `reviewing`, `bid_sent`, `won`, `won_partial`, `lost`, or `passed`. Won partial means some lines were awarded and some were not.
- `reference` is the short name of the list. It is not a generated number.
- `currency` is the currency for our prices and other bids. It defaults to USD.

The list shows the type, the originator company and contact, line count, total quantity, the sum of DDS line extensions, and the sum of quantity times the lowest other unit price when another bid has a price. Filters are originator (company, contact, or list name), status, side, direction, and due soon. Due soon is an open, reviewing, or bid-sent event whose due date is today in Pacific time or within the next 7 days, including overdue dates. Closed events are not due soon.

## Lines and bids

The list and the line tables use a 13px cell and an 11px heading, with short row padding, so more prices fit across the screen.

Above the editor, **Overview** is one row per request line: part, SKU, quantity, condition, then **DDS unit** with DDS ext under that unit, then **FSP unit** with FSP ext under that unit, then one column per other price (LNT, XYS, and the rest). A bid column uses its 3-character code as the heading when one is entered. The bidder name, or DDS, sits under that code. With no code, the heading stays DDS unit or the bidder name. FSP is not a bid and keeps the heading FSP unit. Every price cell shows the unit and, under it, the extension for the request quantity. DDS ext and FSP ext use the reply quantity when that is filled in. Extensions display as whole currency units, with no cents. Unit prices keep cents. A total row under the columns sums each column’s extensions as those same whole dollars. A related quote adds a column for its DDS price when it has one, and a column for each of its bidders, matched on part number. Hong’s market prices show on the Mainstream overview that way. The list total stays the sum of DDS extensions. It does not add FSP.

The line grid under that is the request on the left and the DDS response on the right. Header fields and line fields size to the value in them. A short quantity stays narrow. A long part number or name grows until a cap, then the text scrolls inside the field. Dates stay a date control. Notes stay full width. Below 800px the stacked fields use the full row.

Request columns are the part number, quantity, optional target price, optional condition, and optional special requirements. `qty` is the request quantity. `target_price` is optional. `special_requirements` is optional.

DDS columns are the SKU, the item name, the reply quantity, **DDS unit** with DDS ext under that unit, **FSP unit** with FSP ext under that unit, lead time, notes, and the decision. **Best** under the DDS unit is one unit from this line’s bids and the related quotes loaded with the page. Outbound buy and inbound sell use the lowest of those units. Inbound buy and outbound sell use the highest. Editing a bid here updates it immediately. It is not a price stored on the line, and it is not the item’s ecommerce or market price. The quote list’s Best competing total is still the lowest local bid only. `our_unit_price` is DDS unit. `fsp_unit` is the forecasted sales price. It is a separate column from the DDS bid. `reply_qty` is the reply quantity. When it is empty, DDS ext and FSP ext use the request quantity. `our_ext` is that quantity times DDS unit, and `fsp_ext` is that quantity times `fsp_unit`. Both are rounded to cents by the database, and null when either input is null. The page shows each extension as a whole number. There is no margin column. A dollar gap and a percent do not share a base, and a buy bid is not the same kind of price as a sell bid. `lead_time` is optional. Empty means in stock, and the page shows In stock. `decision` is `bid`, `pass`, `counter`, or empty. `decision_note` is the reply note. An award still uses the DDS unit, or the winning bidder’s unit. It does not use FSP. The DDS unit heading on this grid uses the column code when one is set.

`item_id` is null until the part is matched, and deleting the item clears it. `part_number` can stand alone. The SKU on the line is the primary response item. `quote_event_line_alts` holds optional alternative SKUs for that same line: part, SKU, name, optional item, and optional unit price. The primary stays when an alternative is added, edited, or removed. An alternative extension uses the reply quantity, or the request quantity, and displays as whole dollars. Alternatives are not copied onto a related quote. `part_number_norm` is generated the same way as `price_quotes.part_number_norm`: uppercase, with whitespace, `-`, and `/` removed.

`quote_events.dds_column_code` is the DDS column heading. It is exactly 3 letters or digits, stored uppercase, or null. A shorter code is refused. `quote_events.dds_bid_note` is the comment for the DDS bid as a whole, up to 500 characters, or null. It is not `decision_note`. The DDS code and comment are edited on the bidder strip, above the other responses.

`quote_event_bidders` is one row per competing bidder on the quote. `column_code` and `bid_note` are that bidder’s heading and comment. Line prices, SKUs, and line notes stay on `quote_event_bids`. Two bidders on one quote cannot share a name, ignoring case. DDS and the other bids on the same quote cannot share a column code. A related quote does not copy the code or the comment.

Other responses sit in a numbered strip directly under the overview: `1. CompA`, or `1. HPE · CompA` when that bidder has a code. A related quote is on that strip too, after the responses, using the same party name as the related-quotes table. Choosing a response opens that party’s reply for every line: SKU, name, quantity, unit price, lead time, and note. The column code and the bid comment sit above that reply. Choosing a related quote opens that quote. Those reply fields live on `quote_event_bids`. Empty SKU, name, or quantity on a bid uses the line’s values as the placeholder. DDS unit and DDS ext stay on the DDS column. A bidder can be saved without a price. A price needs a name.

**Export XLS** downloads the lines as a spreadsheet. The columns are SKU, Name, and Qty. Name is the item name, or the part number when the name is empty. Qty is the reply quantity when that is filled in, otherwise the request quantity. The file is `.xlsx`. The button says Export XLS.

**Export PDF** opens `/pricing/quotes/<id>/print`. The sheet is portrait US Letter. The header is the list name, the party, the quote type, the received date, and the export date. The table is Name, Qty, Bid unit, Bid ext, FMP unit, and FMP ext. Bid is the DDS unit and its extension. FMP is the forecasted sales price, the same amount as `fsp_unit` and `fsp_ext`. Extensions are whole dollars, the same as the overview. The total row sums quantity and both extensions. Save as PDF is the browser print dialog. The app does not store a PDF on the quote. A quote that has not been saved yet can export the spreadsheet. The PDF waits until the quote has an id. Column codes and bid comments stay on the quote. They are not columns on this sheet.

Find item searches SKU, name, and part number. The line can stay unmatched. On-hand quantity and the latest buy and sell for a matched item are shown beside the line. They are a hook, not a full market strip.

An empty line is dropped on save. A quote can be saved with no lines. A bad price or quantity is refused. A due date is not.

## Award

Award sits under the line detail. Check the lines that won, or use Award every line. Each awarded line names who won it, DDS or a bidder on that line, and the quantity. The quantity can be less than the request. DDS uses the primary item and the DDS unit. A bidder uses that bidder’s unit. A bidder SKU that differs from the primary is ordered as that SKU, without the primary item.

Create draft purchase order on a buy, or create draft sales order on a sell. Only the awarded lines are copied. The vendor or customer is the quote’s party. A prospect is not a customer yet, so a sell needs a customer first. Prices and quantities come from the award. The draft’s internal note names the quote request, and `purchase_orders.quote_event_id` or `sales_orders.quote_event_id` stores the link. The purchase-order draft is warehouse, Net 30, and unnumbered. The sales-order draft leaves channel, terms, and payment blank. Neither draft is approved.

Creating that draft, or opening the one that already exists, leaves this page for `/purchasing/orders/<id>` or `/sales/orders/<id>`. The quote header and the award section show that order number, or Draft PO / Draft SO when it has no number, as a link, until the order is cancelled. When every line is awarded, status becomes won. When only some lines are awarded, status becomes won partial. The lines that were not awarded stay on the quote.

Save sits at the top of the quote and again under the lines. It stays disabled until the header or lines differ from the last save, and it shows Unsaved changes. Ctrl or Cmd+S saves. Leaving by a link, browser back, or a trackpad swipe asks before those edits are discarded.

## Related quotes

`quote_event_relations` is one row per unordered pair. `from_event_id` is the event the `relation_type` is spoken from, and `to_event_id` is the other event. The unique index on the lesser and greater id rejects a second row in either direction. `relation_type` is `same_list`, `forwarded_for_pricing`, `response_to`, or `other`.

Linking from the open quote stores that quote as `from_event_id`. On the other quote the same row reads the other way: "Response from" or "Forwarded as". Unlink deletes that one row.

**Create related quote** inserts a new event and that link, then copies the saved request lines. The copy keeps `item_id`, `part_number`, `sku`, `item_name`, `condition`, `qty`, `target_price`, and `special_requirements`. It leaves DDS unit, FSP, the DDS column code, the DDS comment, reply quantity, lead time, `decision`, `decision_note`, and every other bid empty. Currency is copied from the source. Status on the new event is open. Side, direction, and originator are whatever you enter. An inbound buy suggests an outbound sell linked as response to. An inbound sell suggests an outbound buy linked as forwarded for pricing. The copy reads the saved lines, so unsaved edits on the source are not included.

Hong Li is an outbound sell related response-to the Mainstream inbound buy. His market prices moved off the Mainstream bidder rows onto that related event. Mainstream’s remaining bidders are the parties competing with DDS.

## Item pricing

`price_quotes.quote_event_line_id` is an optional foreign key, null on existing rows, and set null when the line is deleted. Item Pricing does not read or write it yet. A later change can point a manual quote at a line without changing the quotes that are already there.

## Out of scope

Sheet and photo import is not on this page. Files are not stored on a quote request. Purchase orders and sales orders keep their own PDFs. An award creates a draft only. The page does not change cost or inventory. Prospects are not a full contacts book. Competing bidder rows do not have their own alternative SKUs. Alternatives belong to the DDS response line.

Row level security is on for the quote tables, including `quote_prospects`, with no anon or authenticated policy. Only `service_role` can read or write them. That is the same grant `price_quotes` has after the lockdown. The server checks `can_view_financials` and `can_edit_financials` before it uses that role.
