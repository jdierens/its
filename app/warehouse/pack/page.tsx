import { PackQueue } from "@/components/PackQueue";
import { errorText } from "@/lib/errors";
import { loadPackQueue } from "@/lib/packActions";

export const dynamic = "force-dynamic";

export default async function PackQueuePage() {
  try {
    const rows = await loadPackQueue();
    return <PackQueue rows={rows} />;
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
