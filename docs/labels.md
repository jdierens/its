# Item labels

**Labels** (`/labels`) prints the 90 mm × 29 mm item label. The layout, barcode, and QR template are described in `docs/items.md`. This page is the lookup.

One row holds **Search**, **Qty on label**, **Copies**, and **Print**. Each name sits above its field in the same caption style. The fields share one top and one height. **Print** is the same height as those fields and lines up with them. The search field shows about 25 characters. **Qty on label** and **Copies** are at least as wide as their captions, so the caption and the field share one column and the caption stays left-aligned. The numbers stay right-aligned, with the same horizontal padding as Search and extra room on the right for the caret. Enter runs the search. Typing searches on its own after a short pause. A barcode scanner that types and sends Enter uses the same field. A small clear icon inside the field empties it. There is no separate Search button. The search runs on the server through the service role, the same approved-user check as the rest of the item reads, and the response has no prices.

- The text is an exact SKU, ignoring case (`107132`) → that item is selected and the label is prepared. No extra confirmation.
- Other text (`SRM7C`) is a case-insensitive partial match on SKU, name, and description. `%`, `_`, and `\` in the text are escaped so they are not LIKE wildcards.
- One match on Enter selects that item. The page does not ask you to pick 1 of 1.
- Several matches show a short list under that row: SKU, name, and a one-line description. Tap or click a row, or press Enter on the highlighted row. That selects the item the same way an exact SKU does: the field shows the SKU (or the name when the SKU is empty), the label preview loads, and Print turns on. A blur of the search field does not clear that list before the row is chosen. If Print cannot run, the page says why.
- Nothing matches → **No items found**.
- Typing can search on its own, after a short pause. The field keeps what you type. A result is applied only when the field still shows the text that was searched, so a slower reply cannot replace a newer string. A SKU prefix does not select an item while you are still typing, even if only one row matches. An exact SKU does, once that pause lands on the exact SKU.
- The list stops at 25 rows and says to refine the search when more exist.

A link from the item page still opens `/labels?sku=` or `/labels?id=` and prepares that item. **Qty on label** is a whole number from 0 to 9999, right-aligned, and does not change stock. **Copies** is a whole number from 1 to 99, right-aligned, and starts at 1. A blank quantity becomes 0. A blank or zero copy count becomes 1. Both use the same typeface as Search, with tabular figures. **Print** is a printer icon. Its name and tooltip are Print. It stays off until an item is selected, and it matches the height of the fields beside it. On a narrow phone, Search is the full width of the first line. Qty on label, Copies, and Print sit on the second line, in that order. Each caption stays above its field, Print lines up with the inputs, and those controls are at least 44px on the touch side.

`supabase/migrations/20261021210000_label_lookup_trgm.sql` adds trigram indexes on `items.name` and `items.description`. SKU already has one. The search works before that file is applied. It is not applied.
