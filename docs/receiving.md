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

Saving does not change `items.quantity`. The button stays disabled while that click is saving. The click sends one `client_request_id`. A second click during the save is ignored, and a repeat of the same id returns the line already written instead of inserting another. After a save, the header stays filled, the line fields clear, and the cursor returns to the SKU. The success note and print buttons sit in the page above the line. The receipt is the first row in Recent entries for that project.

## Recent entries

The table lists `receive_into_bin` rows for the project in the header, newest `received_on` first, then the time the row was written. The first page is 20 rows. Load more asks the server for the next page. Column headings are shortened so the date and originating quantity stay on screen. On a phone each row is a card: SKU and quantity, then bin and date, then the comment, then the incoming bin, originating system, and originating quantity as “orig qty 8”.

The server returns date, SKU, bin, quantity, comment, received by, incoming bin, originating system, and originating system qty. It does not send item prices. A role without `can_view_financials` has those price fields removed before the response is built, including prices nested on the item.

## Migrations

Apply `supabase/migrations/20261023055637_receiving_form.sql`, then `supabase/migrations/20261023061105_receive_request_id.sql`. The first one adds the receipt columns and the ten-argument `receive_into_bin`. It also leaves the eight-argument function in place: that signature stores today's date in America/Los_Angeles and a blank originating quantity, then calls the ten-argument function. The live site still uses the eight-argument signature, so dropping it before this branch is merged would stop receiving. A later migration can drop that wrapper after the new form is the only caller. The second migration stores the client request id on the new line. Receipt rows cannot be updated, so the id is written on the insert.
