import { Suspense } from "react";
import { IntegrationsPage } from "@/components/IntegrationsPage";

export default function AdminIntegrationsPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading integrations…</p>
        </main>
      }
    >
      <IntegrationsPage />
    </Suspense>
  );
}
