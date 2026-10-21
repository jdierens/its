# Roles and capabilities

Design only. The app still has `admin`, `staff`, and `read_only`, and `read_only` can still write. This note is the plan for two warehouse roles that cannot see money, and for making `read_only` view-only. Jan has asked for `warehouse_manager` and a lower `warehouse_clerk`. The clerk's exact capabilities are proposals.

## Model

Store a role name on `app_users.role`. Derive capabilities from that role in one server map. Call sites ask for a capability (`can_view_financials`, `can_edit_items`). They do not compare `role === "staff"`.

A capability map is the right first step. The role list is still small and Jan has not confirmed it. One function is easy to review and does not need a new table. Scattering `role === "admin"` checks is how the users page got a route gate while `fetchAppUsers` did not. A permission table, with rows per person, can wait until a person needs a one-off exception. Until then the role is the only grant.

Suggested capabilities:

| Capability | Means |
|---|---|
| `can_view_financials` | See prices, quotes, transactions, pricing pages, and financial fields. |
| `can_edit_financials` | Change those amounts and add quotes or transactions. |
| `can_edit_items` | Create, edit, or delete an item's physical record and non-financial attributes. |
| `can_add_photos` | Add a photo to an item. Removing a photo stays with `can_edit_items`. |
| `can_log_picks` | Log picks and packs. |
| `can_move_bins` | Putaway and bin moves. |
| `can_receive` | Receive quantities against a purchase order. The order's prices stay behind `can_view_financials`. |
| `can_adjust_counts` | Approve a cycle count and post the quantity adjustment. |
| `can_manage_warehouse` | Shorthand for the four floor capabilities plus `can_adjust_counts`. Prefer the specific capability at the call site. |
| `can_manage_catalog` | Taxonomies, attribute definitions, and the manufacturer list. |
| `can_manage_users` | Approve people and change roles. |
| `can_manage_integrations` | Connect or disconnect QuickBooks and eBay, and run a sync. |
| `can_edit_settings` | Change app settings. The pricing window is also `can_edit_financials`. |

`can_edit_financials` implies `can_view_financials`. A view-only role has the view capability and not the edit one. Both warehouse roles have neither. `can_edit_items` includes delete. The clerk does not get it.

## Role matrix

Yes means the role has the capability. **Guess** means Jan should confirm it. **Proposal** is the suggested clerk split. Jan asked for the clerk role; he has not confirmed these cells yet.

| Capability | admin | staff | warehouse_manager | warehouse_clerk | read_only |
|---|---|---|---|---|---|
| `can_view_financials` | yes | yes | no | no | yes |
| `can_edit_financials` | yes | yes | no | no | no |
| `can_edit_items` | yes | yes | yes | proposal: no | no |
| `can_add_photos` | yes | yes | yes | proposal: yes, add only | no |
| `can_log_picks` | yes | yes | yes | proposal: yes | no |
| `can_move_bins` | yes | yes | yes | proposal: yes | no |
| `can_receive` | yes | yes | yes | proposal: yes, quantities only | no |
| `can_adjust_counts` | yes | yes | yes | proposal: no | no |
| `can_manage_catalog` | yes | yes | guess: no, but can pick an existing manufacturer | no | no |
| `can_manage_users` | yes | no | no | no | no |
| `can_manage_integrations` | yes | guess: no | no | no | no |
| `can_edit_settings` | yes | guess: pricing window and labels, not integrations | guess: bin counter only | proposal: no | no |

`warehouse_clerk` is the floor role under `warehouse_manager`. Neither role sees money. The clerk proposals are: log picks and packs, add photos, put stock away and move bins, and receive quantities against a purchase order. The clerk does not approve a cycle count, post a quantity adjustment, create, edit, or delete an item, or open settings. Photo delete stays with `can_edit_items`, so the proposal is add-only for the clerk.

`warehouse_manager` keeps item edits, cycle-count adjustments, and the floor work. The name `warehouse_manager` is still to confirm. Staff keeps financial access, matching "everything except admin," with integrations called out as the guess above.

`read_only` can see money and cannot change it. That is different from the warehouse roles, which cannot see money at all.

## Enforcement

Every data call uses the service role, which bypasses row level security. Hiding a column in the browser is not enough. The server action, route handler, or RPC result must omit the field, and a write must reject the call.

Read path: load the session, map the role to capabilities, and drop financial columns and rows before the value is returned. Write path: the same check, then the existing service-role write. `getSupabase()` today only checks that the account is approved, so a `read_only` account can still save. Mutating actions need an edit capability. Pending and disabled accounts stay on the waiting page and do not get these capabilities.

Do not re-grant `authenticated` on `app_users` or on the money tables. The service role remains the only database grant.

## Where money is today

These are the surfaces a warehouse role must not receive, and that `read_only` may receive but must not change.

Item columns, all USD: `items.ecommerce_price`, `ecommerce_price_updated_at`, `market_price`, `market_price_updated_at`, `msrp`, `msrp_updated_at`, `pricing_checked_at`.

`price_quotes`: price, currency, quantity, source, seller, url, notes, raw payload, outlier flag.

`item_transactions`: buy or sell, quantity, `unit_price`, generated `total`, customer, vendor, reference, source (`manual`, `qbo`, `ebay`).

`app_settings` pricing/sales window (days). Last sold, last bought, quantity sold, revenue, average sell, quantity bought, and spend are computed from transactions inside that window.

Contacts: `customers.tax_id` (QuickBooks resale number) and `vendors.tax_id` (tax identifier). There is no balance, credit, or price column on those tables. Addresses and names are not amounts. Whether a warehouse role may see a vendor name and shipping address for receiving is a guess; tax ids stay financial.

