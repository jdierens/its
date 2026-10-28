import Link from "next/link";
import type { ShipQueueRow } from "@/lib/packSheet";

function packedDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export function ShipQueue({ rows }: { rows: ShipQueueRow[] }) {
  return (
    <main className="page pick-page">
      <p className="page-note">
        Packed orders wait here for shipping. Carrier labels and rate shopping are not built yet.
      </p>
      {rows.length === 0 ? (
        <p className="muted">No packed orders are waiting to ship.</p>
      ) : (
        <div className="card">
          <table className="pick-queue">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Customer PO</th>
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
                  <td className="pick-code">{packedDate(row.packedAt)}</td>
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
