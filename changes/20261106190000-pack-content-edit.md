---
bump: patch
---

- A packed item on a package row can change quantity, up to what is still unpacked, or change to another unpacked pick line. The package does not have to be deleted. Adding a new quantity still starts at 1. Serials stay on the picked item.
- Above the packages, an overview lists each SKU, its name, the quantity picked, what remains, and the quantity in each package.
- Apply `supabase/migrations/20261106190000_pack_content_edit.sql` by hand on project `fxsbpreasbdalwthyzvk` after `supabase/migrations/20261106150000_pack_row_packages.sql`. Deploying does not run it. It was not applied from this change.
