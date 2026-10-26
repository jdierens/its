"use client";

import { useEffect, useState } from "react";
import { prefersFileShare } from "@/lib/export/download";
import { errorText } from "@/lib/errors";
import { projectReceiptSummary } from "@/lib/receivingActions";
import type { ReceiptSummaryRow } from "@/lib/receivingReport";

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
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/receiving/export";
  form.acceptCharset = "UTF-8";
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "payload";
  input.value = JSON.stringify({ project, kind });
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
  const response = await fetch("/api/receiving/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project, kind }),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(result?.error || "Export failed.");
  }
  const csv = await response.text();
  const match = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
  downloadBlob(match?.[1] || (kind === "summary" ? "receipt-summary.csv" : "receipts.csv"), csv);
}

export function ReceiptReports({
  project,
  ready,
  stamp,
}: {
  project: string;
  ready: boolean;
  stamp: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"summary" | ReportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReceiptSummaryRow[] | null>(null);
  const [shownFor, setShownFor] = useState(project);
  if (shownFor !== project) {
    setShownFor(project);
    setRows(null);
  }

  useEffect(() => {
    if (!open || !ready) return;
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
  }, [open, project, ready, stamp]);

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

  return (
    <>
      <div className="receive-recent-head">
        <h2>Recent entries</h2>
        <div className="receive-actions">
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            Summary
          </button>
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
      {open ? (
        <div className="receive-summary">
          <p className="hint">
            One row per SKU for this project, sorted by item name. Lines with no item are grouped by the exact search
            and listed after the SKUs.
          </p>
          <div className="receive-actions">
            <button type="button" className="secondary" disabled={disabled || !rows} onClick={() => void exportCsv("summary")}>
              Download summary CSV
            </button>
          </div>
          {!rows && busy === "summary" ? (
            <p className="hint">Loading summary…</p>
          ) : rows && rows.length === 0 ? (
            <p className="hint">No receipts for this project yet.</p>
          ) : rows ? (
            <>
              <p className="hint">
                {skus} {skus === 1 ? "SKU" : "SKUs"}
                {pending > 0 ? `, ${pending} pending ${pending === 1 ? "search" : "searches"}` : ""}.
              </p>
              <div className="receive-summary-scroll">
                <table className="receive-table">
                  <thead>
                    <tr>
                      <th className="fit">SKU</th>
                      <th className="item">Item name</th>
                      <th className="search">Search</th>
                      <th className="num fit">Qty</th>
                      <th className="num fit">Lines</th>
                      <th className="fit">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr
                        key={row.pending ? `pending:${index}` : `item:${index}`}
                        className={row.pending ? "receipt-line receipt-unmatched" : "receipt-line"}
                      >
                        <td className="fit">{row.sku}</td>
                        <td className="item">{row.name}</td>
                        <td className="search" title={row.search}>
                          {row.search}
                        </td>
                        <td className="num fit">{row.qty}</td>
                        <td className="num fit">{row.lines}</td>
                        <td className="fit">{row.pending ? "Pending item" : ""}</td>
                      </tr>
                    ))}
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
