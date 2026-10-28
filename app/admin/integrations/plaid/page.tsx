import { Suspense } from "react";
import { BankFeedsPage } from "@/components/BankFeedsPage";

export default function PlaidIntegrationPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading bank feeds…</p>
        </main>
      }
    >
      <BankFeedsPage />
    </Suspense>
  );
}
