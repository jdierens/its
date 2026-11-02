---
bump: minor
---
- A sales order that already shipped without a pack can be packed from its pack sheet. Finish stores packed_at and leaves the order shipped.
- Cancelled, invoiced, and closed orders stay closed. The ship date and shipment rows are left as they are.
