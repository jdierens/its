import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { errorText } from "@/lib/errors";
import { formatSalesMoney, salesOrderStatusLabel } from "@/lib/salesOrderDraft";
import { listSalesOrders } from "@/lib/salesOrders";
import { salesPageAccess } from "@/lib/salesSession";

export const dynamic = "force-dynamic";

export default async function SalesOrdersPage() {
  const access = await salesPageAccess();
  let orders: Awaited<ReturnType<typeof listSalesOrders>> = [];
  let problem: string | null = null;
  try {
    orders = await listSalesOrders();
  } catch (error) {
    problem = errorText(error);
  }

  return (
    <main className="page so-page">
      <p className="page-note">Create a sales order for a customer. A number is assigned when the order is approved.</p>
      {access.canEdit ? (
        <p>
          <Link className="button" href="/sales/orders/new">
            New sales order
          </Link>
        </p>
      ) : (
        <p className="muted">You can view sales orders. Creating and approving is limited to admin and staff.</p>
      )}
      {problem ? (
        <p className="banner error" role="alert">
          {problem}
        </p>
      ) : null}
      {!problem && orders.length === 0 ? <p className="muted">No sales orders yet.</p> : null}
      {orders.length > 0 ? (
        <>
          <div className="card so-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>eBay order</th>
                  <th>Sales record</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Order date</th>
                  <th>Ship date</th>
                  {access.canViewMoney ? <th className="num">Total</th> : null}
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="sku">
                      <Link href={`/sales/orders/${order.id}`}>{order.number}</Link>
                    </td>
                    <td>{order.ebayOrderId}</td>
                    <td>{order.ebaySalesRecordRef}</td>
                    <td>{order.customerName}</td>
                    <td>
                      <Badge tone={order.status}>{salesOrderStatusLabel(order.status)}</Badge>
                    </td>
                    <td>{order.orderDate ?? ""}</td>
                    <td>{order.shipDate ?? ""}</td>
                    {access.canViewMoney ? <td className="num">{formatSalesMoney(order.total, order.currency)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="so-cards">
            {orders.map((order) => (
              <li className="so-card" key={order.id}>
                <Link href={`/sales/orders/${order.id}`}>{order.number}</Link>
                <dl>
                  {order.ebayOrderId ? (
                    <>
                      <dt>eBay order</dt>
                      <dd>{order.ebayOrderId}</dd>
                    </>
                  ) : null}
                  {order.ebaySalesRecordRef ? (
                    <>
                      <dt>Sales record</dt>
                      <dd>{order.ebaySalesRecordRef}</dd>
                    </>
                  ) : null}
                  <dt>Customer</dt>
                  <dd>{order.customerName}</dd>
                  <dt>Status</dt>
                  <dd>{salesOrderStatusLabel(order.status)}</dd>
                  <dt>Order date</dt>
                  <dd>{order.orderDate ?? ""}</dd>
                  <dt>Ship date</dt>
                  <dd>{order.shipDate ?? ""}</dd>
                  {access.canViewMoney ? (
                    <>
                      <dt>Total</dt>
                      <dd className="num">{formatSalesMoney(order.total, order.currency)}</dd>
                    </>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
