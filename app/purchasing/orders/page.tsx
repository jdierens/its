import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { listPurchaseOrders } from "@/lib/purchaseOrders";
import { purchasePageAccess } from "@/lib/purchaseSession";
import { purchaseOrderStatusLabel } from "@/lib/purchaseOrderDraft";
import { formatMoney } from "@/lib/pricing/quotes";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage() {
  const [access, orders] = await Promise.all([purchasePageAccess(), listPurchaseOrders()]);

  return (
    <main className="page">
      <p className="page-note">Create a purchase order and send it to a vendor. Receiving into inventory comes later.</p>
      {access.canEdit ? (
        <p>
          <Link className="button" href="/purchasing/orders/new">
            New purchase order
          </Link>
        </p>
      ) : (
        <p className="muted">You can view purchase orders. Creating and sending is limited to admin and staff.</p>
      )}
      {orders.length === 0 ? (
        <p className="muted">No purchase orders yet.</p>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Vendor</th>
                <th>Status</th>
                <th>Ordered</th>
                <th>Expected</th>
                {access.canViewMoney ? <th className="money">Total</th> : null}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="sku">
                    <Link href={`/purchasing/orders/${order.id}`}>{order.number}</Link>
                  </td>
                  <td>{order.vendorName}</td>
                  <td>
                    <Badge tone={order.status}>{purchaseOrderStatusLabel(order.status)}</Badge>
                  </td>
                  <td>{order.orderedOn ?? ""}</td>
                  <td>{order.expectedOn ?? ""}</td>
                  {access.canViewMoney ? <td className="money">{formatMoney(order.total, "USD")}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
