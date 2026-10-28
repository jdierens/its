import { ShipQueue } from "@/components/ShipQueue";
import { errorText } from "@/lib/errors";
import { loadShipQueue } from "@/lib/packActions";

export const dynamic = "force-dynamic";

export default async function ShipQueuePage() {
  try {
    const rows = await loadShipQueue();
    return <ShipQueue rows={rows} />;
  } catch (error) {
    return (
      <main className="page pick-page">
        <p className="banner error" role="alert">
          {errorText(error)}
        </p>
      </main>
    );
  }
}
