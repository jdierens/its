---
bump: minor
---
- A sales order can store a customer shipping label PDF as attachment kind `shipping_label`, chosen next to Customer PO and the other file types. Apply `supabase/migrations/20261028222000_so_shipping_label.sql` by hand after merge. Deploying does not run it.
