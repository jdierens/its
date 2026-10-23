# Data management

Admin import and export for tables that already exist. The first table is bins, so a box, crate, or pallet that already has a code can be registered without the print desk assigning the next number. Locations can be exported. Their import can be added later with the same registry.

Sign-in must be on and the person must be an admin. When sign-in is off, the desk is open, matching the other warehouse settings. The server checks the role again on every import and export. The nav item is hidden from anyone who is not an admin.

## Registry

Each table is a column spec in `lib/data/registry.ts`. A column has a key, whether it is required, whether it is in the template, whether it is exported, whether it is money, a format, an example, and header synonyms. The template, the instructions sheet, the mapper, and the row checks all read that spec. Money columns are omitted from an export when the role cannot see prices. Bins have no money columns.

The natural key for bins is `code`. The policy is insert. An existing code is skipped and is never updated.

## Bins

Import columns:

| Column | Required | Format |
|---|---|---|
| code | Yes | `^\d{5}-[BCP]$` |
| location | No | An existing location code |
| note | No | Text, up to 2000 characters, stored in `bins.notes` |

The suffix sets the type: B box, C crate, P pallet. A 1–4 digit code is zero-padded. A code with no suffix can take Box, Crate, Pallet, or B, C, or P from a separate Type column. Type is not a template column.

A location must already exist. Import looks up `locations.code`. It does not call `resolve_location`, so it does not create a place. A blank location uses `bin_default_locations` for that suffix. An unknown code is an error.

The number is unique across suffixes. `20000-B` already on file makes `20000-C` an error. The same code is reported as already exists and is skipped. A repeated code or number in the file is an error on the later row. The first row is classified normally.

Nothing imported has an open cycle, stock, or a printed label. `created_by_initials` is recorded the same way receiving records it. Each new bin gets a `bin_events` row of type `created` and a `stock_events` row of type `bin_imported` with `source` `import`.

If any imported number is greater than or equal to `bin_counter.next_number`, the counter becomes one past the highest imported number. The result says when that happened. A dry run and any file that still has an error write nothing, and the counter stays put.

An optional checkbox prints 29×90 mm labels for the bins that were just imported, through the existing reprint path, one copy each.

Export columns are code, type, current location, open-cycle project, origin, quantity on that cycle, created time, initials, print count, and last printed time. At most 5,000 rows are exported.

## Files

The browser reads the file. The raw spreadsheet is not uploaded. CSV may be comma, semicolon, or tab separated, with or without a UTF-8 BOM. Excel `.xlsx` and `.xls` use SheetJS. The first sheet is selected, and a sheet picker appears when there are several.

The template download is CSV and `.xlsx`. The header is the ITS column names, then one sample row: `12345-B`, `HWS.01.02.03`, `existing shelf box`. Required columns are marked on the page and on a second sheet named Instructions. That sheet lists each import column, required or optional, the format, an example, and the allowed values, including B, C, and P and the prefixes from `location_types`.

## Mapping

After the file is read, headers are matched to ITS fields. Matching compares a normalized name (lowercase, punctuation treated as space) with the column key and its synonyms. `Bin`, `Bin #`, `Bin code`, and `Container` match code. `Loc`, `Location`, and `Shelf` match location. The mapping table shows the ITS field, the source column, and a few sample values. A required field with no column blocks the dry run. Source columns that are not mapped are ignored and listed. The last mapping for each table is stored in `localStorage` under `its.dataMap.<table>`, so the next file with the same headers continues in one step.

The dry run then shows new, already exists, or error with the reason. Import sends only the mapped JSON rows. `import_bins` runs in one transaction and repeats the same checks.

## Limits and access

At most 5,000 data rows, and a file larger than 2 MB is refused in the browser. Row level security stays on. `import_bins` is security definer with an empty search path, and execute is granted to `service_role` only.

The migration is `supabase/migrations/20261023041000_import_bins.sql`. It is additive. It has not been applied. Apply it by hand before relying on import. It does not change the receiving migration that is already applied.