Live `attributes` rows are physical (socket, capacity, speed, TDP, and similar). None are cost or price. A future cost attribute needs an explicit financial flag. Matching on the name is not enough, and the flag has to be stripped with the other financial fields.

Pages and client calls:

- Items list columns and inline edit: ecommerce price, market price, MSRP (`components/ItemsTable.tsx`, `lib/inlineEdit.ts`, `lib/itemSort.ts`).
- Item page pricing panel: the three prices, price references, transactions, and **Update pricing** (`components/ItemPricingPanel.tsx`, `lib/itemPricing.ts`).
- `/pricing` is a placeholder page. The nav item is still there.
- `/sales/orders`, `/purchasing/orders`, `/warehouse/pick`, and `/warehouse/receiving` are placeholders with no money yet. Purchase orders and sales orders will be money when they exist.
- Admin settings: the pricing window.
- Item export CSV: `ecommerce_price`, `market_price`, `msrp`, `pricing_checked_at` (`lib/export/table.ts`, `lib/export/load.ts`, `app/api/items/export/route.ts`).
- Customer and vendor forms: `tax_id`.

Server paths that return or write money:

- `lib/items.ts` list and item fetch select the three prices. `item_list_page` sorts and returns them. `saveItemCell` calls `update_item_cell`, which accepts `ecommerce_price`, `market_price`, and `msrp`.
- `lib/itemPricing.ts` reads and writes the three prices, `price_quotes`, and `item_transactions`.
- `POST /api/items/[id]/pricing` looks up eBay and BrokerBin and inserts `price_quotes`, then sets `pricing_checked_at`.
- Settings read and write the pricing window in `app_settings`.
- QuickBooks sync copies customers and vendors, including tax ids. Transaction import is described as a later insert into `item_transactions` and does not run yet.
- The eBay seller connection does not store listing prices. The price lookup uses app credentials on the pricing route above.

Not money: quantity, condition, photos, bins, labels, scan, Lens candidates (sku, name, part, model, quantity), and the physical attributes listed above. Item labels do not print a price. A manager with `can_edit_items` can change the physical fields. A clerk, under the proposal, can look them up and add a photo, and cannot edit or delete the item. ECCN, US HTS, and CCATS are trade fields, not amounts. Whether a manager may edit them is a guess. The clerk proposal leaves them unchanged.

## Settings, manufacturers, and integrations

Today any approved user can open Settings, Manufacturers, and Integrations. Only `/admin/users` checks for admin.

Recommended gates:

- Users: `can_manage_users` (admin).
- Integrations, including QuickBooks and eBay connect, disconnect, and sync: `can_manage_integrations`. Recommend admin only. The pages hold tokens and a financial sync. Staff do not need them for pricing lookups. The lookup route is separate and uses `can_view_financials` / `can_edit_financials`.
- Manufacturers admin (create, rename, merge): `can_manage_catalog`. Recommend admin and staff. A warehouse manager can still set a manufacturer that already exists on an item. A clerk cannot edit the item, so the clerk does not change the manufacturer.
- Settings: split by key. The pricing window is `can_edit_financials`. Label templates can stay with anyone who prints labels. The bin counter is the guess for warehouse managers. The clerk proposal is no settings access, including the bin counter. Until the page is split, hide the whole settings page from both warehouse roles so the window does not leak.

## Migration and phases

`app_users.role` is a check constraint: `admin`, `staff`, `read_only`. Row level security is already on with no anon or authenticated policy. `authenticated` cannot select the table. Keep it that way. A new role is an `alter` of that check, granted to `service_role` only, in the same migration. No new table is required for phase 1. The Oct 30 rule still applies if a later change adds a table: grant `service_role` only, enable row level security, and add no anon or authenticated policy.

The SQL functions `ensure_app_user` and `set_app_user` are not on the sign-in path. Sign-in links the Google uid with the service role. `set_app_user` still lists the old role names and uses `auth.uid()`, so it fails for the service role. The users screen must keep using the server action, and that action's allowed-role list has to match the constraint when the new role is added.

Phases:

1. Capability map and `read_only` writes rejected. Strip financial columns for any future role without `can_view_financials`, even before that role exists, so the list, item fetch, cell save, pricing actions, pricing route, and CSV share one filter. Admin and staff behavior stays. This phase touches every mutating server action and the read paths in the inventory above. It is mechanical and wide, and it does not add a role.
2. After Jan confirms the matrix, including the clerk proposals, one migration adds `warehouse_manager` and `warehouse_clerk` to the check constraint. Update the users screen and the capability map. Do not seed an account in the migration.
3. Warehouse features that are still placeholders call the specific capability when they are built: picks and packs use `can_log_picks`, putaway and bin moves use `can_move_bins`, receiving uses `can_receive` and omits purchase-order prices, and cycle-count approval uses `can_adjust_counts`. Sales orders and purchase orders are money and call `can_view_financials`.
4. If a cost is stored as an attribute, add a financial flag on `attributes` and strip those values with the other financial fields.

## Open questions

- Confirm the role name `warehouse_manager`. `warehouse_clerk` is the name Jan used.
- Confirm the clerk proposals: log picks and packs, add photos, putaway and bin moves, and receive quantities against a purchase order.
- Confirm the clerk does not approve cycle counts, post quantity adjustments, create, edit, or delete items, delete photos, or open settings.
- May staff open Integrations, or is that admin only?
- May a warehouse manager see vendor and customer names and shipping addresses, with tax id removed?
- May a warehouse manager edit ECCN, US HTS, and CCATS?
- Should `read_only` see prices? This plan says yes, without edit.
- Bin-counter access for the warehouse manager, separate from the pricing window.
