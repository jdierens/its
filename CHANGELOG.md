# Changelog

## 0.17.0

- Edit cells in the items table. Enter, double-click, or typing starts the edit. Enter and Tab save and move. Esc cancels. SKU and taxonomy stay read-only.
- Manufacturer, condition, country, and new-item condition notes use the same lists as the item form. Taxonomy attribute columns follow the field type and pick list.
- Each cell saves on its own, with a saving, saved, or error mark. A changed `updated_at` reloads that row instead of overwriting it. The Edited column shows when the row last changed.
- Select several rows and set condition, country of origin, or ECCN on all of them after a confirmation.

## 0.16.0

- Export items from the items page to a new Google Sheet or a CSV download. Current view follows the taxonomy filter and search, and includes every matching item. All items ignores those filters.
- The sheet is named `ITS items export YYYY-MM-DD HH:mm` in Pacific time, created in a shared Drive folder, with the header row frozen. CSV still downloads when Google is not configured.
- Include pricing columns when those fields exist. Attribute columns are one per attribute name across the exported taxonomies.

## 0.15.0

- Open a photo by clicking its thumbnail, or by pressing Enter when it is focused. Delete stays a corner icon and asks for confirmation.
- Show Taxonomy as the second column on the items table, between the photo and the SKU. Arrow keys still move across the cells in that order.
- Reorder photos by dragging, or with the left and right arrow keys. The order saves immediately. The first photo is the primary image. `is_primary` stays for the deployed app and is filled from that order until a later cleanup.
- Add new photos at the end. Saving an edit adds the new photo just after the original.

## 0.14.0

- Edit ecommerce, market, and MSRP prices on the item page. Each price keeps its own updated time.
- Keep price quotes as history. The item page shows the latest quote for each source and the full list, with the captured time. Add a manual quote for BrokerBin, an inbound quote, or another source.
- Update pricing looks up the part number, or the model, and stores eBay listed prices. eBay sold prices stay off unless Marketplace Insights is enabled. BrokerBin stays off until an API key is set. Prices far from the median are kept and marked.
- Record buy and sell transactions on the item, with last price and window totals. Admin > Settings sets the pricing and sales window, starting at 90 days.

## 0.13.0

- Store manufacturer, model, part number, condition, and trade-compliance fields on the item itself. Condition starts as Used. ECCN starts as 5A992.C. Country of origin stays empty until it is set.
- Keep manufacturers on a list with aliases. Search suggests close names before adding one. Admin > Manufacturers can rename, edit aliases, and merge two names. Existing Manufacturer and Brand values are copied once, without deleting the old fields.
- Show Manufacturer, Model, Part number, and Condition on the items table. Search and filter include the manufacturer name and its aliases.

## 0.12.0

- Choose customers, vendors, and direction on Admin > Integrations, with a full resync option. Sync customers and Sync vendors run one entity. The last choice is remembered in the browser.
- Keep a separate last-sync time and change cursor for customers and vendors. Syncing one does not move the other. An existing shared cursor is copied onto both.
- Name the QuickBooks request, HTTP status, Intuit fault, and intuit_tid in sync errors. A sandbox/production mismatch says which environment to set.

## 0.11.0

- Add a taxonomy from Taxonomies & Fields, with a long code, a short code, and fields linked from another taxonomy. Delete a taxonomy only when no items use it.
- Share field definitions across taxonomies. Link an existing field, link every field from another taxonomy, reorder fields per taxonomy, and merge two fields of the same type. A label keeps separate definitions when the name, type, and unit already collide.
- Show Save changes on a taxonomy row only after the name or codes change. Reordering still saves on its own.
- Capitalize the Taxonomies & Fields menu, breadcrumb, and page title.

## 0.10.0

- Connect an eBay seller account: OAuth, token refresh, and the marketplace account deletion endpoint. Listing creation, quantity sync, order import, and tracking push come later.

## 0.9.0

- #1 Show taxonomy attributes on the item form.
- #2 Add attribute lists, item photos, and 90×29 mm labels.
- #3 Add taxonomy long and short codes and print the short code on labels.
- #4 Add an in-browser photo editor that saves a new gallery image.
- #5 Add an app shell and a dense keyboard-navigable items table.
- #6 Sync QuickBooks Online customers and vendors.
- #7 Add a public privacy policy and terms of use.
- #8 Harden QuickBooks OAuth (discovery, 401 retry, reconnect, CSRF, intuit_tid).
- #9 Show the app version and git revision under the sidebar title.
