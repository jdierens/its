# Item pricing

An existing item shows **Pricing** under the item form. Ecommerce price, market price, and MSRP are USD. Each price stores the time it last changed. Saving the item form does not change them. **Save prices** writes only those three amounts.

**Update pricing** looks up the part number. When the part number is blank, it uses the model. Each result is a new price quote. Older quotes stay. **Last updated** is the time of that lookup.

- eBay listed prices use the Browse API `item_summary/search` with an application token. The token is a client-credentials grant from `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`. The scope is `https://api.ebay.com/oauth/api_scope`. The token is not stored.
- eBay sold prices use Marketplace Insights and stay off unless `EBAY_INSIGHTS_ENABLED=true`. That API needs eBay approval.
- BrokerBin stays off unless `BROKERBIN_API_KEY` is set. With a key, the provider reports that lookup is not connected yet.

The page lists which providers ran, how many quotes they returned, and any error. A price under 30% or over 300% of the median for its currency is kept and marked as an outlier. One price in a currency is not marked.

**Price references** lists every quote for that item. The query is `item_id` equal to the open item, so a research row with no item stays off this panel. The newest quote for each source is highlighted. Column headers sort the table. Each row shows a relative time such as `captured 2h ago` and the exact Pacific time. **Add quote** records a manual observation, such as a BrokerBin quote or an inbound quote.

`price_quotes` also holds market research for a part that is not an item yet. `item_id` is nullable and `on delete set null`. A row needs an item or a part number. `part_number` is the MPN as seen at the source. On insert, `price_quotes_fill_part_number` copies it from the linked item when it is empty: `items.part_number`, then `oem_part_number`, then `model`. `part_number_norm` is generated: uppercase, with whitespace, `-`, and `/` removed. Match that value to `items.part_number` normalized the same way, then to `items.oem_part_number`. Set `item_id` only when exactly one item matches. `manufacturer_id` is the controlled manufacturer. `manufacturer_name` is the name as seen at the source. `model`, `taxonomy_id`, `condition_note`, and `listing_date` are optional. `listing_date` is when the listing sold or ended. `captured_at` is when we saw it. `condition` stays the raw source text. `condition_class` is New, New Open Box, Refurbished, Used, or For Parts. `listing_type` is asking, sold, quote, or offer. `source` also allows `web_listed`.

`price` is the unit price, excluding shipping, in `currency`. `qty` is the number of units in the listing or lot. The lot total is `price` times `qty`. `shipping` is the shipping charge for the whole listing. Null means unknown. Zero means free.

**Transactions** lists buys and sells. Filter by type and by date. **Add transaction** records a manual row. The total is quantity times unit price, rounded to cents in the database. A sell can name a customer. A buy can name a vendor. A later QuickBooks or eBay import can insert rows the same way. The same source, reference, and item cannot be inserted twice.

**Admin > Settings** has **Pricing/sales window (days)** and a **Labels** section. The window starts at 90. Last sold price and last bought price are the newest transaction of that type. Quantity sold, revenue, average sell price, quantity bought, and spend count transactions inside the window. The item label starts as Barcode (current) unless a template was already saved. QR code is the other item choice. Pallet, Crate, Box, and Rack location show as coming soon. A missing or unknown item template stays on the barcode.

`price_quotes`, `item_transactions`, and `app_settings` hold prices, the sales window, and the label templates. `label_template_item` is the item template. `label_template` is the older key and is still read when the new one is missing. They are not credentials. Row level security stays off on them, matching `items`.
