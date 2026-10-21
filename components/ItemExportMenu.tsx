"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { prefersFileShare } from "@/lib/export/download";

type Columns = "all" | "visible";
type FileFormat = "csv" | "xlsx";

const STORAGE_KEY = "its.itemExport";

type ExportPayload = {
  format: FileFormat | "sheet";
  columns: "all" | string[];
  tax: string;
  q: string;
  condition: string;
  manufacturerId: string;
  itemType: string;
  sort: string;
  dir: string;
  selectedIds: string[];
};

function sheetsMessage(flag: string): string {
  if (flag === "denied") return "Google did not grant access to create the spreadsheet.";
  if (flag === "unconfigured") return "Google Sheets is not configured.";
  if (flag === "state") return "The Google connection expired. Try again.";
  return "Google Sheets could not connect. Try again.";
}

function fileNameFrom(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] || fallback;
}

export function ItemExportMenu({
  tax,
  q,
  condition,
  manufacturerId,
  itemType,
  sort,
  dir,
  selectedIds,
  visibleColumns,
}: {
  tax: string;
  q: string;
  condition: string;
  manufacturerId: string;
  itemType: string;
  sort: string;
  dir: string;
  selectedIds: string[];
  visibleColumns: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [columns, setColumns] = useState<Columns>("all");
  const [google, setGoogle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const replayed = useRef(false);
  const postSheetRef = useRef<(body: ExportPayload) => Promise<void>>(async () => {});
  const latest = useRef({ tax, q, condition, manufacturerId, itemType, sort, dir, selectedIds, visibleColumns, columns });
  latest.current = { tax, q, condition, manufacturerId, itemType, sort, dir, selectedIds, visibleColumns, columns };

  function payload(format: ExportPayload["format"]): ExportPayload {
    const current = latest.current;
    return {
      format,
      columns: current.columns === "visible" ? current.visibleColumns : "all",
      tax: current.tax,
      q: current.q,
      condition: current.condition,
      manufacturerId: current.manufacturerId,
      itemType: current.itemType,
      sort: current.sort,
      dir: current.dir,
      selectedIds: current.selectedIds,
    };
  }

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

  async function postSheet(body: ExportPayload) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/items/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, format: "sheet" }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string; url?: string; consentUrl?: string } | null;
      if (!response.ok) {
        if (response.status === 409) setGoogle(false);
        throw new Error(result?.error || "Export failed.");
      }
      if (result?.consentUrl) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...body, format: "sheet" }));
        const start = new URL(result.consentUrl, window.location.origin);
        start.searchParams.set("next", `${window.location.pathname}${window.location.search}`);
        window.location.assign(start.toString());
        return;
      }
      if (!result?.url) throw new Error("Google did not return a spreadsheet link.");
      window.open(result.url, "_blank", "noopener,noreferrer");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }
  postSheetRef.current = postSheet;

  useEffect(() => {
    const flag = params.get("sheets");
    if (!flag || replayed.current) return;
    replayed.current = true;
    const next = new URLSearchParams(params.toString());
    next.delete("sheets");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    if (flag !== "connected") {
      setOpen(true);
      setError(sheetsMessage(flag));
      return;
    }
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as ExportPayload;
      setOpen(true);
      void postSheetRef.current(saved);
    } catch {
      setOpen(true);
      setError("The saved export could not be opened in Google Sheets. Try again.");
    }
  }, [params, pathname, router]);

  async function download(format: FileFormat) {
    const body = payload(format);
    const ios = prefersFileShare(navigator.userAgent, {
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform,
    });
    if (ios) {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/items/export";
      form.acceptCharset = "UTF-8";
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "payload";
      input.value = JSON.stringify(body);
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      form.remove();
      setOpen(false);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/items/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Export failed.");
      }
      const blob = await response.blob();
      const name = fileNameFrom(response.headers.get("content-disposition"), format === "xlsx" ? "ITS items export.xlsx" : "ITS items export.csv");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  const selected = selectedIds.length;
  const scopeNote =
    selected > 0
      ? `${selected} selected ${selected === 1 ? "item" : "items"}, in the current sort.`
      : "Every item matching the current filters and sort, not only this page.";

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
        <div className="export-menu" role="dialog" aria-label="Export items" aria-busy={busy}>
          <fieldset>
            <legend>Columns</legend>
            <label>
              <input
                type="radio"
                name="export-columns"
                checked={columns === "all"}
                onChange={() => setColumns("all")}
              />
              All fields
            </label>
            <label>
              <input
                type="radio"
                name="export-columns"
                checked={columns === "visible"}
                onChange={() => setColumns("visible")}
              />
              Visible columns
            </label>
          </fieldset>
          <p className="export-note">{scopeNote}</p>
          <button type="button" className="secondary" disabled={busy} onClick={() => download("csv")}>
            CSV
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => download("xlsx")}>
            Excel
          </button>
          {google ? (
            <button type="button" disabled={busy} onClick={() => postSheet(payload("sheet"))}>
              Open in Google Sheets
            </button>
          ) : null}
          {error ? <p className="export-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
