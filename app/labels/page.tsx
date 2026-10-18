import { Suspense } from "react";
import { LabelsPage } from "@/components/LabelsPage";

export default function PrintLabelsPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading…</p>
        </main>
      }
    >
      <LabelsPage />
    </Suspense>
  );
}
