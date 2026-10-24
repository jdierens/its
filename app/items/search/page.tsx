import { Suspense } from "react";
import { ItemAttributeSearch } from "@/components/ItemAttributeSearch";

export default function ItemSearchPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading search…</p>
        </main>
      }
    >
      <ItemAttributeSearch />
    </Suspense>
  );
}
