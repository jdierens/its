import Link from "next/link";
import { formatDataDate } from "@/lib/formatDate";
import { SALES_ORDER_REFERENCE_LABEL } from "@/lib/salesOrderDraft";
import { formatPickQty, pickQueueLabel, stagingDisplay, type PickQueueRow } from "@/lib/pickSheet";

export function PickQueue({ rows }: { rows: PickQueueRow[] }) {
  return (
    <main className="page pick-page">
      <p className="page-note">
        Approved orders with a product or a kit. Freight and service lines stay off this list. Finish a pick, then open packing.
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
                <th>{SALES_ORDER_REFERENCE_LABEL}</th>
                <th>Order date</th>
                <th>Status</th>
                <th>Picked</th>
                <th>Staging</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.orderId}>
                  <td className="pick-code">
                    <Link href={`/warehouse/pick/${row.orderId}`}>SO{row.soNumber}</Link>
                  </td>
                  <td>{row.customer || "—"}</td>
                  <td className="pick-code">{row.orderReference || "—"}</td>
                  <td className="pick-code">{row.orderDate ? formatDataDate(row.orderDate) : "—"}</td>
                  <td className="pick-code">{pickQueueLabel(row.status, row.pickStatus)}</td>
                  <td className="pick-code">
                    {formatPickQty(row.picked)} of {formatPickQty(row.ordered)}
                  </td>
                  <td className="pick-code">
                    {stagingDisplay({
                      soNumber: row.soNumber,
                      stagingBin: row.stagingBin,
                      picking: row.pickStatus != null || row.status === "picking",
                    }) || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
