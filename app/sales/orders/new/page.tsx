import Link from "next/link";
import { SalesOrderForm } from "@/components/SalesOrderForm";
import { errorText } from "@/lib/errors";
import { pacificToday } from "@/lib/salesOrderDraft";
import { listSalesLookups, suggestSalesOrderNumber } from "@/lib/salesOrders";
import { salesPageAccess } from "@/lib/salesSession";

export const dynamic = "force-dynamic";

export default async function NewSalesOrderPage() {
  const access = await salesPageAccess();
  if (!access.canEdit) {
    return (
      <main className="page so-page">
        <p>You cannot create a sales order.</p>
        <p className="muted">
          <Link href="/sales/orders">Back to sales orders</Link>
        </p>
      </main>
    );
  }

  try {
    const [lookups, suggestedNumber] = await Promise.all([listSalesLookups(), suggestSalesOrderNumber()]);
    return (
      <SalesOrderForm
        order={null}
        lookups={lookups}
        canEdit={access.canEdit}
        showMoney={access.canViewMoney}
        today={pacificToday()}
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
