# Print forms

Invoice, order confirmation, and the pick ticket print from the browser. The print dialog can save a PDF. The app does not build a PDF itself.

Item labels, bin labels, and serial labels stay on their Brother rolls. Purchase orders, the pack sheet, and receiving do not have a form to print. A later packing list that uses the customer-document layout gets this paper and this footer.

Paper is US Letter. Invoice and order confirmation are portrait. The on-screen sheet is already 8.5 inches wide, and the print margins match that sheet's padding, with a taller bottom margin for the footer. The pick ticket is landscape. Its table is about 48rem wide, which is wider than the portrait content box, so landscape keeps the SKU, name, and quantities on one line.

A form that fits on one page has no page number. A form that continues onto another page shows the page at the bottom center as `1 of 3`. The order confirmation always starts a second page for the terms, so it is numbered, and the count includes that page. An invoice with a short line list stays blank in the footer.

Turn headers and footers off in the print dialog. The browser otherwise adds its own date, address, and `1/1` beside the form's number.

The page rules are in `app/globals.css`. `lib/letterPrint.ts` measures the form at the letter content width. Each customer-document article is its own run of pages, because the terms article starts on a new page. The pick ticket is one run. The measure chooses the numbered page only when that count is more than one. The margin numbers in the stylesheet and in that file are the same.
