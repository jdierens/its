---
bump: minor
---

- A forecasted sales price is a bidder of class FSP. It has a 3-character column code, an optional bid note, and a unit price, the same way a competitive bidder or a market estimate does.
- Export PDF heads each bid column with that code. Bid notes print under the table. Quantity is a whole number with thousands separators.
- When a quote has both a DDS price and an FSP price, the PDF adds FGP$ and FGP%. FGP$ is the FSP extension minus the DDS extension. FGP% is that profit divided by the FSP extension. The footer sums FGP$ and divides that sum by the total FSP extension.
- The quote sticky hint says Unsaved changes or All changes saved. Save, Export XLS, and Export PDF on that bar are icon buttons.
- Apply supabase/migrations/20261105195000_quote_bidder_classes.sql by hand. Deploying does not run it. The file copies existing fsp_unit values onto an FSP bidder, then clears fsp_unit.
