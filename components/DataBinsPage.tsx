"use client";

import { useEffect, useMemo, useState } from "react";
import { BinLabel, binLabelPrintCss } from "@/components/BinLabel";
import {
  commitBinImport,
  exportDataTable,
  fetchLocationPrefixes,
  markImportedBinsPrinted,
  previewBinImport,
  type BinImportPreview,
  type BinImportResult,
  type DataExport,
} from "@/lib/dataActions";
import {
  importRowsFromMapped,
} from "@/lib/data/binRows";
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
import { BINS_TABLE, mappingColumns, templateColumns } from "@/lib/data/registry";
import { templateWorkbook } from "@/lib/data/templateWorkbook";
import { errorText } from "@/lib/errors";
import { fetchBinLabelTemplates } from "@/lib/labelActions";
import { emptyBinLabelTemplates, type BinLabelTemplates } from "@/lib/labelTemplates";
import { isBinType, type BinType } from "@/lib/bins";
import { binLabelSheet } from "@/lib/binLabelLayout";

type MappedInput = { code: string; location: string; note: string; type: string };

const columns = mappingColumns(BINS_TABLE);
const template = templateColumns(BINS_TABLE);

function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function inputsFrom(sheet: SheetTable, mapping: ColumnMapping): MappedInput[] {
  return sheet.rows
    .map((cells) => {
      const record = readMappedRow(sheet.headers, cells, mapping);
      return {
        code: record.code ?? "",
        location: record.location ?? "",
        note: record.note ?? "",
        type: record.type ?? "",
      };
    })
    .filter((row) => row.code || row.location || row.note || row.type);
}

const EXPORT_LABELS: Record<string, string> = {
  code: "Code",
  type: "Type",
  location: "Location",
  project: "Project",
  origin: "Origin",
  qty: "Qty",
  created_at: "Created",
  created_by_initials: "By",
  printed_count: "Printed",
  last_printed_at: "Last printed",
};

function statusLabel(status: string): string {
  if (status === "new") return "New";
  if (status === "exists") return "Exists";
  return "Error";
}

function numericExport(header: string): boolean {
  return header === "qty" || header === "printed_count";
}

