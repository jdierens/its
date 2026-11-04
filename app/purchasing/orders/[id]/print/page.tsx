import Link from "next/link";
import { PurchaseOrderDocument } from "@/components/PurchaseOrderDocument";
import { loadPurchaseOrderDocument } from "@/lib/purchaseOrderDocumentData";

export const dynamic = "force-dynamic";

export default async function PurchaseOrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadPurchaseOrderDocument(id);
  if ("error" in loaded) {
    return (
      <main className="page po-page">
        <p className="banner error" role="alert">
          {loaded.error}
        </p>
        <p className="muted">
          <Link href={`/purchasing/orders/${id}`}>Back to purchase order</Link>
        </p>
      </main>
    );
  }
  return <PurchaseOrderDocument document={loaded.document} orderId={loaded.orderId} />;
}
