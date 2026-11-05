# Print forms

Invoice, order confirmation, the pick ticket, and a quote request print from the browser. The print dialog can save a PDF. The app does not build a PDF itself.

Item labels, bin labels, and serial labels stay on their Brother rolls. The pack sheet and receiving do not have a form to print. A purchase order prints on the same portrait letter sheet as the order confirmation. The title is PURCHASE ORDER, and that sheet does not include the terms page. A later packing list that uses the customer-document layout gets this paper and this footer.

Paper is US Letter. Invoice, order confirmation, and the purchase order are portrait. The on-screen sheet is already 8.5 inches wide, and the print margins match that sheet's padding, with a taller bottom margin for the footer. The pick ticket and the quote export are landscape. The pick table is about 48rem wide, which is wider than the portrait content box, so landscape keeps the SKU, name, and quantities on one line. A quote export is Name, Qty, then one column per bidder headed by that bidder’s 3-character code. Quantity is a whole number with thousands separators. When the quote has both a DDS price and an FSP price, the table also has FGP$ and FGP%. FGP$ is the FSP extension minus the DDS extension. FGP% is that profit divided by the FSP extension. The footer repeats those totals: the dollar total is the sum of the line profits, and the percent is that sum divided by the total FSP extension. Bid notes print under the table. The header carries the quote and the export date. The print dialog saves that sheet as a PDF.

A form that fits on one page has no page number. A form that continues onto another page shows the page at the bottom center as `1 of 3`. The order confirmation always starts a second page for the terms, so it is numbered, and the count includes that page. An invoice with a short line list stays blank in the footer.

Turn headers and footers off in the print dialog. The browser otherwise adds its own date, address, and `1/1` beside the form's number.

The page rules are in `app/globals.css`. `lib/letterPrint.ts` measures the form at the letter content width. Each customer-document article is its own run of pages, because the terms article starts on a new page. The pick ticket is one run. The measure chooses the numbered page only when that count is more than one. The margin numbers in the stylesheet and in that file are the same.
