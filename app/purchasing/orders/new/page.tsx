import Link from "next/link";
import { PurchaseOrderForm } from "@/components/PurchaseOrderForm";
import { listPurchaseVendors, purchasePageAccess } from "@/lib/purchaseOrders";

export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage() {
  const access = await purchasePageAccess();
  if (!access.canEdit) {
    return (
      <main className="page">
        <p>You cannot create a purchase order.</p>
        <p className="muted">
          <Link href="/purchasing/orders">Back to purchase orders</Link>
        </p>
      </main>
    );
  }

  const vendors = await listPurchaseVendors();
  if (vendors.length === 0) {
    return (
      <main className="page">
        <p>Add a vendor before creating a purchase order.</p>
        <p className="muted">
          <Link href="/vendors/new">New vendor</Link>
        </p>
      </main>
    );
  }

  return <PurchaseOrderForm order={null} vendors={vendors} canEdit={access.canEdit} showMoney={access.canViewMoney} />;
}
