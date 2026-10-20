import { Suspense } from "react";
import { IntegrationsPage } from "@/components/IntegrationsPage";

export default function EbayIntegrationPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading eBay…</p>
        </main>
      }
    >
      <IntegrationsPage focus="ebay" />
    </Suspense>
  );
}
