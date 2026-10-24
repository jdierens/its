import Link from "next/link";
import { SalesOrderForm } from "@/components/SalesOrderForm";
import { errorText } from "@/lib/errors";
import { pacificToday } from "@/lib/salesOrderDraft";
import { listSalesLookups, loadSalesOrder, suggestSalesOrderNumber } from "@/lib/salesOrders";
import { salesPageAccess } from "@/lib/salesSession";

export const dynamic = "force-dynamic";

export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await salesPageAccess();

  try {
    const [order, lookups] = await Promise.all([loadSalesOrder(id), listSalesLookups()]);
    const suggestedNumber = order?.status === "draft" ? await suggestSalesOrderNumber() : null;
    if (!order) {
      return (
        <main className="page so-page">
          <p>Sales order not found.</p>
          <p className="muted">
            <Link href="/sales/orders">Back to sales orders</Link>
          </p>
        </main>
      );
    }
    return (
      <SalesOrderForm
        order={order}
        lookups={lookups}
        canEdit={access.canEdit}
        showMoney={access.canViewMoney}
        today={order.orderDate || pacificToday()}
        suggestedNumber={suggestedNumber}
      />
    );
  } catch (error) {
    return (
      <main className="page so-page">
        <p className="banner error" role="alert">
          {errorText(error)}
        </p>
        <p className="muted">
          <Link href="/sales/orders">Back to sales orders</Link>
        </p>
      </main>
    );
  }
}
