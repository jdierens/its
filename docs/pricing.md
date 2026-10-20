# Item pricing

An existing item shows **Pricing** under the item form. Ecommerce price, market price, and MSRP are USD. Each price stores the time it last changed. Saving the item form does not change them. **Save prices** writes only those three amounts.

**Update pricing** looks up the part number. When the part number is blank, it uses the model. Each result is a new price quote. Older quotes stay. **Last updated** is the time of that lookup.

- eBay listed prices use the Browse API `item_summary/search` with an application token. The token is a client-credentials grant from `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`. The scope is `https://api.ebay.com/oauth/api_scope` and `https://api.ebay.com/oauth/api_scope/buy.browse`. The token is not stored.
- eBay sold prices use Marketplace Insights and stay off unless `EBAY_INSIGHTS_ENABLED=true`. That API needs eBay approval.
- BrokerBin stays off unless `BROKERBIN_API_KEY` is set. With a key, the provider reports that lookup is not connected yet.

The page lists which providers ran, how many quotes they returned, and any error. A price under 30% or over 300% of the median for its currency is kept and marked as an outlier. One price in a currency is not marked.

**Price references** lists every quote. The newest quote for each source is highlighted. Column headers sort the table. Each row shows a relative time such as `captured 2h ago` and the exact Pacific time. **Add quote** records a manual observation, such as a BrokerBin quote or an inbound quote.

**Transactions** lists buys and sells. Filter by type and by date. **Add transaction** records a manual row. The total is quantity times unit price, rounded to cents in the database. A sell can name a customer. A buy can name a vendor. A later QuickBooks or eBay import can insert rows the same way. The same source, reference, and item cannot be inserted twice.

**Admin > Settings** has **Pricing/sales window (days)** and a **Labels** section. The window starts at 90. Last sold price and last bought price are the newest transaction of that type. Quantity sold, revenue, average sell price, quantity bought, and spend count transactions inside the window. The item label starts as Barcode (current) unless a template was already saved. QR code is the other item choice. Pallet, Crate, Box, and Rack location show as coming soon. A missing or unknown item template stays on the barcode.

`price_quotes`, `item_transactions`, and `app_settings` hold prices, the sales window, and the label templates. `label_template_item` is the item template. `label_template` is the older key and is still read when the new one is missing. They are not credentials. Row level security stays off on them, matching `items`.
