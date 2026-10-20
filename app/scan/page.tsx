import { Suspense } from "react";
import { ScanPage } from "@/components/ScanPage";

export default function ScanRoute() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Opening the scanner…</p>
        </main>
      }
    >
      <ScanPage />
    </Suspense>
  );
}
