import { PickQueue } from "@/components/PickQueue";
import { errorText } from "@/lib/errors";
import { loadPickQueue } from "@/lib/pickActions";

export const dynamic = "force-dynamic";

export default async function PickQueuePage() {
  try {
    const rows = await loadPickQueue();
    return <PickQueue rows={rows} />;
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
