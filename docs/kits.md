# Kits and bundles

A kit is an item in the existing SKU series. Its item type is Kit/Package. The name is stored as given, including `/`. A name such as `DL360G10-S8/CSRF90_2/S240_2/M32R4_16/R408/P80_2/_K` is not rewritten with backslashes.

Two taxonomies hold kits. Kit server is `KIT/SRV` / `KTS`. Kit bundle is `KIT/BDL` / `KTB`. Their sort order is after the taxonomies that already exist. A Kit/Package item must use one of those two. An item in either taxonomy must be Kit/Package. Service items are unchanged.

A bundle is a kit with exactly one distinct component, such as a pair of CPUs. A server kit can have several components. A component cannot be another kit. A kit cannot contain itself.

## Generic parts

`items.is_generic` marks a bare spec with no manufacturer part number, such as `MEM\PC4-2400T-R\32G\2Rx4`. Product names keep backslashes. Kit names keep slashes. Nothing in the item screen or the import rewrites one into the other. The item page and the items list show a Generic badge. The list filter Generic only keeps those rows, together with the item type filter.

## Recipe

The Recipe tab on a Kit/Package item adds, edits, and removes components and quantities. Qty and the quantity field are right-aligned. Each component shows the Generic badge when it is a generic part. Opening a component item lists the kits that use it.

On create, condition and ECCN are defaults and can be edited. A server kit takes its condition from the one chassis component, taxonomy `CHA/*` or `SYS/SRV`. If there is not exactly one, the person chooses the condition. Its ECCN defaults to `5A992.C`. A bundle copies both condition and ECCN from its only component. Apply kit defaults on the Recipe tab fills those values.

`updated_by` on a recipe row stays null when a bot writes it.

## Sales order lines

Apply `supabase/migrations/20261024070800_sales_orders.sql` before `supabase/migrations/20261024100100_kit_sales_lines.sql`. Until those tables exist, the sales-order line page says that sales order lines are not available yet. The items list, the recipe tab, and the Sales orders page do not read them.

Approving a sales order copies the kit recipe onto `so_line_components`. The planned part stays. The actual part starts as the planned part, except a generic planned part starts empty. Swap can pick any non-kit SKU except a generic part. A generic item is not offered as the actual part, and the database rejects a generic `actual_item_id`. Substitutes are listed first and never limit the picker. A reason is required when the actual part differs from the planned part.

A generic component must have a non-generic actual part before the line is picked, shipped, or invoiced. The database blocks those steps, and Release line on the sales-order line page does the same.

Quote, pro forma, invoice, and packing slip show the kit line only. The pick ticket and the sales-order line page show every component, mark swaps, and say Pick physical part while a generic component is still open.

`so_line_allocations.so_line_component_id` links a component pick to that row.

`inventory_movements.ref_type` gains `conversion` for turning an existing item into a kit. The import writes the audit row in `kit_events`, not a ledger quantity.

## Import

The script is not run by the app. It reads CSV paths you pass:

Production is reached by pasting SQL. `--emit-sql` does not connect. It inlines the CSV rows and lets the database look up SKUs, taxonomies, and history. It writes `apply.sql`, `rollback.sql`, and `verify.sql` under `--out` only.

```
node --experimental-strip-types --import ./test/register.mjs scripts/import-kits.ts \
  --kits kits.csv \
  --recipes recipes.csv \
  --generics generics.csv \
  --out tmp/kit-import \
  --emit-sql
```

Paste `apply.sql` first. It is one transaction and raises if a create SKU exists, a convert SKU is missing or already has history, a component is missing or is a kit, a quantity is not positive, or a bundle does not have one component. `verify.sql` returns expected and actual counts for kits, recipe rows, generics, and bundles. `rollback.sql` deletes created kits and restores converted items from the conversion audit.

A local database can still be used directly. Without `--apply`, that path only writes `snapshot.json`, `rollback.sql`, and `plan.sql`.

```
node --experimental-strip-types --import ./test/register.mjs scripts/import-kits.ts \
  --kits kits.csv \
  --recipes recipes.csv \
  --generics generics.csv \
  --out tmp/kit-import \
  --db "dbname=its_stock"
```

Add `--apply` to write. The script refuses a remote host.

`kits.csv` columns: `sku`, `name`, `taxonomy_code` (`KIT/SRV` or `KIT/BDL`), `action` (`create` or `convert`).

`recipes.csv` columns: `kit_sku`, `component_sku`, `qty_per_kit`.

`generics.csv` column: `sku`.

A create stops if the SKU exists. A convert stops unless the SKU exists and has no inventory movement, purchase line, quote, or sales allocation. Every component must exist and must not be Kit/Package. Quantities must be greater than zero. A bundle must have one distinct component. Created kits use the defaults above. A convert changes item type and taxonomy and writes a `conversion` event with `updated_by` null. The SKU counter uses `greatest`, so imported SKUs at or below 107124 do not move a counter that is already at 107188 or later. The apply transaction checks that the counter did not go backwards, then checks kit, recipe, and generic counts and that every imported bundle has one component. `rollback.sql` undoes that apply.

Do not commit the CSV files or the snapshot.

## Migrations

Review and apply by hand, in this order:

1. `supabase/migrations/20261024100000_kits.sql`
2. `supabase/migrations/20261024070800_sales_orders.sql` if it is not already applied
3. `supabase/migrations/20261024100100_kit_sales_lines.sql`

`kit_components`, `item_substitutes`, `kit_events`, and `so_line_components` have row security on and are granted to `service_role` only. `kit_events` is append-only. The import rollback disables that trigger only long enough to delete the conversion rows it wrote.
