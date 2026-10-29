import Link from "next/link";
import { PickSheet } from "@/components/PickSheet";
import { errorText } from "@/lib/errors";
import { openPickSheet, readPickSheet } from "@/lib/pickActions";
import { pickPageAccess } from "@/lib/pickAccessServer";
import { salesOrderPickOpenRefused, salesOrderStageActive } from "@/lib/salesOrderStages";

export const dynamic = "force-dynamic";

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opens a pick that can still start. A later order is shown as it was picked, without starting again. */
async function pickSheetForPage(orderId: string, canPick: boolean) {
  if (!canPick) return readPickSheet(orderId);
  try {
    return await openPickSheet(orderId);
  } catch (error) {
    if (!salesOrderPickOpenRefused(errorText(error))) throw error;
    const preview = await readPickSheet(orderId);
    const reached = salesOrderStageActive(
      {
        orderId,
        status: preview.status,
        pickStatus: preview.pickStatus,
        numbered: preview.soNumber != null,
      },
      "pick",
    );
    if (!reached) throw error;
    return preview;
  }
}

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
    const sheet = await pickSheetForPage(orderId, access.canPick);
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
