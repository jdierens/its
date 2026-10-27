import Link from "next/link";
import { CustomerOrderDocument } from "@/components/CustomerOrderDocument";
import { loadCustomerDocument } from "@/lib/customerDocumentData";

export const dynamic = "force-dynamic";

export default async function SalesOrderInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadCustomerDocument(id, "invoice");
  if ("error" in loaded) {
    return (
      <main className="page so-page ds">
        <p className="banner error" role="alert">
          {loaded.error}
        </p>
        <p className="muted">
          <Link href={`/sales/orders/${id}`}>Back to sales order</Link>
        </p>
      </main>
    );
  }
  return <CustomerOrderDocument document={loaded.document} orderId={loaded.orderId} />;
}
