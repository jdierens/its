---
bump: minor
---

- Each bid on a quote request has a 3-character column code and a bid note. DDS keeps its code and note on the quote. Other bidders keep theirs on the bidder.
- Overview and line columns use that code as the heading. The bidder name stays on the bidder strip and under the code.
- Export XLS downloads SKU, Name, and Qty. Export PDF is a portrait letter sheet with the quote header, the export date, and Name, Qty, Bid unit, Bid ext, FMP unit, and FMP ext. The total row sums quantity and both extensions. FMP is the forecasted sales price.
- Apply supabase/migrations/20261105180000_quote_bid_columns.sql by hand. Deploying does not run it.
