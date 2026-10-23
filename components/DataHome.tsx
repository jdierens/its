"use client";

import Link from "next/link";
import { useState } from "react";
import { exportDataTable } from "@/lib/dataActions";
import { DATA_TABLES } from "@/lib/data/registry";
import { errorText } from "@/lib/errors";

function saveText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function DataHome() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function downloadLocations() {
    setBusy(true);
    setMessage(null);
    try {
      const file = await exportDataTable("locations");
      saveText(file.filename, file.csv);
      setMessage(file.truncated ? "Downloaded the first 5000 locations." : "Downloaded locations.csv.");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page data-page">
      <p className="hint">
        Import and export tables. A spreadsheet stays on this device. Only the mapped rows are sent when you import.
      </p>
      {message ? <p className="banner">{message}</p> : null}
      <div className="data-cards">
        {DATA_TABLES.map((table) => (
          <section className="card data-card" key={table.id}>
            <h2>{table.label}</h2>
            <p>{table.description}</p>
            <div className="actions">
              {table.id === "bins" ? (
                <Link className="button" href="/admin/data/bins">
                  Open bins
                </Link>
              ) : null}
              {table.exportable && table.id === "locations" ? (
                <button type="button" className="secondary" disabled={busy} onClick={() => void downloadLocations()}>
                  Download CSV
                </button>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
