"use client";

import { Printer } from "lucide-react";

export function PrintDocumentButton() {
  return (
    <button
      type="button"
      className="button cust-doc-print"
      aria-label="Print"
      title="Print"
      onClick={() => window.print()}
    >
      <Printer size={18} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
