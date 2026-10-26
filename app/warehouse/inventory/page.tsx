import { Suspense } from "react";
import { InventorySearchPage } from "@/components/InventorySearchPage";

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading search…</p>
        </main>
      }
    >
      <InventorySearchPage />
    </Suspense>
  );
}
