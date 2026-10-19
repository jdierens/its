"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Scope = "view" | "all";

export function ItemExportMenu({
  tax,
  q,
  condition,
  manufacturerId,
}: {
  tax: string;
  q: string;
  condition: string;
  manufacturerId: string;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("view");
  const [google, setGoogle] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/items/export")
      .then(async (response) => {
        const body = (await response.json()) as { google?: boolean };
        if (!cancelled) setGoogle(Boolean(body.google));
      })
      .catch(() => {
        if (!cancelled) setGoogle(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(format: "csv" | "sheet") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/items/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format,
          scope,
          tax: scope === "view" ? tax : "",
          q: scope === "view" ? q : "",
          condition: scope === "view" ? condition : "",
          manufacturerId: scope === "view" ? manufacturerId : "",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (response.status === 409) setGoogle(false);
        throw new Error(body?.error || "Export failed.");
      }
      if (format === "sheet") {
        const body = (await response.json()) as { url?: string };
        if (!body.url) throw new Error("Google did not return a spreadsheet link.");
        window.open(body.url, "_blank", "noopener,noreferrer");
        setOpen(false);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const match = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/);
      link.href = url;
      link.download = match?.[1] || "ITS items export.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="export-wrap" ref={wrapRef}>
      <button
        type="button"
        className="button secondary"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        Export
      </button>
      {open ? (
        <div className="export-menu" role="dialog" aria-label="Export items">
          <fieldset>
            <legend className="sr-only">What to export</legend>
            <label>
              <input
                type="radio"
                name="export-scope"
                checked={scope === "view"}
                onChange={() => setScope("view")}
              />
              Current view
            </label>
            <label>
              <input
                type="radio"
                name="export-scope"
                checked={scope === "all"}
                onChange={() => setScope("all")}
              />
              All items
            </label>
          </fieldset>
          <p className="export-note">
            Current view uses the taxonomy filter and search, plus condition and manufacturer.
            Both choices include every matching item.
          </p>
          {google === null ? (
            <p className="export-note">Checking Google Sheet…</p>
          ) : google ? (
            <button type="button" disabled={busy} onClick={() => run("sheet")}>
              Google Sheet
            </button>
          ) : (
            <p className="export-option">
              <span>Google Sheet</span>
              <span className="muted">Not configured</span>
              <Link href="/export-setup">Setup notes</Link>
            </p>
          )}
          <button type="button" className="secondary" disabled={busy} onClick={() => run("csv")}>
            CSV download
          </button>
          {error ? <p className="export-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
