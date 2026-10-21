import Link from "next/link";
import { PurchaseOrderForm } from "@/components/PurchaseOrderForm";
import { listPurchaseVendors, loadPurchaseOrder } from "@/lib/purchaseOrders";
import { purchasePageAccess } from "@/lib/purchaseSession";

export const dynamic = "force-dynamic";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [access, order, vendors] = await Promise.all([
    purchasePageAccess(),
    loadPurchaseOrder(id),
    listPurchaseVendors(),
  ]);

  if (!order) {
    return (
      <main className="page">
        <p>Purchase order not found.</p>
        <p className="muted">
          <Link href="/purchasing/orders">Back to purchase orders</Link>
        </p>
      </main>
    );
  }

  const vendorChoices = vendors.some((vendor) => vendor.id === order.vendorId)
    ? vendors
    : [{ id: order.vendorId, name: order.vendorName }, ...vendors];

  return <PurchaseOrderForm order={order} vendors={vendorChoices} canEdit={access.canEdit} showMoney={access.canViewMoney} />;
}
