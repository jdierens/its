"use client";

export function PrintDocumentButton() {
  return (
    <button type="button" className="button" onClick={() => window.print()}>
      Print
    </button>
  );
}
