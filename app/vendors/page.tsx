import { Suspense } from "react";
import { ContactsTable } from "@/components/ContactsTable";

export default function VendorsPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading vendors…</p>
        </main>
      }
    >
      <ContactsTable kind="vendor" />
    </Suspense>
  );
}
