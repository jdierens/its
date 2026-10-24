# Advanced search

**Advanced search** on the items page opens `/items/search`. There are two tabs. The filters are in the address, so a search can be shared or bookmarked. **Clear** removes the part number and the field filters and keeps the tab and the taxonomy. Every change refreshes the list after a short pause on typed values. On a phone the fields stack, and the inputs stay at 16px so iOS Safari does not zoom.

## Filter by taxonomy

Pick a taxonomy. Its fields show in `taxonomy_attributes` order, with the name and unit above each control.

A field with `uses_list` is a list of the values that actually occur on items of that taxonomy, ordered by `attribute_values.sort_order`. Each value shows how many items have it. Several values on one field match with OR. Fields combine with AND. The counts on the other lists update from the current filters. A value with no remaining matches stays in the list and is dimmed.

An integer or decimal field that does not use a list has a minimum and a maximum. A listed numeric field, such as memory `capacity_gb`, stays a list.

Results show SKU, name, manufacturer, part number, and on-hand quantity. Quantity is right-aligned. The SKU opens the item.

## Similar part

Type a part number. It is matched to `items.part_number`, then `oem_part_number`, then `model`, after uppercasing and removing whitespace, `/`, and `-`. That is the same normalization as `price_quotes.part_number_norm`. The new-item form does not identify a part, and this search does not call a paid API.

When an item matches, its taxonomy and attribute values fill the filters. The item itself is left out of the results. Other items are ranked by how many of those values they still have. Exact matches come first. Each row can show `matches N of M fields`. Loosen or tighten the filters after that.

When no item matches, a `price_quotes` row with the same `part_number_norm` can still name a taxonomy. Its attribute values are not stored, so the fields start empty. When nothing matches, the page says: Part number not found. Pick a taxonomy to search by fields.

## API and database

`GET /api/items/search` reads the same query string as the page. When sign-in is on (`AUTH_REQUIRED=true`), it requires an approved session. When sign-in is off, it uses the service role, the same way the items list does. The response has no price columns. A role without `can_view_financials` still has those keys removed if a row ever carries them.

`supabase/migrations/20261024055420_item_attribute_search.sql` is not applied. Review it and run it in the SQL editor before relying on the functions. It adds `item_attributes_attribute_value_idx` on `(attribute_id, value)` and two functions, both `security definer` with an empty `search_path`:

- `search_items_by_attributes(p_taxonomy_id uuid, p_filters jsonb, p_limit int, p_offset int)` returns the items, `match_count`, `seed_count`, and `total_count`.
- `search_item_attribute_facets(p_taxonomy_id uuid, p_filters jsonb)` returns each occurring list value and its count. A count of 0 stays in the result.

Execute is revoked from `public`, `anon`, and `authenticated`, and granted to `service_role` only. The helpers `attribute_value_matches` and `item_attribute_match_ids` are not granted to `service_role`.

`p_filters` is `lists` (attribute id to values, OR), `ranges` (attribute id to min and max), `seed` (attribute id to the original value), and `exclude_id`.

On memory, the largest taxonomy, `capacity_gb = 64` and `family = DDR5` currently uses `item_attributes_value_trgm_idx` and took about 113 ms. The new btree index is the lookup that filter should use. Until the migration is applied, the route answers from the tables directly. After it is applied, the route calls the two functions.
