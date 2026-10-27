import Link from "next/link";
import { formatPickQty, pickQueueLabel, type PickQueueRow } from "@/lib/pickSheet";

export function PickQueue({ rows }: { rows: PickQueueRow[] }) {
  return (
    <main className="page pick-page">
      <p className="page-note">
        Approved orders with a product or a kit. Freight and service lines stay off this list. Packing is not on this screen yet.
      </p>
      {rows.length === 0 ? (
        <p className="muted">No approved orders are waiting to pick.</p>
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
                <th>Picked</th>
                <th>Staging</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.orderId}>
                  <td>
                    <Link href={`/warehouse/pick/${row.orderId}`}>SO{row.soNumber}</Link>
                  </td>
                  <td>{row.customer || "—"}</td>
                  <td>{row.customerPo || "—"}</td>
                  <td>{row.orderDate || "—"}</td>
                  <td>{pickQueueLabel(row.status, row.pickStatus)}</td>
                  <td>
                    {formatPickQty(row.picked)} of {formatPickQty(row.ordered)}
                  </td>
                  <td>{row.stagingBin || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
