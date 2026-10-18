# ITS

Inventory app for the ITS Supabase project. The item list is the original sku, name, and quantity fields. Create and edit also use taxonomies and their attributes.

## Try it

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project's publishable or anon key. Do not commit that file.
3. Run `npm install`, then `npm run dev`.
4. Open http://localhost:3000.

Create an item from **New item**. Pick a taxonomy and the form lists that taxonomy's attributes. Saving calls `create_item`. Open an item to edit it. Items with no taxonomy still load, and saving them updates sku, name, description, and quantity only.

Editing calls `public.update_item`. The function is in `supabase/migrations/20261018034917_update_item.sql`. Deploying this repo does not apply that file. It is already applied on project `fxsbpreasbdalwthyzvk`. On a new database, run the file in the SQL editor before using edit.

`npm run typecheck` and `npm run build` both need to pass.

Row Level Security is disabled on `items`, `taxonomies`, `attributes`, and `item_attributes`. The anon key can read and write every row. This app does not change that. Enabling RLS without policies would block the client.
