import { Suspense } from "react";
import { ItemsTable } from "@/components/ItemsTable";

export default function ItemsPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading items…</p>
        </main>
      }
    >
      <ItemsTable />
    </Suspense>
  );
}
