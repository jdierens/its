# ITS

Inventory app for the ITS Supabase project. A sidebar groups Inventory, Sales, Purchasing, Warehouse, Pricing, and Admin. The item list at `/items` is a dense table. Filter by taxonomy short code and search SKU, name, description, and attribute values on the server (`ilike`). The address keeps `?tax=` and `?q=`. Arrow keys move the cell and Enter opens the item. Create and edit use taxonomies, allowed attribute values, and photos.

## Try it

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project's publishable or anon key. Do not commit that file.
3. Run `npm install`, then `npm run dev`.
4. Open http://localhost:3000.

Create an item from **New item**. The taxonomy field lists existing taxonomies in `sort_order` and accepts a new name. A new name is created when you save, matched without regard to case, and needs a long code (like `CRD/NIC`) and a 3-character short code (like `NIC`). Both are uppercased as you type and stored in uppercase. The new taxonomy is placed at the end of the order. On the selected taxonomy you can add an attribute (name, integer/decimal/text, optional unit, and whether it uses an allowed-value list).

**Taxonomies & fields** opens `/taxonomies`. Edit the name, long code, and short code, then save the row. Drag a row, or use Up and Down, to change `sort_order`. That order is what the item form lists. **Fields** on a taxonomy adds, renames, and deletes its attributes (type, unit, and whether they use a list) and reorders the allowed values. A field or value that items already use cannot be deleted.

Deleting an item asks for confirmation, then removes the item, its attribute values, and its photos, including the files in storage. The original row is not left behind.

Attribute fields with a list accept a listed value or a new one. Integer and decimal values are checked before save. A new value is written into `attribute_values` in the same `create_item` or `update_item` call. Numeric lists are ordered by number.

Photos upload to the private `item-images` bucket. On an existing item they save immediately. On a new item they upload after the item row is created. The list uses the primary image.

**Edit** on a saved photo opens the editor. Auto-improve adjusts brightness, contrast, white balance, and sharpness, with a before/after toggle. Crop includes a free rectangle and a 1:1 square, and the photo can rotate 90 degrees. Remove background runs in the browser with `@imgly/background-removal` (the smaller `isnet_quint8` model) and can leave white or transparency. Redact drags a rectangle that is pixelated, or filled solid when the area is small, into the pixels. Saving adds a new gallery photo and does not replace the original. `source_image_id` records which photo it came from. A white background exports as JPEG at quality 0.92, keeping the edited size and at least 1600 px on the long side when the photo is that large. A transparent background exports as PNG.

**Print labels** opens `/labels`. Look up an item by SKU or uuid, enter the quantity to print and how many copies (default 1), then print. The quantity is only printed on the label. It does not change the item's stock. The edit page has a **Print label** button that opens this page with the item filled in.

