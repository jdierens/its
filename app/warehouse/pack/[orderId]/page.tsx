import Link from "next/link";
import { PackSheet } from "@/components/PackSheet";
import { errorText } from "@/lib/errors";
import { openPackSheet, readPackSheet } from "@/lib/packActions";
import { packPageAccess } from "@/lib/packAccessServer";

export const dynamic = "force-dynamic";

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PackSheetPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!ORDER_ID.test(orderId)) {
    return (
      <main className="page pick-page">
        <p>Sales order not found.</p>
        <p>
          <Link href="/warehouse/pack">Back to packing</Link>
        </p>
      </main>
    );
  }

  const access = await packPageAccess();
  try {
    const sheet = access.canPack ? await openPackSheet(orderId) : await readPackSheet(orderId);
    return <PackSheet initial={sheet} canPack={access.canPack} />;
  } catch (error) {
    return (
      <main className="page pick-page">
        <p className="banner error" role="alert">
          {errorText(error)}
        </p>
        <p>
          <Link href="/warehouse/pack">Back to packing</Link>
        </p>
      </main>
    );
  }
}
