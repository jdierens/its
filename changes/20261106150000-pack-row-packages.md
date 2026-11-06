---
bump: minor
---

- The pack sheet is one row per package. Add a package, set its weight, then add unpacked pick contents on that row. Item quantity starts at 1. Serial is available only when the pick has serials, and the serial uses the item already on the pick.
- Duplicate copies a complete package into the next one. The row stays editable after that, including after finish. A correction that leaves the pack incomplete opens it again. A shipped order stays shipped.
- Finish packing is the save icon at the top of the sheet. It stays grey until finish can run.
- Apply `supabase/migrations/20261106150000_pack_row_packages.sql` by hand after `supabase/migrations/20261106010000_pack_edit_after_finish.sql`. Deploying does not run it.
