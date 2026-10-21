# Duplicate an item

**Duplicate** on an item opens the new-item form filled from that item. Nothing is saved until Save. The items list has no row menu, so the action is on the item page.

The SKU box shows the next number, the same preview as a new item. That number is assigned when you save. The original SKU is never filled in. If you type a SKU, it cannot be the original one.

The name is filled in and must change. Save stays blocked, with a message on the name, while the name matches the original after trimming and ignoring case. Item names are not unique in the database. Two different items can share a name. A duplicate of one item cannot keep that item's name.

## Copied

- Name, which must change before save
- Description and notes
- Taxonomy, and each saved attribute value
- Item type, manufacturer, model, and part number
- OEM name, OEM part number, and product page
- Unit, condition, and condition note
- ECCN, US HTS, CCATS, and country of origin
- Ecommerce price, market price, and MSRP, only when the signed-in role can see money

While sign-in is off, the form shows those prices. With sign-in on, admin, staff, and read-only see them. A warehouse role does not. The server leaves the prices off the response, and it does not write them if that role saves.

## Not copied

- Id
- SKU
- On-hand quantity. The field starts empty
- Bin and location assignments. Those stay on the stock ledger
- Purchase-order and receiving links
- Photos and other attachments
- External listing and sync ids. Items have no eBay or QuickBooks id column. Quote rows and buy/sell rows, including eBay sources, stay on the original
- Created and updated times, price-updated times, and the pricing-checked time
- Taxonomy-change history

## Ambiguous

Notes are copied. A taxonomy change can append removed values there, so the copy can include that history.

The condition note is copied. A grade such as Grade A may live in the name, the note, or both. The name must change. The note stays so it can be edited.

The product page is copied. It may be the listing for the original grade.

The three prices are copied for someone who can see money. Quote history is not. Clear a price before saving if the new grade should not keep it.

Quantity is left empty, which saves as no quantity, the same as a new item with the field blank. It is not saved as zero.
