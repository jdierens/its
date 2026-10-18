# ITS

Inventory app for the ITS Supabase project. The item list shows the primary photo, sku, name, quantity, and taxonomy. Create and edit use taxonomies, allowed attribute values, and photos.

## Try it

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project's publishable or anon key. Do not commit that file.
3. Run `npm install`, then `npm run dev`.
4. Open http://localhost:3000.

Create an item from **New item**. The taxonomy field lists existing taxonomies and accepts a new name. A new name is created when you save, matched without regard to case. On the selected taxonomy you can add an attribute (name, integer/decimal/text, optional unit, and whether it uses an allowed-value list).

Attribute fields with a list accept a listed value or a new one. Integer and decimal values are checked before save. A new value is written into `attribute_values` in the same `create_item` or `update_item` call. Numeric lists are ordered by number.

Photos upload to the private `item-images` bucket. On an existing item they save immediately. On a new item they upload after the item row is created. The list uses the primary image.

**Print labels** opens `/labels`. Look up an item by SKU or uuid, enter the quantity to print and how many copies (default 1), then print. The quantity is only printed on the label. It does not change the item's stock. The edit page has a **Print label** button that opens this page with the item filled in.

The label is one 90 mm × 29 mm landscape page, for a Brother QL-820NWB with DK-1201 (29 × 90 mm) die-cut labels. The item name stays on one line. The font shrinks so a name of up to 80 characters fits the label width without wrapping or being cut off. The barcode is Code 128 from [JsBarcode](https://github.com/lindell/JsBarcode), encoding the SKU, or the item id when the SKU is empty. That same value is printed in small type under the bars. Bars are sized to a whole number of 300 dpi dots (4 dots wide, or 3 if the code is long).

From a Mac browser, use these print-dialog settings:

- Paper size: 29 × 90 mm
- Orientation: Landscape
- Scale: 100%
- Margins: None
- Headers and footers: off

## Database

Migrations live in `supabase/migrations`. Deploying this repo does not apply them. They are already applied on project `fxsbpreasbdalwthyzvk`. On a new database, run them in order in the SQL editor.

`attribute_values` holds the allowed values. `attributes.uses_list` turns that list on. `item_images` points at files in the `item-images` bucket (`<item_id>/<image_id>.<ext>`). The bucket is private, with a 5 MB limit and JPEG, PNG, WebP, and GIF only.

Storage policies on `storage.objects`, for `anon` and `authenticated`, bucket `item-images` only:

- `item_images_read` (select): authenticated download, object info, and signed URLs. Listing the bucket is not allowed.
- `item_images_insert` (insert): upload.
- `item_images_delete` (delete): remove a file.

There is no update policy, so objects cannot be overwritten. Deleting a photo removes the file through the Storage API and then deletes the `item_images` row. Storage does not allow deleting `storage.objects` from a database trigger.

Row level security is disabled on `items`, `taxonomies`, `attributes`, `item_attributes`, `attribute_values`, and `item_images`. The anon key can read and write those rows. This app does not turn RLS on. Enabling it without policies would block the client.

`npm run typecheck` and `npm run build` both need to pass.
