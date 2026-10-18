import { Suspense } from "react";
import { ContactsTable } from "@/components/ContactsTable";

export default function CustomersPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading customers…</p>
        </main>
      }
    >
      <ContactsTable kind="customer" />
    </Suspense>
  );
}
