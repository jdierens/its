import { Suspense } from "react";
import { SalesOrderList } from "@/components/SalesOrderList";
import { SalesOrderListActions } from "@/components/SalesOrderListActions";
import { SalesOrderListMemory } from "@/components/SalesOrderListSwitch";
import { errorText } from "@/lib/errors";
import { salesOrderListScope } from "@/lib/salesOrderDraft";
import { listSalesOrders } from "@/lib/salesOrders";
import { salesPageAccess } from "@/lib/salesSession";
import { stockSettingsWritable } from "@/lib/stockAccess";

export const dynamic = "force-dynamic";

export default async function SalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const access = await salesPageAccess();
  const canPullEbay = await stockSettingsWritable();
  const scope = salesOrderListScope((await searchParams).view);
  let orders: Awaited<ReturnType<typeof listSalesOrders>> = [];
  let problem: string | null = null;
  try {
    orders = await listSalesOrders(scope);
  } catch (error) {
    problem = errorText(error);
  }

  return (
    <main className="page so-page ds">
      <p className="page-note">Create a sales order for a customer. A number is assigned when the order is approved.</p>
      {access.canEdit || canPullEbay ? <SalesOrderListActions canEdit={access.canEdit} canPullEbay={canPullEbay} /> : null}
      {access.canEdit ? null : (
        <p className="muted">You can view sales orders. Creating and approving is limited to admin and staff.</p>
      )}
      <Suspense fallback={<p className="muted">Loading sales orders…</p>}>
        <SalesOrderListMemory view={scope}>
          <SalesOrderList orders={orders} view={scope} canViewMoney={access.canViewMoney} problem={problem} />
        </SalesOrderListMemory>
      </Suspense>
    </main>
  );
}
