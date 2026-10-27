import Link from "next/link";
import { PickSheet } from "@/components/PickSheet";
import { errorText } from "@/lib/errors";
import { openPickSheet, readPickSheet } from "@/lib/pickActions";
import { pickPageAccess } from "@/lib/pickAccessServer";

export const dynamic = "force-dynamic";

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PickSheetPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!ORDER_ID.test(orderId)) {
    return (
      <main className="page pick-page">
        <p>Sales order not found.</p>
        <p>
          <Link href="/warehouse/pick">Back to picking</Link>
        </p>
      </main>
    );
  }

  const access = await pickPageAccess();
  try {
    const sheet = access.canPick ? await openPickSheet(orderId) : await readPickSheet(orderId);
    return <PickSheet initial={sheet} canPick={access.canPick} />;
  } catch (error) {
    return (
      <main className="page pick-page">
        <p className="banner error" role="alert">
          {errorText(error)}
        </p>
        <p>
          <Link href="/warehouse/pick">Back to picking</Link>
        </p>
      </main>
    );
  }
}
