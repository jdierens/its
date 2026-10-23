# Receiving

The receiving screen posts a known SKU into a bin. The top of the form is the receipt header. The line under it is one SKU, one bin, a quantity, and a comment.

## Header

| Label | Stored as | Notes |
| --- | --- | --- |
| Project | `stock_events.project` and, when a cycle opens, `bin_cycles.project` | The recent list shows receipts for the project typed here. |
| Receiving date | `stock_events.received_on` | Defaults to today in America/Los_Angeles. |
| Incoming bin | `stock_events.incoming_tag` and, when a cycle opens, `bin_cycles.incoming_tag` | The database column is still `incoming_tag`. |
| Originating system | `stock_events.origin_description` and, when a cycle opens, `bin_cycles.origin_description` | The database column is still `origin_description`. |
| Orig. system qty | `stock_events.origin_qty` | Optional whole number. The field label is shortened so the header stays on one row. This is the quantity the originating system reports, not the quantity put in the bin. |

A bin that already holds stock keeps the cycle it opened with. The receipt line still stores the header that was on the form.

## Receiving date before go-live

`RECEIVING_DATE_EDITABLE` in `lib/receivingSettings.ts` is the only switch. It is `true` for now, so the date is a date input and the chosen day is stored. Set it to `false` after go-live. The input becomes today's date, and the server stores today even if the browser sends another day.

## Line

The first line row is the Existing/New control, a bin code about ten characters wide with its lookup, and the quantity. The comment is the next row, full width. On a phone the header fields stack. The bin control, code, and quantity stay on one compact row.

A new bin can take the next number, or a typed code. When the typed code ends in `-B`, `-C`, or `-P`, that suffix is the type sent to `create_receiving_bin`, so `10099-C` is a crate even if Box was still selected. If an older client still sends the wrong type, the database says `Code 10099-C is a crate, but Box is selected.`

The receipt stores the signed-in person's two initials. With sign-in off, that value is `OP`. Saving does not change `items.quantity`. The button stays disabled while that click is saving. The click sends one `client_request_id`. A second click during the save is ignored, and a repeat of the same id returns the line already written instead of inserting another. After a save, the header stays filled, the line fields clear, and the cursor returns to the SKU. The success note and print buttons sit in the page above the line. The receipt is the first row in Recent entries for that project.

## Recent entries

The table lists `receive_into_bin` rows for the project in the header, newest `received_on` first, then the time the row was written. The first page is 20 rows. Scrolling to the bottom and choosing Load more asks the server for the next page.

Columns follow the receipt, in this order: Date, Initials, Project, Incoming bin, Originating system, Originating system qty, SKU, Item name, Qty, Comment. Each receipt is one table row with those ten cells. Qty is right-aligned. A long item name stays in its cell, truncated, and the full name is the cell title. Initials are the two letters stored on that receipt, shown in capitals. A longer value written before that rule is shown as stored. Below 800px the table is hidden and the same fields render as cards, label then value.

The server returns those fields. It does not send item prices. A role without `can_view_financials` has those price fields removed before the response is built, including prices nested on the item.

Tap a row to correct it. The same form opens on a phone. Date, project, incoming bin, originating system, originating system qty, and comment are header corrections. The ledger row is not updated. Each save writes `stock_event_edits` with who, when, and the old and new values. The row then shows the corrected values and an edited marker. A qty or SKU change asks for confirmation, then posts a `receipt_adjustment` and moves `bin_contents` through `adjust_bin_cycle_qty`. That adjustment cannot take the bin below 0. Initials are required on every edit. They are the signed-in person's two letters, or `OP` when sign-in is off.

Apply `supabase/migrations/20261023070123_receipt_edits.sql` before corrections. It is additive. Row level security is on, and the table and functions are granted to `service_role` only. It has not been applied.

## Scanning a line

The SKU field splits the text on spaces and searches the longest token first. When two tokens are the same length, the one with both letters and digits is first. `KR M393A8G40BB4-CWE 2349` searches `M393A8G40BB4-CWE`, then `2349`, then `KR`. The line under the field says which token was used. If that token misses, the next token is tried.

The full scan is stored on `stock_events.scan_raw`. When the comment is blank, that same text is stored as the comment so the country of origin and the date code stay on the line. Apply `supabase/migrations/20261023070124_receipt_scan_raw.sql` for the column. It is additive and has not been applied. Until it is applied, a save still keeps the scan in the comment when that field was blank.

Country of origin and date code are not their own columns yet. A later migration can add nullable `country_of_origin` and `date_code` on `stock_events` and fill them on insert from the tokens that were not the search hit: a two-letter token as the country, and a four-digit token as the YYWW date code, only when that reading is unambiguous. `scan_raw` stays, so older lines can be read back without rewriting the ledger. Those values belong on the receipt, not on the item, because the same part ships under many date codes.

## Migrations

Apply `supabase/migrations/20261023055637_receiving_form.sql`, then `supabase/migrations/20261023061105_receive_request_id.sql`. The first one adds the receipt columns and the ten-argument `receive_into_bin`. It also leaves the eight-argument function in place: that signature stores today's date in America/Los_Angeles and a blank originating quantity, then calls the ten-argument function. The live site still uses the eight-argument signature, so dropping it before this branch is merged would stop receiving. A later migration can drop that wrapper after the new form is the only caller. The second migration stores the client request id on the new line. Receipt rows cannot be updated, so the id is written on the insert.
