"use client";

import { useMemo, useState } from "react";
import { Download, Upload } from "lucide-react";
import { templateCsv } from "@/lib/data/csv";
import {
  applyRememberedMapping,
  autoMatch,
  missingRequired,
  readMappedRow,
  readRememberedMapping,
  sampleValues,
  unmappedHeaders,
  writeRememberedMapping,
  type ColumnMapping,
} from "@/lib/data/matchColumns";
import { parseCsvText, parseSpreadsheet, type SheetTable } from "@/lib/data/parseTable";
import { mappingColumns, templateColumns } from "@/lib/data/registry";
import { templateWorkbook } from "@/lib/data/templateWorkbook";
import { errorText } from "@/lib/errors";
import {
  commitReceivingImport,
  previewReceivingImport,
  type ReceivingImportPreviewRow,
  type ReceivingImportResult,
} from "@/lib/receivingImportActions";
import { RECEIVING_TABLE, type ReceivingImportDefaults } from "@/lib/receivingImport";

const columns = mappingColumns(RECEIVING_TABLE);
const template = templateColumns(RECEIVING_TABLE);

function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function rowsFrom(sheet: SheetTable, mapping: ColumnMapping): Record<string, string>[] {
  return sheet.rows.map((cells) => readMappedRow(sheet.headers, cells, mapping));
}

function statusLabel(status: string): string {
  return status === "ok" ? "OK" : "Error";
}

