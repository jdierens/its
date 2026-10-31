import Link from "next/link";
import { formatDataDate } from "@/lib/formatDate";
import { formatPackQty, packQueueLabel, type PackQueueRow } from "@/lib/packSheet";

export function PackQueue({ rows }: { rows: PackQueueRow[] }) {
  return (
    <main className="page pick-page">
      <p className="page-note">
        Picked orders. Put each picked quantity into a box or a pallet. Freight and service lines stay off this list.
        Shipping labels are not on this screen.
      </p>
      {rows.length === 0 ? (
        <p className="muted">No picked orders are waiting to pack.</p>
      ) : (
        <div className="card">
          <table className="pick-queue">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Customer PO</th>
                <th>Order date</th>
                <th>Status</th>
                <th>Packed</th>
                <th>Bins</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.orderId}>
                  <td className="pick-code">
                    <Link href={`/warehouse/pack/${row.orderId}`}>SO{row.soNumber}</Link>
                  </td>
                  <td>{row.customer || "—"}</td>
                  <td className="pick-code">{row.customerPo || "—"}</td>
                  <td className="pick-code">{row.orderDate ? formatDataDate(row.orderDate) : "—"}</td>
                  <td className="pick-code">{packQueueLabel(row.status)}</td>
                  <td className="pick-code">
                    {formatPackQty(row.packed)} of {formatPackQty(row.picked)}
                  </td>
                  <td className="pick-code">{row.bins}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
