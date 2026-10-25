# Receiving

The receiving screen posts a known SKU into a bin. The top of the form is the receipt header. The line under it is one SKU, one bin, a quantity, and a comment.

## Header

| Label | Stored as | Notes |
| --- | --- | --- |
| Project | `stock_events.project` and, when a cycle opens, `bin_cycles.project` | A combobox. Focusing it lists this person's 10 most recently used projects from receipts with their initials, newest first. Typing narrows that list. A name that is not listed is still stored as typed. |
| Receiving date | `stock_events.received_on` | Defaults to today in America/Los_Angeles. |
| Incoming bin | `stock_events.incoming_tag` and, when a cycle opens, `bin_cycles.incoming_tag` | The database column is still `incoming_tag`. |
| Originating system | `stock_events.origin_description` and, when a cycle opens, `bin_cycles.origin_description` | The database column is still `origin_description`. |
| Orig. system qty | `stock_events.origin_qty` | Optional whole number. The field label is shortened so the header stays on one row. This is the quantity the originating system reports, not the quantity put in the bin. |

A bin that already holds stock keeps the cycle it opened with. The receipt line still stores the header that was on the form.

The project field is filled when the page opens. This browser keeps the last value for this person in `localStorage`, including a cleared field. The first visit on a device, or a browser that blocks storage, uses the project on that person's latest receipt. Clear empties the field. The incoming bin, originating system, receiving date, and originating quantity stay as they are. After a save, that whole header stays filled.

## Receiving date before go-live

`RECEIVING_DATE_EDITABLE` in `lib/receivingSettings.ts` is the only switch. It is `true` for now, so the date is a date input and the chosen day is stored. Set it to `false` after go-live. The input becomes today's date, and the server stores today even if the browser sends another day.

## Line

The line is one row: a short search, the SKU, the name, the quantity, the bin, then Cleaned or Wiped when the taxonomy asks for it, then the comment. Save receipt is the save icon at the end of that row. Its tooltip is Save receipt. On a phone the fields stack. The header fields stack the same way.

Search uses the same token order as before. The SKU and name fields show the item that search selected. They are not a second search.

A CPU taxonomy shows Cleaned, unchecked. An HDD or SSD taxonomy shows Wiped, unchecked. Memory and the other taxonomies show neither box. The taxonomy is the item's short code, long code, or taxonomy name: `CPU` or `CPU/…` is a processor, and `HDD`, `SSD`, `DSK/HDD`, or `DSK/SSD` is a drive. The box starts unchecked. Checking it stores true. Leaving it stores false. The other flag stays empty. A correction writes the same values onto the receipt edit, so opening the row again shows the box as it was saved.

The bin is one code field. It starts blank. Choosing a SKU fills it with the bin from the most recent receipt of that item, on any project, when the clerk has not typed a bin. No receipt for that item leaves the field blank. The field does not show the next counter number. A code that already exists and can take stock is accepted. A bin with quantity and no open cycle is refused. A code that is not in the warehouse asks whether to create it. Yes calls `create_receiving_bin` with that code, and the suffix `-B`, `-C`, or `-P` is the type. An empty bin on save asks for one and suggests the next number from the shared counter, as a box (`20000-B` and onward). That suggestion is only in the prompt. Box, Crate, and Pallet on that prompt keep the same number and change the suffix. Yes creates that bin. The counter still lives in Settings.

A typed code that ends in `-B`, `-C`, or `-P` is that type. The database still says `Code 10099-C is a crate, but Box is selected` if an older client sends the wrong type.

The receipt stores the signed-in person's two initials. With sign-in off, that value is `OP`. Saving does not change `items.quantity`. The button stays disabled while that click is saving. The click sends one `client_request_id`. A second click during the save is ignored, and a repeat of the same id returns the line already written instead of inserting another. After a save, the header stays filled, the line fields clear, and the cursor returns to the SKU. The success note and print buttons sit in the page above the line. An empty bin reads `Put Away 4Pcs SKU94415 into EMPTY bin 10059-C`. A bin that already had stock reads `Added 4Pcs SKU94415 into bin 10059-C`. The receipt is the first row in Recent entries for that project.

## Recent entries

The table lists `receive_into_bin` rows for the project in the header, newest `received_on` first, then the time the row was written. The first page is 20 rows. Scrolling to the bottom and choosing Load more asks the server for the next page.

