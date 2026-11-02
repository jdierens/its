"use client";

import { useEffect, useMemo, useState } from "react";
import { prefersFileShare } from "@/lib/export/download";
import { errorText } from "@/lib/errors";
import { receiptExportRequest } from "@/lib/receiptExport";
import { projectReceiptSummary } from "@/lib/receivingActions";
import {
  RECEIPT_SUMMARY_DEFAULT_SORT,
  sortReceiptSummary,
  summaryItemLabel,
  toggleReceiptSummarySort,
  type ReceiptSummaryRow,
  type ReceiptSummarySort,
  type ReceiptSummarySortKey,
} from "@/lib/receivingReport";

export type ReceiptListView = "detail" | "summary";

type ReportKind = "summary" | "detail";

function downloadBlob(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function postExport(project: string, kind: ReportKind) {
  const request = receiptExportRequest(project, kind, Date.now());
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/receiving/export";
  form.acceptCharset = "UTF-8";
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "payload";
  input.value = request.body;
  form.append(input);
  document.body.append(form);
  form.submit();
  form.remove();
}

async function downloadExport(project: string, kind: ReportKind) {
  if (
    prefersFileShare(navigator.userAgent, {
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform,
    })
  ) {
    postExport(project, kind);
    return;
  }
  const request = receiptExportRequest(project, kind, Date.now());
  const response = await fetch("/api/receiving/export", {
    method: "POST",
    cache: request.cache,
    headers: request.headers,
    body: request.body,
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(result?.error || "Export failed.");
  }
  const csv = await response.text();
  const match = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
  downloadBlob(match?.[1] || (kind === "summary" ? "receipt-summary.csv" : "receipts.csv"), csv);
}

const SUMMARY_COLUMNS: { key: ReceiptSummarySortKey; label: string; className: string }[] = [
  { key: "sku", label: "SKU", className: "fit sku" },
  { key: "item", label: "Item", className: "summary-item" },
  { key: "qty", label: "Qty", className: "num fit" },
  { key: "putaway", label: "Putaway", className: "locations" },
  { key: "lines", label: "Lines", className: "num fit" },
  { key: "status", label: "Status", className: "fit" },
];

function sortDirection(sort: ReceiptSummarySort, column: ReceiptSummarySortKey): ReceiptSummarySort["dir"] | null {
  return sort.key === column ? sort.dir : null;
}

function SortButton({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: ReceiptSummarySortKey;
  sort: ReceiptSummarySort;
  onSort: (key: ReceiptSummarySortKey) => void;
}) {
  const direction = sortDirection(sort, column);
  return (
    <button type="button" className="receive-col-sort" title={`Sort by ${label}`} onClick={() => onSort(column)}>
      {label}
      {direction ? <span aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span> : null}
    </button>
  );
}

function SortHeading({
  label,
  column,
  className,
  sort,
  onSort,
}: {
  label: string;
  column: ReceiptSummarySortKey;
  className: string;
  sort: ReceiptSummarySort;
  onSort: (key: ReceiptSummarySortKey) => void;
}) {
  const direction = sortDirection(sort, column);
  return (
    <th
      className={className}
      scope="col"
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
    >
      <SortButton label={label} column={column} sort={sort} onSort={onSort} />
    </th>
  );
}

export function ReceiptReports({
  project,
  ready,
  stamp,
  view,
  onView,
}: {
  project: string;
  ready: boolean;
  stamp: number;
  view: ReceiptListView;
  onView: (view: ReceiptListView) => void;
}) {
  const [busy, setBusy] = useState<"summary" | ReportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReceiptSummaryRow[] | null>(null);
  const [sort, setSort] = useState<ReceiptSummarySort>(RECEIPT_SUMMARY_DEFAULT_SORT);
  const [shownFor, setShownFor] = useState(project);
  if (shownFor !== project) {
    setShownFor(project);
    setRows(null);
  }

  useEffect(() => {
    if (view !== "summary" || !ready) return;
    let cancel = false;
    setBusy("summary");
    setError(null);
    projectReceiptSummary(project)
      .then((next) => {
        if (!cancel) setRows(next);
      })
      .catch((cause) => {
        if (!cancel) {
          setRows(null);
          setError(errorText(cause));
        }
      })
      .finally(() => {
        if (!cancel) setBusy((current) => (current === "summary" ? null : current));
      });
    return () => {
      cancel = true;
    };
  }, [view, project, ready, stamp]);

  async function exportCsv(kind: ReportKind) {
    setBusy(kind);
    setError(null);
    try {
      await downloadExport(project, kind);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy((current) => (current === kind ? null : current));
    }
  }

  const disabled = !ready || busy !== null;
  const pending = rows?.filter((row) => row.pending).length ?? 0;
  const skus = rows ? rows.length - pending : 0;
  const sortedRows = useMemo(() => (rows ? sortReceiptSummary(rows, sort) : null), [rows, sort]);

  function onColumnSort(key: ReceiptSummarySortKey) {
    setSort((current) => toggleReceiptSummarySort(current, key));
  }

  return (
    <>
      <div className="receive-recent-head">
        <h2>Recent entries</h2>
        <div className="receive-actions">
          <div className="label-segments receive-view-switch" role="group" aria-label="Recent entries view">
            <button type="button" aria-pressed={view === "detail"} onClick={() => onView("detail")}>
              Detail
            </button>
            <button type="button" aria-pressed={view === "summary"} onClick={() => onView("summary")}>
              Summary
            </button>
          </div>
          <button type="button" className="secondary" disabled={disabled} onClick={() => void exportCsv("detail")}>
            Export CSV
          </button>
        </div>
      </div>
      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      {view === "summary" ? (
        <div className="receive-summary">
          <p className="hint">
            One row per SKU for this project. It opens sorted by item name, linked SKUs first and pending searches
            after them. Click a column heading to sort by that column, and click it again to reverse. Item is the item
            name, or the search when no SKU is linked. Putaway is the quantity in each bin, for example (x14)10002-C |
            (x8)10037. Lines with no item are grouped by the exact search.
          </p>
          <div className="receive-actions">
            <button type="button" className="secondary" disabled={disabled || !rows} onClick={() => void exportCsv("summary")}>
              Download summary CSV
            </button>
          </div>
          {!ready || (!rows && busy === "summary") ? (
            <p className="hint">Loading summary…</p>
          ) : rows && rows.length === 0 ? (
            <p className="hint">No receipts for this project yet.</p>
          ) : sortedRows ? (
            <>
              <p className="hint">
                {skus} {skus === 1 ? "SKU" : "SKUs"}
                {pending > 0 ? `, ${pending} pending ${pending === 1 ? "search" : "searches"}` : ""}.
              </p>
              <div className="receive-summary-scroll">
                <table className="receive-table">
                  <thead>
                    <tr>
                      {SUMMARY_COLUMNS.map((column) => (
                        <SortHeading
                          key={column.key}
                          label={column.label}
                          column={column.key}
                          className={column.className}
                          sort={sort}
                          onSort={onColumnSort}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row) => {
                      const item = summaryItemLabel(row);
                      return (
                        <tr
                          key={`${row.pending ? "pending" : "item"}:${row.sku}:${row.search}:${row.name}:${row.locations}:${row.qty}:${row.lines}`}
                          className={row.pending ? "receipt-line receipt-unmatched" : "receipt-line"}
                        >
                          <td className="fit sku">{row.sku}</td>
                          <td className="summary-item" title={item || undefined}>
                            {item}
                          </td>
                          <td className="num fit">{row.qty}</td>
                          <td className="locations" title={row.locations || undefined}>
                            {row.locations}
                          </td>
                          <td className="num fit">{row.lines}</td>
                          <td className="fit">{row.pending ? "Pending item" : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
