import Link from "next/link";
import { PackSheet } from "@/components/PackSheet";
import { errorText } from "@/lib/errors";
import { openPackSheet, readPackSheet } from "@/lib/packActions";
import { packPageAccess } from "@/lib/packAccessServer";
import { salesOrderPackOpenRefused, salesOrderStageActive } from "@/lib/salesOrderStages";

export const dynamic = "force-dynamic";

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opens packing when the pick is finished. A cancelled order that already packed is shown without reopening it. */
async function packSheetForPage(orderId: string, canPack: boolean) {
  if (!canPack) return readPackSheet(orderId);
  try {
    return await openPackSheet(orderId);
  } catch (error) {
    if (!salesOrderPackOpenRefused(errorText(error))) throw error;
    const preview = await readPackSheet(orderId);
    const reached = salesOrderStageActive(
      {
        orderId,
        status: preview.status,
        pickStatus: preview.pickStatus,
        numbered: preview.soNumber != null,
      },
      "pack",
    );
    if (!reached) throw error;
    return preview;
  }
}

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
    const sheet = await packSheetForPage(orderId, access.canPack);
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