Columns follow the receipt, in this order: Date, Initials, Project, Incoming bin, Originating system, Originating system qty, SKU, Item name, Qty, Putaway, Comment. Putaway is the destination bin and the location stored on the receipt (`to_location_id`), for example `20042-B · HWS.00.00.00`. Each receipt is one table row with those eleven cells. The desktop headers read Date, Init., Project, Incoming bin, Orig. system, Orig. qty, SKU, Item name, Qty, Putaway, and Comment, and a header wraps only between words. The body is 13px Plus Jakarta Sans with tabular numbers, and the cells use about 6px of horizontal padding. Date, initials, project, incoming bin, SKU, originating qty, and qty stay on one line and take the width of their text. Originating system stays on one line and is at least 12 characters wide. Item name is at least 60 characters wide and ellipsizes after that. Comment uses the width that is left, at least 16 characters, and ellipsizes. The full item name and comment are the cell titles. When those columns do not fit, the table scrolls sideways and the item name stays at least 60 characters wide. Qty is right-aligned. Initials are the two letters stored on that receipt, shown in capitals. A longer value written before that rule is shown as stored. Below 800px the table is hidden and the same fields render as cards, label then value.

The server returns those fields. It does not send item prices. A role without `can_view_financials` has those price fields removed before the response is built, including prices nested on the item.

Tap a row to correct it. The same form opens on a phone. Date, project, incoming bin, originating system, originating system qty, and comment are header corrections. The ledger row is not updated. Each save writes `stock_event_edits` with who, when, and the old and new values. The row then shows the corrected values. The date stays the date. A qty or SKU change asks for confirmation, then posts a `receipt_adjustment` and moves `bin_contents` through `adjust_bin_cycle_qty`. That adjustment cannot take the bin below 0. Initials are required on every edit. They are the signed-in person's two letters, or `OP` when sign-in is off.

Apply `supabase/migrations/20261023070123_receipt_edits.sql` before corrections. It is additive. Row level security is on, and the table and functions are granted to `service_role` only. It has not been applied.

## Scanning a line

The SKU field splits the text on spaces and searches the longest token first. When two tokens are the same length, the one with both letters and digits is first. `KR M393A8G40BB4-CWE 2349` searches `M393A8G40BB4-CWE`, then `2349`, then `KR`. The line under the field says which token was used. If that token misses, the next token is tried.

The full scan is stored on `stock_events.scan_raw` only when the search tried more than one token. A single typed SKU, name, or description is not a scan. When the comment is blank, that multi-token scan is stored as the comment so the country of origin and the date code stay on the line. Apply `supabase/migrations/20261023070124_receipt_scan_raw.sql` for the column. It is additive and has not been applied. Until it is applied, a save still keeps the scan in the comment when that field was blank.

The text the operator typed to find the item is stored on `stock_events.search_query`, including a one-token search. It is not copied into the comment. Opening the receipt shows that text in Search, and a correction writes it on the receipt edit. Apply `supabase/migrations/20261025195000_receipt_search_query.sql` by hand after `supabase/migrations/20261025174500_receiving_line_checks.sql`. It is additive. It adds `search_query`, a fifteen-argument `receive_into_bin`, and a fourteen-argument `edit_receipt`. The older signatures stay. `receipt_lines` gains the search text at the end. Row level security is unchanged, and the new functions are granted to `service_role` only. It has not been applied. Until it is applied, a save still receives the line and the search text is not stored.

Country of origin and date code are not their own columns yet. A later migration can add nullable `country_of_origin` and `date_code` on `stock_events` and fill them on insert from the tokens that were not the search hit: a two-letter token as the country, and a four-digit token as the YYWW date code, only when that reading is unambiguous. `scan_raw` stays, so older lines can be read back without rewriting the ledger. Those values belong on the receipt, not on the item, because the same part ships under many date codes.

## Migrations

Apply `supabase/migrations/20261023055637_receiving_form.sql`, then `supabase/migrations/20261023061105_receive_request_id.sql`. The first one adds the receipt columns and the ten-argument `receive_into_bin`. It also leaves the eight-argument function in place: that signature stores today's date in America/Los_Angeles and a blank originating quantity, then calls the ten-argument function. The live site still uses the eight-argument signature, so dropping it before this branch is merged would stop receiving. A later migration can drop that wrapper after the new form is the only caller. The second migration stores the client request id on the new line. Receipt rows cannot be updated, so the id is written on the insert.

Apply `supabase/migrations/20261025174500_receiving_line_checks.sql` by hand before Cleaned, Wiped, and the Putaway column are stored. It is additive. It adds `stock_events.cleaned` and `stock_events.wiped`, a fourteen-argument `receive_into_bin`, and a thirteen-argument `edit_receipt`. The older signatures stay. `receipt_lines` gains the flags, the taxonomy codes, the bin, and the location. Row level security is unchanged, and the new function is granted to `service_role` only. It has not been applied.

Apply `supabase/migrations/20261025195000_receipt_search_query.sql` by hand after that migration before the receiving search text is stored. It is additive and has not been applied.