The label is one 90 mm × 29 mm landscape page, for a Brother QL-820NWB with DK-1201 (29 × 90 mm) die-cut labels. The item name stays on one line. Names longer than 60 characters are cut to 60 and end with an ellipsis. The font shrinks so a name of up to 60 characters fits the label width. The barcode is Code 128 from [JsBarcode](https://github.com/lindell/JsBarcode), encoding the SKU, or the item id when the SKU is empty. That same value is printed in bold under the bars, about 3 to 4 mm cap height when the code is short. Bars stay at least 8 mm tall and a whole number of 300 dpi dots (4 dots wide, or 3 if the code is long). The quantity number in the middle is about 8.4 mm and bold, with a small QTY caption under it. That caption, the item ID, and the print date share one baseline. The barcode, quantity number, and taxonomy short code share one top line. The short code stays large and bold, and the date is spaced to the same width so their edges line up. An item with no taxonomy leaves that spot empty.

Seeded codes, in display order:

| Order | Taxonomy | Long code | Short code |
| --- | --- | --- | --- |
| 1 | server | SYS/SRV | SRV |
| 2 | memory | DIM/MEM | MEM |
| 3 | HDD | DSK/HDD | HDD |
| 4 | SSD | DSK/SSD | SSD |
| 5 | network card | CRD/NIC | NIC |
| 6 | HBA card | CRD/HBA | HBA |
| 7 | transceiver | OPT/TRX | TRX |
| 8 | switch | NET/SWT | SWT |
| 9 | network cable | NET/CBL | CBL |

From a Mac browser, use these print-dialog settings:

- Paper size: 29 × 90 mm
- Orientation: Landscape
- Scale: 100%
- Margins: None
- Headers and footers: off

## QuickBooks customers and vendors

**Contacts** in the sidebar lists customers and vendors. **Admin > Integrations** connects QuickBooks Online. The app has no Intuit credentials until you add them. Lists and forms work before that. Sync runs after the connection is saved.

Copy these into `.env.local`. They are server-only. Do not prefix them with `NEXT_PUBLIC_` and do not commit the file.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Server key for `qbo_connection`. The browser never sees tokens. |
| `QBO_CLIENT_ID` | Intuit app client id |
| `QBO_CLIENT_SECRET` | Intuit app client secret |
| `QBO_REDIRECT_URI` | Must match a redirect URI on the Intuit app |
| `QBO_ENVIRONMENT` | `sandbox` or `production` |

For local dev, register this redirect URI on the Intuit app and set `QBO_REDIRECT_URI` to the same value:

`http://localhost:3000/api/qbo/callback`

Intuit matches the URI exactly. If you open the app at `http://127.0.0.1:3000` instead, register `http://127.0.0.1:3000/api/qbo/callback` and set the env var to that. Production keys require `https`. Sandbox keys can use `http://localhost`.

Connect starts at `/api/qbo/connect`, which sends the browser to Intuit with scope `com.intuit.quickbooks.accounting` and a short-lived CSRF cookie. Intuit returns to `/api/qbo/callback`, which stores the company id and tokens. Disconnect calls Intuit's revoke endpoint and deletes the local row. Access tokens are refreshed when they are close to expiry. Sandbox and production use the same OAuth host. `QBO_ENVIRONMENT` chooses `https://sandbox-quickbooks.api.intuit.com` or `https://quickbooks.api.intuit.com`.

**Sync now** pushes ITS rows marked local, pending, or error, then pulls. A conflict stays put until you edit the contact again. The first successful pull reads every active and inactive customer and vendor. Later syncs use change data capture from the last successful pull, with a two-minute overlap. Rows match on `qbo_id`. An update sends the QuickBooks `SyncToken`. If QuickBooks returns a stale-object error (5010), ITS refetches that record, keeps the QuickBooks version, and logs the discarded local edit. Inactive QuickBooks records stay in the list with Active set to No.

Customer tax id is `ResaleNum`. Vendor tax id is `TaxIdentifier`. Vendor notes and shipping addresses stay in ITS, because QuickBooks vendors do not store them. Clearing an email, phone, or address in ITS leaves the previous QuickBooks value in place; the next pull keeps that QuickBooks value. Setting Active to off is sent.

## Database

Migrations live in `supabase/migrations`. Deploying this repo does not apply them. They are already applied on project `fxsbpreasbdalwthyzvk`. On a new database, run them in order in the SQL editor.

`attribute_values` holds the allowed values. `attributes.uses_list` turns that list on. `taxonomies.long_code` and `taxonomies.short_code` are unique and nullable. A trigger uppercases them, and check constraints keep `long_code` equal to `upper(long_code)` and `short_code` matching `^[A-Z0-9]{3}$`. `taxonomies.sort_order` is the list order. `item_images` points at files in the `item-images` bucket (`<item_id>/<image_id>.<ext>`). The bucket is private, with a 10 MB limit and JPEG, PNG, WebP, and GIF only.

Storage policies on `storage.objects`, for `anon` and `authenticated`, bucket `item-images` only:

- `item_images_read` (select): authenticated download, object info, and signed URLs. Listing the bucket is not allowed.
- `item_images_insert` (insert): upload.
- `item_images_delete` (delete): remove a file.

There is no update policy, so objects cannot be overwritten. Deleting a photo removes the file through the Storage API and then deletes the `item_images` row. Storage does not allow deleting `storage.objects` from a database trigger.

Row level security is disabled on `items`, `taxonomies`, `attributes`, `item_attributes`, `attribute_values`, `item_images`, `customers`, `vendors`, and `qbo_sync_log`. The anon key can read and write those rows. This app does not turn RLS on for them. Enabling it without policies would block the client.

`qbo_connection` is the exception. Row level security is enabled and there are no policies for `anon` or `authenticated`. Their grants are revoked. Only the service role, from server route handlers, can read the tokens.

`npm run typecheck` and `npm run build` both need to pass.