export function ReceivingImport({
  defaults,
  onImported,
}: {
  defaults: ReceivingImportDefaults;
  onImported?: () => void;
}) {
  const [paste, setPaste] = useState("");
  const [sheets, setSheets] = useState<SheetTable[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<ReceivingImportPreviewRow[] | null>(null);
  const [result, setResult] = useState<ReceivingImportResult | null>(null);
  const [requestIds, setRequestIds] = useState<string[]>([]);
  const [pending, setPending] = useState<Record<string, string>[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [fileName, setFileName] = useState("");

  const sheet = sheets.find((item) => item.name === sheetName) ?? sheets[0] ?? null;
  const missing = sheet ? missingRequired(columns, mapping) : [];
  const ignored = sheet ? unmappedHeaders(sheet.headers, mapping) : [];
  const errorCount = useMemo(() => (preview ?? []).filter((row) => row.status === "error").length, [preview]);
  const okCount = useMemo(() => (preview ?? []).filter((row) => row.status === "ok").length, [preview]);

  function mappingFor(next: SheetTable): ColumnMapping {
    const auto = autoMatch(next.headers, columns);
    return applyRememberedMapping(next.headers, auto, readRememberedMapping(RECEIVING_TABLE.id));
  }

  function openWorkbook(nextSheets: SheetTable[]): boolean {
    const usable = nextSheets.filter((item) => item.headers.length > 0);
    if (usable.length === 0) throw new Error("That file has no header row.");
    const first = usable.find((item) => item.name === "Receiving") ?? usable[0];
    const nextMapping = mappingFor(first);
    setSheets(usable);
    setSheetName(first.name);
    setMapping(nextMapping);
    setPreview(null);
    setResult(null);
    setRequestIds([]);
    setPending([]);
    setShowMap(true);
    if (missingRequired(columns, nextMapping).length === 0) {
      void runPreview(first, nextMapping);
      return true;
    }
    return false;
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    setMessage(null);
    setFileName(file.name);
    setBusy(true);
    try {
      const parsed = await parseSpreadsheet(await file.arrayBuffer(), file.name);
      const started = openWorkbook(parsed.sheets);
      if (!started) setBusy(false);
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  }

  function onPaste() {
    setError(null);
    setMessage(null);
    setFileName("Pasted rows");
    try {
      const started = openWorkbook(parseCsvText(paste, "Pasted").sheets);
      if (started) setBusy(true);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  function onSheet(name: string) {
    const next = sheets.find((item) => item.name === name);
    if (!next) return;
    setSheetName(name);
    setMapping(mappingFor(next));
    setPreview(null);
    setResult(null);
    setRequestIds([]);
    setShowMap(true);
  }

  async function runPreview(source: SheetTable, nextMapping: ColumnMapping) {
    const inputs = rowsFrom(source, nextMapping);
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      writeRememberedMapping(RECEIVING_TABLE.id, nextMapping);
      const next = await previewReceivingImport({ rows: inputs, defaults });
      setPending(inputs);
      setRequestIds(next.requestIds);
      setPreview(next.rows);
      setResult(null);
      setShowMap(false);
    } catch (cause) {
      setError(errorText(cause));
      setShowMap(true);
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!preview || errorCount > 0 || okCount === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const committed = await commitReceivingImport({ rows: pending, defaults, requestIds });
      setResult(committed);
      setPreview(committed.rows);
      if (!committed.committed) {
        setMessage("Nothing was written. Fix the error rows and try again.");
        return;
      }
      const count = committed.rows.filter((row) => row.status === "ok").length;
      setMessage(`Received ${count} ${count === 1 ? "row" : "rows"}.`);
      onImported?.();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    saveBlob("receiving-template.csv", new Blob([templateCsv(RECEIVING_TABLE)], { type: "text/csv;charset=utf-8" }));
  }

  async function downloadXlsx() {
    setError(null);
    try {
      const bytes = await templateWorkbook(RECEIVING_TABLE);
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      saveBlob(
        "receiving-template.xlsx",
        new Blob([copy], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  return (
    <div className="data-page" id="receive-import">
      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="card data-card">
        <h2>Template</h2>
        <p>
          Download the sheet, fill one row per receipt, and import it here. The header uses ITS field names. A row with no
          purchase order is consigned and needs a vendor. Blank vendor, purchase order, project, receiving date, incoming
          bin, originating system, and system qty use the receipt header above.
        </p>
        <div className="data-scroll">
          <table>
            <thead>
              <tr>
                <th>Column</th>
                <th>Status</th>
                <th>Example</th>
              </tr>
            </thead>
            <tbody>
              {template.map((column) => (
                <tr key={column.key}>
                  <td className="tabular">{column.key}</td>
                  <td className={column.required ? "data-required" : ""}>{column.required ? "Required" : "Optional"}</td>
                  <td>{column.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Cleaned is for a CPU and Wiped is for an SSD or HDD. Blank is no. Serial is optional; several serials go in one
          cell separated by a semicolon, a pipe, or a new line. Country of origin is a 2- or 3-letter code. The sample row
          is an example. Replace it before importing.
        </p>
        <div className="actions receive-import-actions">
          <button type="button" className="receive-import-go" onClick={() => void downloadXlsx()}>
            <Download size={18} strokeWidth={1.75} aria-hidden />
            Download template
          </button>
          <button type="button" className="secondary" onClick={downloadCsv}>
            Download CSV
          </button>
        </div>
      </section>

      <section className="card data-card" id="receive-import-upload">
        <h2>Import</h2>
        <div className="data-import-row">
          <div className="data-file-field">
            <span className="data-label">Spreadsheet</span>
            <label className="button secondary file-button">
              Choose file
              <input
                id="receive-import-file"
                type="file"
                accept=".csv,.txt,.xlsx,.xls,text/csv"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.target.value = "";
                  void onFile(file);
                }}
              />
            </label>
            <span className="hint">{fileName || "CSV or Excel"}</span>
          </div>
          <div className="desk-fields data-paste-field">
            <label htmlFor="receive-import-paste">
              <span>Or paste rows</span>
            </label>
            <textarea
              id="receive-import-paste"
              value={paste}
              disabled={busy}
              onChange={(event) => setPaste(event.target.value)}
            />
            <button type="button" className="secondary" disabled={busy || paste.trim() === ""} onClick={onPaste}>
              Use pasted rows
            </button>
          </div>
        </div>
        <p className="hint">
          The spreadsheet stays on this device. CSV may use commas, semicolons, or tabs. Column names can be the template
          headers or the same labels as a receipt export, and you can remap them before the preview.
        </p>
      </section>

      {showMap && sheet ? (
        <section className="card data-card" id="receive-import-map">
          <h2>Match columns</h2>
          {sheets.length > 1 ? (
            <div className="desk-fields data-sheet">
              <label>
                <span>Sheet</span>
                <select id="receive-import-sheet" value={sheet.name} onChange={(event) => onSheet(event.target.value)}>
                  {sheets.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <div className="data-map-rows">
            <div className="data-map-head">ITS field</div>
            <div className="data-map-head">Source column</div>
            <div className="data-map-head">Sample values</div>
            {columns.map((column) => {
              const source = mapping[column.key] ?? "";
              const unmatched = column.required && !source;
              return (
                <div key={column.key} className={unmatched ? "data-map-row data-unmapped" : "data-map-row"}>
                  <div className="data-map-field">
                    <span className="sku">{column.key}</span>
                    {column.required ? <span className="data-required"> Required</span> : <span className="hint"> Optional</span>}
                  </div>
                  <select
                    aria-label={`Source column for ${column.key}`}
                    value={source}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [column.key]: event.target.value || null,
                      }))
                    }
                  >
                    <option value="">Not mapped</option>
                    {sheet.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                  <div className="data-map-sample">{source ? sampleValues(sheet.rows, sheet.headers, source).join(", ") : ""}</div>
                </div>
              );
            })}
          </div>
          {ignored.length > 0 ? (
            <p className="hint">Ignored columns: {ignored.join(", ")}. They are not imported.</p>
          ) : (
            <p className="hint">Every source column is mapped.</p>
          )}
          {missing.length > 0 ? (
            <p className="data-required">Map {missing.map((column) => column.key).join(", ")} before continuing.</p>
          ) : null}
          <div className="actions">
            <button
              id="receive-import-continue"
              type="button"
              disabled={busy || missing.length > 0}
              onClick={() => void runPreview(sheet, mapping)}
            >
              {busy ? "Checking…" : "Continue"}
            </button>
          </div>
        </section>
      ) : null}

      {preview ? (
        <section className="card data-card" id="receive-import-preview">
          <h2>{result?.committed ? "Import result" : "Preview"}</h2>
          {message ? <p className="banner ok">{message}</p> : null}
          {result?.committed ? null : (
            <p className="hint">
              {errorCount > 0
                ? "Nothing is written while a row has an error."
                : "Each OK row is posted with receive into bin, the same path as Save receipt. A failure rolls the batch back."}
            </p>
          )}
          <div className="data-scroll data-preview-table">
            <table>
              <thead>
                <tr>
                  <th className="num">Row</th>
                  <th className="sku">SKU</th>
                  <th>Search</th>
                  <th className="num">Qty</th>
                  <th>Bin</th>
                  <th>Vendor</th>
                  <th>PO</th>
                  <th>Status</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.row} className={row.status === "error" ? "data-unmapped" : ""}>
                    <td className="num">{row.row}</td>
                    <td className="sku">{row.sku}</td>
                    <td>{row.search}</td>
                    <td className="num">{row.qty ?? ""}</td>
                    <td className="tabular">{row.bin}</td>
                    <td>{row.vendor}</td>
                    <td className="tabular">{row.purchaseOrder}</td>
                    <td>
                      <span className={`data-pill data-pill-${row.status}`}>{statusLabel(row.status)}</span>
                    </td>
                    <td className={row.status === "error" ? "data-required" : ""}>{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="data-preview-cards">
            {preview.map((row) => (
              <li key={`card-${row.row}`} className="data-preview-card">
                <div className="data-preview-card-top">
                  <span className="sku">{row.sku || row.search || `Row ${row.row}`}</span>
                  <span className={`data-pill data-pill-${row.status}`}>{statusLabel(row.status)}</span>
                </div>
                <div>
                  {row.qty ?? ""} × {row.bin}
                  {row.vendor ? ` · ${row.vendor}` : ""}
                </div>
                {row.message ? <p className={row.status === "error" ? "data-reason" : "hint"}>{row.message}</p> : null}
              </li>
            ))}
          </ul>
          {result?.committed ? null : (
            <div className="data-commit">
              <div className="actions receive-import-actions">
                <button type="button" className="secondary" onClick={() => setShowMap(true)}>
                  Change mapping
                </button>
                <button
                  id="receive-import-commit"
                  type="button"
                  className="receive-import-go"
                  disabled={busy || errorCount > 0 || okCount === 0}
                  onClick={() => void onImport()}
                >
                  <Upload size={18} strokeWidth={1.75} aria-hidden />
                  {busy ? "Importing…" : `Import ${okCount} ${okCount === 1 ? "row" : "rows"}`}
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
