import { Suspense } from "react";
import { IntegrationsPage } from "@/components/IntegrationsPage";

export default function QuickBooksIntegrationPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading QuickBooks…</p>
        </main>
      }
    >
      <IntegrationsPage focus="quickbooks" />
    </Suspense>
  );
}