export function DataBinsPage() {
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [paste, setPaste] = useState("");
  const [sheets, setSheets] = useState<SheetTable[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<BinImportPreview | null>(null);
  const [result, setResult] = useState<BinImportResult | null>(null);
  const [pending, setPending] = useState<MappedInput[]>([]);
  const [printLabels, setPrintLabels] = useState(false);
  const [templates, setTemplates] = useState<BinLabelTemplates>(emptyBinLabelTemplates());
  const [printRefs, setPrintRefs] = useState<string[]>([]);
  const [exported, setExported] = useState<DataExport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [fileName, setFileName] = useState("");
  const [showExport, setShowExport] = useState(false);

  const sheet = sheets.find((item) => item.name === sheetName) ?? sheets[0] ?? null;
  const missing = sheet ? missingRequired(columns, mapping) : [];
  const ignored = sheet ? unmappedHeaders(sheet.headers, mapping) : [];

  useEffect(() => {
    fetchLocationPrefixes()
      .then(setPrefixes)
      .catch((cause: unknown) => setError(errorText(cause)));
    exportDataTable("bins")
      .then(setExported)
      .catch(() => setExported(null));
  }, []);

  useEffect(() => {
    if (!printLabels) return;
    fetchBinLabelTemplates()
      .then(setTemplates)
      .catch(() => setTemplates(emptyBinLabelTemplates()));
  }, [printLabels]);

  const newCount = useMemo(
    () => (preview?.rows ?? []).filter((row) => row.status === "new").length,
    [preview],
  );
  const errorCount = useMemo(
    () => (preview?.rows ?? []).filter((row) => row.status === "error").length,
    [preview],
  );

  function mappingFor(next: SheetTable): ColumnMapping {
    const auto = autoMatch(next.headers, columns);
    return applyRememberedMapping(next.headers, auto, readRememberedMapping(BINS_TABLE.id));
  }

  function openWorkbook(nextSheets: SheetTable[], remembered: ColumnMapping | null): boolean {
    const usable = nextSheets.filter((item) => item.headers.length > 0);
    if (usable.length === 0) throw new Error("That file has no header row.");
    const first = usable[0];
    const auto = autoMatch(first.headers, columns);
    const nextMapping = applyRememberedMapping(first.headers, auto, remembered);
    setSheets(usable);
    setSheetName(first.name);
    setMapping(nextMapping);
    setPreview(null);
    setResult(null);
    setPrintRefs([]);
    setShowMap(true);
    if (remembered && missingRequired(columns, nextMapping).length === 0) {
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
      const started = openWorkbook(parsed.sheets, readRememberedMapping(BINS_TABLE.id));
      if (!started) setBusy(false);
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  }

  function onPaste() {
    setError(null);
    setMessage(null);
    try {
      const started = openWorkbook(parseCsvText(paste, "Pasted").sheets, readRememberedMapping(BINS_TABLE.id));
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
    setShowMap(true);
  }

  async function runPreview(source: SheetTable, nextMapping: ColumnMapping) {
    const inputs = inputsFrom(source, nextMapping);
    if (inputs.length === 0 || importRowsFromMapped(inputs).length === 0) {
      setError("That file has no data rows.");
      setShowMap(true);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      writeRememberedMapping(BINS_TABLE.id, nextMapping);
      const next = await previewBinImport(inputs);
      setPending(inputs);
      setPreview(next);
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
    if (!preview || errorCount > 0 || newCount === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const committed = await commitBinImport(pending);
      setResult(committed);
      setPreview({
        rows: committed.rows,
        counter: {
          before: committed.counterBefore,
          after: committed.counterAfter,
          bumped: committed.counterBumped,
        },
      });
      if (!committed.committed) {
        setMessage("Nothing was written. Fix the error rows and try again.");
        setShowMap(false);
        return;
      }
      const created = committed.rows.filter((row) => row.status === "new").map((row) => row.code);
      if (printLabels && created.length > 0) {
        await markImportedBinsPrinted(created);
        setPrintRefs(created);
        window.setTimeout(() => window.print(), 50);
      }
      const file = await exportDataTable("bins");
      setExported(file);
      const skipped = committed.rows.filter((row) => row.status === "exists").length;
      const counterText = committed.counterBumped
        ? `The next bin number moved from ${committed.counterBefore} to ${committed.counterAfter}.`
        : `The next bin number stays at ${committed.counterAfter}.`;
      setMessage(
        `Imported ${created.length} ${created.length === 1 ? "bin" : "bins"}. Skipped ${skipped} that already ${skipped === 1 ? "exists" : "exist"}. ${counterText}`,
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    saveBlob("bins-template.csv", new Blob([templateCsv(BINS_TABLE)], { type: "text/csv;charset=utf-8" }));
  }

  async function downloadXlsx() {
    setError(null);
    try {
      const bytes = await templateWorkbook(BINS_TABLE, { location: prefixes });
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      saveBlob(
        "bins-template.xlsx",
        new Blob([copy], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  function downloadExport() {
    if (!exported) return;
    saveBlob(exported.filename, new Blob([exported.csv], { type: "text/csv;charset=utf-8" }));
  }

  const printTypes = printRefs.map((reference) => {
    const suffix = reference.slice(-1);
    return isBinType(suffix) ? suffix : "B";
  });
  const labelSheet = binLabelSheet(printTypes);

  return (
    <main className="page data-page">
      <style>{binLabelPrintCss(labelSheet)}</style>
      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      {message && !preview ? <p className="banner ok">{message}</p> : null}

      <section className="card data-card" id="data-template">
        <h2>Template</h2>
        <p>The header row uses the ITS column names. Required columns are marked. One sample row follows the header.</p>
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
                  <td className="sku">{column.key}</td>
                  <td className={column.required ? "data-required" : ""}>
                    {column.required ? "Required" : "Optional"}
                  </td>
                  <td>{column.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          A Type column is optional and is not in the template. Box, Crate, Pallet, or B, C, or P fills a code that has
          no suffix. A 1–4 digit code is zero-padded to five digits.
          {prefixes.length > 0 ? ` Location prefixes: ${prefixes.join(", ")}.` : ""}
        </p>
        <div className="actions">
          <button type="button" className="secondary" onClick={downloadCsv}>
            Download CSV
          </button>
          <button type="button" className="secondary" onClick={() => void downloadXlsx()}>
            Download Excel
          </button>
        </div>
      </section>

      <section className="card data-card" id="data-import">
        <h2>Import</h2>
        <div className="data-import-row">
          <div className="data-file-field">
            <span className="data-label">Spreadsheet</span>
            <label className="button secondary file-button">
              Choose file
              <input
                id="data-file"
                type="file"
                accept=".csv,.txt,.xlsx,.xls,text/csv"
                disabled={busy}
                onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <span className="hint">{fileName || "CSV or Excel"}</span>
          </div>
          <div className="desk-fields data-paste-field">
            <label htmlFor="data-paste">
              <span>Or paste rows</span>
            </label>
            <textarea
              id="data-paste"
              value={paste}
              disabled={busy}
              onChange={(event) => setPaste(event.target.value)}
            />
            <button type="button" className="secondary" disabled={busy || paste.trim() === ""} onClick={onPaste}>
              Use pasted rows
            </button>
          </div>
        </div>
        <p className="hint">CSV may use commas, semicolons, or tabs, with or without a UTF-8 BOM. Excel uses the first sheet unless you pick another.</p>
      </section>

      {showMap && sheet ? (
        <section className="card data-card" id="data-map">
          <h2>Match columns</h2>
          {sheets.length > 1 ? (
            <div className="desk-fields data-sheet">
              <label>
                <span>Sheet</span>
                <select id="data-sheet" value={sheet.name} onChange={(event) => onSheet(event.target.value)}>
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
                    {column.required ? (
                      <span className="data-required"> Required</span>
                    ) : (
                      <span className="hint"> Optional</span>
                    )}
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
                  <div className="data-map-sample">
                    {source ? sampleValues(sheet.rows, sheet.headers, source).join(", ") : ""}
                  </div>
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
              id="data-continue"
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
        <section className="card data-card" id="data-preview">
          <h2>{result?.committed ? "Import result" : "Preview"}</h2>
          {message ? <p className="banner ok">{message}</p> : null}
          {result?.committed ? null : (
            <p className="hint">
              {errorCount > 0
                ? `Nothing is written while a row has an error. The next bin number stays at ${preview.counter.before}.`
                : preview.counter.bumped
                  ? `The next bin number will move from ${preview.counter.before} to ${preview.counter.after}.`
                  : `The next bin number stays at ${preview.counter.before}.`}
            </p>
          )}
          <div className="data-scroll data-preview-table">
            <table>
              <thead>
                <tr>
                  <th className="num">Row</th>
                  <th>Code</th>
                  <th>Location</th>
                  <th>Note</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={`${row.row}-${row.code}`} className={row.status === "error" ? "data-unmapped" : ""}>
                    <td className="num">{row.row}</td>
                    <td className="sku">{row.code}</td>
                    <td className="sku">{row.location}</td>
                    <td>{row.note}</td>
                    <td>
                      <span className={`data-pill data-pill-${row.status}`}>{statusLabel(row.status)}</span>
                    </td>
                    <td className={row.status === "error" ? "data-required" : ""}>{row.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="data-preview-cards">
            {preview.rows.map((row) => (
              <li key={`card-${row.row}-${row.code}`} className="data-preview-card">
                <div className="data-preview-card-top">
                  <span className="sku">{row.code}</span>
                  <span className={`data-pill data-pill-${row.status}`}>{statusLabel(row.status)}</span>
                </div>
                {row.location ? <div className="sku">{row.location}</div> : null}
                {row.reason ? (
                  <p className={row.status === "error" ? "data-reason" : "hint"}>{row.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
          {result?.committed ? null : (
            <div className="data-commit">
              <label className="data-check">
                <input
                  type="checkbox"
                  checked={printLabels}
                  onChange={(event) => setPrintLabels(event.target.checked)}
                />
                <span>Print labels for imported bins</span>
              </label>
              <p className="hint">
                Crate and box labels are 29 × 90 mm. Pallet labels are 62 × 100 mm. If this import
                mixes those, print one type at a time when the dialog only has one paper size.
              </p>
              <div className="actions">
                <button type="button" className="secondary" onClick={() => setShowMap(true)}>
                  Change mapping
                </button>
                <button
                  id="data-commit"
                  type="button"
                  disabled={busy || errorCount > 0 || newCount === 0}
                  onClick={() => void onImport()}
                >
                  {busy ? "Importing…" : `Import ${newCount} ${newCount === 1 ? "bin" : "bins"}`}
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <section className="card data-card" id="data-export">
        <h2>Export</h2>
        <p className="hint">
          Code, type, location, project, origin, quantity, and created and printed info.
          {exported?.truncated ? " The file includes the first 5000 bins." : ""}
        </p>
        <div className="actions">
          <button type="button" className="secondary" disabled={!exported} onClick={downloadExport}>
            Download CSV
          </button>
          <button
            id="data-show-export"
            type="button"
            className="secondary"
            disabled={!exported}
            onClick={() => setShowExport((current) => !current)}
          >
            {showExport ? "Hide table" : "Show table"}
          </button>
        </div>
        {showExport && exported ? (
          <div className="data-export-scroll">
            <table>
              <thead>
                <tr>
                  {exported.headers.map((header) => (
                    <th key={header} className={numericExport(header) ? "num" : ""}>
                      {EXPORT_LABELS[header] ?? header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exported.rows.map((row, index) => (
                  <tr key={`${row[0]}-${index}`}>
                    {row.map((value, cell) => {
                      const header = exported.headers[cell] ?? "";
                      return (
                        <td
                          key={`${header}-${cell}`}
                          className={numericExport(header) ? "num" : header === "code" || header === "location" ? "sku" : ""}
                        >
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <div className="print-sheet">
        {printRefs.map((reference) => {
          const suffix = reference.slice(-1);
          const type: BinType = isBinType(suffix) ? suffix : "B";
          return (
            <BinLabel key={reference} reference={reference} type={type} layout={templates[type]} sheet={labelSheet} />
          );
        })}
      </div>
    </main>
  );
}
