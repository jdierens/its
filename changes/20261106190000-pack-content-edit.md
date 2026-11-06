---
bump: patch
---

- A packed quantity is edited in the overview, in that package's column. It can go up to what is still unpacked, or down to 0. Another SKU is packed by editing that SKU's cell. The cell shows the quantity already there, not the remainder. Serials stay on the picked item.
- Above the packages, an overview lists each SKU, its name, the quantity picked, what remains, and the quantity in each package. Those package quantities are edited in the overview.
- The package list below is only Box, Type, Dim, and Weight. Weight stays editable. Contents are not edited again on the package row.
- Package lines are vertically centered, so the box, the dimensions, and the weight line up.
- Apply `supabase/migrations/20261106190000_pack_content_edit.sql` by hand on project `fxsbpreasbdalwthyzvk` after `supabase/migrations/20261106150000_pack_row_packages.sql`. Deploying does not run it. It was not applied from this change.
