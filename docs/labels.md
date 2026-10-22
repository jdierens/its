# Item labels

**Labels** (`/labels`) prints the 90 mm × 29 mm item label. The layout, barcode, and QR template are described in `docs/items.md`. This page is the lookup.

One row holds the search field, **Qty on label**, **Copies**, and **Print**. The search field is about 25 characters wide. Enter runs the search. Typing searches on its own after a short pause. A barcode scanner that types and sends Enter uses the same field. A small clear icon inside the field empties it. There is no separate Search button. The search runs on the server through the service role, the same approved-user check as the rest of the item reads, and the response has no prices.

- The text is an exact SKU, ignoring case (`107132`) → that item is selected and the label is prepared. No extra confirmation.
- Other text (`SRM7C`) is a case-insensitive partial match on SKU, name, and description. `%`, `_`, and `\` in the text are escaped so they are not LIKE wildcards.
- One match on Enter selects that item. The page does not ask you to pick 1 of 1.
- Several matches show a short list under that row: SKU, name, and a one-line description. Tap or click a row. On a desktop keyboard, Up and Down move and Enter picks the highlighted row.
- Nothing matches → **No items found**.
- Typing can search on its own. A SKU prefix does not select an item while you are still typing, even if only one row matches. An exact SKU does.
- The list stops at 25 rows and says to refine the search when more exist.

A link from the item page still opens `/labels?sku=` or `/labels?id=` and prepares that item. **Qty on label** is a whole number from 0 to 9999, right-aligned, and does not change stock. **Copies** is a whole number from 1 to 99, right-aligned, and starts at 1. A blank quantity becomes 0. A blank or zero copy count becomes 1. **Print** is a printer icon. Its name and tooltip are Print. It stays off until an item is selected, and it is a 44px target. On a narrow phone the row wraps onto two lines, with the search field on the first line and quantity, copies, and Print on the second.

`supabase/migrations/20261021210000_label_lookup_trgm.sql` adds trigram indexes on `items.name` and `items.description`. SKU already has one. The search works before that file is applied. It is not applied.
