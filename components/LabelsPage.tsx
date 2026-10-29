"use client";

import { useSearchParams } from "next/navigation";
import { usePageMeta } from "@/components/AppShell";
import { labelItemBackHref } from "@/lib/labelReturn";
import { FormEvent, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Printer, Trash2, X } from "lucide-react";
import { FastInput } from "@/components/FastField";
import { PrintedLabel } from "@/components/labelRenderers";
import { SerialItemLabel, SERIAL_LABEL_PRINT_CSS } from "@/components/SerialItemLabel";
import { barcodeValue, LABEL_PRINT_CSS } from "@/components/ItemLabel";
import { errorText } from "@/lib/errors";
import { findItemForLabel } from "@/lib/items";
import { fetchLabelTemplate } from "@/lib/labelActions";
import { labelCopiesCommit, labelCopiesDraft, labelQuantityCommit, labelQuantityDraft } from "@/lib/labelDesk";
import {
  labelCommitAction,
  labelHighlightedChoice,
  labelPrintProblem,
  labelSearchOutcome,
  labelShownText,
} from "@/lib/labelDeskSelection";
import { descriptionSnippet, labelResultApplies } from "@/lib/labelLookup";
import {
  addSerial,
  SERIAL_LABEL_SHOW_QTY,
  SERIAL_LABEL_SIZE,
  serialLabelQtyText,
  serialPrintProblem,
  serialsToPrint,
  type SerialAddStatus,
} from "@/lib/serialLabel";
import { searchItemsForLabel } from "@/lib/labelLookupServer";
import {
  labelTemplateLabel,
  labelTemplateOrDefault,
  qrLabelPayload,
  type LabelTemplateId,
} from "@/lib/labelTemplates";
import type { LabelItem } from "@/lib/types";

type LabelDeskMode = "item" | "serial";

const SERIAL_ADD_MESSAGE: Record<Exclude<SerialAddStatus, "added" | "empty">, string> = {
  duplicate: "That serial is already in the list.",
  full: "The list holds 30 serials. Print these, then scan the rest.",
};

function todayLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function LabelsPage() {
  const params = useSearchParams();
  const initialIdentifier = params.get("sku") ?? params.get("id") ?? "";
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [quantity, setQuantity] = useState("1");
  const [copiesText, setCopiesText] = useState("1");
  const [mode, setMode] = useState<LabelDeskMode>("item");
  const [serialDraft, setSerialDraft] = useState("");
  const [serials, setSerials] = useState<string[]>([]);
  const [serialHeld, setSerialHeld] = useState(0);
  const [item, setItem] = useState<LabelItem | null>(null);
  const [matches, setMatches] = useState<LabelItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [active, setActive] = useState(-1);
  const [settledQuery, setSettledQuery] = useState("");
  const [printedOn, setPrintedOn] = useState(() => todayLabel(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [template, setTemplate] = useState<LabelTemplateId | null>(null);
  const [origin, setOrigin] = useState("");
  const [edited, setEdited] = useState(false);
  const [openedItemId, setOpenedItemId] = useState<string | null>(null);
  const backHref = labelItemBackHref(params.get("from"), params.get("id"), openedItemId);

  usePageMeta({
    title: "Labels",
    crumbs: [{ label: "Inventory" }, { label: "Labels" }],
    ...(backHref ? { backHref, backLabel: "Back to item" } : {}),
  });
  const requestId = useRef(0);
  const holdQuery = useRef<string | null>(null);
  const typed = useRef(initialIdentifier);
  const [held, setHeld] = useState(0);
  const wantSerialFocus = useRef(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (mode !== "serial" || !wantSerialFocus.current) return;
    wantSerialFocus.current = false;
    document.getElementById("label-serial")?.focus();
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    fetchLabelTemplate()
      .then((value) => {
        if (!cancelled) setTemplate(value);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTemplate(labelTemplateOrDefault(null));
        setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!initialIdentifier) return;
    let cancelled = false;
    setLoading(true);
    findItemForLabel(initialIdentifier)
      .then((found) => {
        if (cancelled) return;
        setItem(found);
        setPrintedOn(todayLabel(new Date()));
        if (found) setOpenedItemId((current) => current ?? found.id);
        if (!found) setError("No items found");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialIdentifier]);

  const copies = useMemo(() => Number(labelCopiesCommit(copiesText)), [copiesText]);

  function choose(found: LabelItem) {
    requestId.current += 1;
    setLoading(false);
    const shown = labelShownText(found);
    typed.current = shown;
    holdQuery.current = shown;
    setHeld((current) => current + 1);
    setIdentifier(shown);
    setItem(found);
    setMatches([]);
    setTruncated(false);
    setActive(-1);
    setSettledQuery("");
    setError(null);
    setPrintedOn(todayLabel(new Date()));
    if (mode === "serial") {
      window.requestAnimationFrame(() => document.getElementById("label-serial")?.focus());
    }
  }

  function selectMode(next: LabelDeskMode) {
    if (next === mode) return;
    setError(null);
    if (next === "serial") wantSerialFocus.current = true;
    setMode(next);
  }

  async function runSearch(raw: string, submitted: boolean) {
    const query = raw.trim();
    if (!query) {
      setItem(null);
      setMatches([]);
      setTruncated(false);
      setError("Enter a SKU, name, or description.");
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await searchItemsForLabel(query);
      if (id !== requestId.current || !labelResultApplies(typed.current, query, submitted)) return;
      const outcome = labelSearchOutcome({
        submitted,
        exact: result.exact,
        matches: result.matches,
        truncated: result.truncated,
      });
      setSettledQuery(query);
      if (outcome.type === "select") {
        choose(outcome.item);
        return;
      }
      if (outcome.type === "empty" || outcome.type === "missing") {
        setItem(null);
        setMatches([]);
        setTruncated(false);
        setActive(-1);
        setError("No items found");
        return;
      }
      setItem(null);
      setMatches(outcome.matches);
      setTruncated(outcome.truncated);
      setActive(outcome.matches.length > 0 ? 0 : -1);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(errorText(err));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!edited) return;
    const query = identifier.trim();
    if (holdQuery.current && query === holdQuery.current) return;
    holdQuery.current = null;
    if (!query) {
      setMatches([]);
      setTruncated(false);
      setActive(-1);
      return;
    }
    const handle = window.setTimeout(() => {
      void runSearch(query, false);
    }, 300);
    return () => {
      window.clearTimeout(handle);
      requestId.current += 1;
    };
  }, [edited, identifier]);

  function selectOrSearch() {
    const field = typed.current.trim();
    const highlighted = labelHighlightedChoice({
      identifier: field,
      settledQuery,
      matches,
      active,
    });
    if (highlighted) {
      choose(highlighted);
      return;
    }
    void runSearch(field, true);
  }

  function onFind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    selectOrSearch();
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      selectOrSearch();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (matches.length === 0) return;
      event.preventDefault();
      setActive((current) => {
        if (event.key === "ArrowDown") {
          if (current < 0) return 0;
          return Math.min(matches.length - 1, current + 1);
        }
        if (current < 0) return matches.length - 1;
        return Math.max(0, current - 1);
      });
      return;
    }
    if (event.key === "Escape") {
      setMatches([]);
      setActive(-1);
      setTruncated(false);
    }
  }

  function clearSearch() {
    requestId.current += 1;
    holdQuery.current = null;
    typed.current = "";
    setHeld((current) => current + 1);
    setEdited(true);
    setIdentifier("");
    setItem(null);
    setMatches([]);
    setTruncated(false);
    setActive(-1);
    setSettledQuery("");
    setError(null);
    setLoading(false);
  }

  function commitSerial(raw: string) {
    const next = addSerial(serials, raw);
    if (next.status === "empty") return;
    if (next.status !== "added") {
      setError(SERIAL_ADD_MESSAGE[next.status]);
      return;
    }
    setSerials(next.list);
    setSerialDraft("");
    setSerialHeld((current) => current + 1);
    setError(null);
  }

  function removeSerial(serial: string) {
    setSerials((current) => current.filter((row) => row !== serial));
  }

  function printLabel() {
    const nextQuantity = labelQuantityCommit(quantity);
    const nextCopies = labelCopiesCommit(copiesText);
    setQuantity(nextQuantity);
    setCopiesText(nextCopies);
    if (mode === "serial") {
      const pending = serialsToPrint(serials, serialDraft);
      const problem = serialPrintProblem({ hasItem: item !== null, serialCount: pending.length });
      if (problem) {
        setError(problem);
        return;
      }
      if (!serials.some((row) => row.toLowerCase() === pending[pending.length - 1]?.toLowerCase())) {
        setSerials(pending);
        setSerialDraft("");
        setSerialHeld((current) => current + 1);
      }
    } else {
      const templateReady = template !== null && (template !== "qr" || origin !== "");
      const problem = labelPrintProblem({ hasItem: item !== null, templateReady });
      if (problem) {
        setError(problem);
        return;
      }
    }
    setError(null);
    setPrintedOn(todayLabel(new Date()));
    try {
      window.print();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const code = item ? barcodeValue(item.sku, item.id) : "";
  const labelQuantity = labelQuantityCommit(quantity);
  const readyTemplate = template;
  const qrReady = readyTemplate !== "qr" || origin !== "";
  const payload = item && readyTemplate === "qr" && origin ? qrLabelPayload(origin, item.id, item.sku) : "";
  const listOpen = matches.length > 0;
  const serialBatch = serialsToPrint(serials, mode === "serial" ? serialDraft : "");
  const canPrint = mode === "serial" ? item !== null && serialBatch.length > 0 : item !== null;
  const previewSerial = serialBatch[0] ?? "";

  return (
    <main className="page">
      <style>{mode === "serial" ? SERIAL_LABEL_PRINT_CSS : LABEL_PRINT_CSS}</style>
      <form className="no-print label-desk" onSubmit={onFind}>
        <p className="hint">
          {mode === "serial" && !SERIAL_LABEL_SHOW_QTY
            ? "Each serial is its own page. Printing does not change the item's stock."
            : "The quantity is printed on the label. It does not change the item's stock."}
        </p>
        <div className={mode === "serial" ? "label-row serial-on" : "label-row"}>
          <div className="label-kind">
            <span className="label-caption" id="label-kind-caption">
              Label
            </span>
            <div className="label-segments" role="group" aria-labelledby="label-kind-caption">
              <button type="button" aria-pressed={mode === "item"} onClick={() => selectMode("item")}>
                Item
              </button>
              <button type="button" aria-pressed={mode === "serial"} onClick={() => selectMode("serial")}>
                Serial
              </button>
            </div>
          </div>
          <label className="label-query" htmlFor="label-search">
            <span className="label-caption">Search</span>
            <span className="label-query-box">
              <FastInput
                id="label-search"
                value={identifier}
                syncKey={held}
                autoFocus
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={listOpen}
                aria-controls="label-results"
                aria-busy={loading}
                aria-activedescendant={active >= 0 ? `label-hit-${matches[active]?.id}` : undefined}
                onDraft={(value) => {
                  typed.current = value;
                  requestId.current += 1;
                }}
                onValue={(value) => {
                  const action = labelCommitAction({
                    value,
                    typed: typed.current,
                    held: holdQuery.current,
                    identifier,
                  });
                  if (action === "ignore") return;
                  holdQuery.current = null;
                  setEdited(true);
                  setIdentifier(value);
                  setItem(null);
                  setMatches([]);
                  setTruncated(false);
                  setActive(-1);
                  setError(null);
                }}
                onKeyDown={onSearchKey}
              />
              {identifier ? (
                <button type="button" className="label-clear" aria-label="Clear search" title="Clear search" onClick={clearSearch}>
                  <X size={14} strokeWidth={1.75} aria-hidden />
                </button>
              ) : null}
            </span>
          </label>
          {mode === "serial" ? (
            <label className="label-serial" htmlFor="label-serial">
              <span className="label-caption">Serial number</span>
              <FastInput
                id="label-serial"
                value={serialDraft}
                syncKey={serialHeld}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                onValue={setSerialDraft}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  commitSerial(event.currentTarget.value);
                }}
              />
            </label>
          ) : null}
          <div className="label-actions">
            {mode === "item" || SERIAL_LABEL_SHOW_QTY ? (
              <label className="label-qty" htmlFor="label-qty">
                <span className="label-caption">Qty on label</span>
                <FastInput
                  id="label-qty"
                  size={4}
                  inputMode="numeric"
                  autoComplete="off"
                  value={quantity}
                  transform={labelQuantityDraft}
                  onValue={setQuantity}
                  onBlur={() => setQuantity((current) => labelQuantityCommit(current))}
                />
              </label>
            ) : null}
            <label className="label-copies" htmlFor="label-copies">
              <span className="label-caption">Copies</span>
              <FastInput
                id="label-copies"
                size={2}
                inputMode="numeric"
                autoComplete="off"
                value={copiesText}
                transform={labelCopiesDraft}
                onValue={setCopiesText}
                onBlur={() => setCopiesText((current) => labelCopiesCommit(current))}
              />
            </label>
            <button
              type="button"
              className="label-print"
              aria-label="Print"
              title="Print"
              disabled={!canPrint}
              onClick={printLabel}
            >
              <Printer size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
        {mode === "serial" && serials.length > 0 ? (
          <table className="serial-scan" aria-label="Serials to print">
            <thead>
              <tr>
                <th>Serial</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {serials.map((serial) => (
                <tr key={serial}>
                  <td>{serial}</td>
                  <td>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${serial}`}
                      title={`Remove ${serial}`}
                      onClick={() => removeSerial(serial)}
                    >
                      <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {listOpen ? (
          <ul className="label-results" id="label-results" role="listbox" aria-label="Matching items">
            {matches.map((match, index) => {
              const snippet = descriptionSnippet(match.description);
              return (
                <li key={match.id}>
                  <button
                    type="button"
                    id={`label-hit-${match.id}`}
                    className="label-hit"
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onPointerDown={(event) => {
                      if (event.pointerType === "mouse" && event.button !== 0) return;
                      event.preventDefault();
                      choose(match);
                    }}
                    onClick={() => choose(match)}
                  >
                    <span className="label-hit-sku">{match.sku || "No SKU"}</span>
                    <span className="label-hit-name">{match.name}</span>
                    {snippet ? <span className="label-hit-desc">{snippet}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {truncated ? <p className="hint">Showing 25 matches. Refine your search.</p> : null}
        {error ? (
          <p className="banner error" role="status">
            {error}
          </p>
        ) : null}
        <div className="print-help">
          {mode === "serial" ? (
            <>
              <p>Brother QL-820NWB, DK-1202 die-cut labels, from a Mac browser. The dialog should already show:</p>
              <ul>
                <li>Paper size: {SERIAL_LABEL_SIZE}</li>
                <li>Scale: 100%</li>
                <li>Margins: None</li>
                <li>Headers and footers: off</li>
              </ul>
              <p>
                The Brother paper is 62 mm across the tape and 100 mm along the feed. The label art is turned
                onto that page, so leave orientation alone. Landscape clips the right side. Each serial is one
                page, and copies print that page again.
                {SERIAL_LABEL_SHOW_QTY
                  ? " Qty on label is printed on every page and does not change stock."
                  : " Printing does not change stock."}{" "}
                Scan a serial and press Enter to add another, up to 30. The preview below is the same size.
              </p>
            </>
          ) : (
            <>
              <p>Brother QL-820NWB, DK-1201 die-cut labels, from a Mac browser. In the print dialog use:</p>
              <ul>
                <li>Paper size: 29 × 90 mm</li>
                <li>Orientation: Landscape</li>
                <li>Scale: 100%</li>
                <li>Margins: None</li>
                <li>Headers and footers: off</li>
              </ul>
              <p>Each copy is one 90 mm × 29 mm page. The preview below is the same size.</p>
            </>
          )}
        </div>
      </form>
      {mode === "serial" && item && previewSerial ? (
        <>
          <div className="no-print label-preview">
            <p className="hint">
              Preview for {item.sku || item.id}. {serialBatch.length} {serialBatch.length === 1 ? "serial" : "serials"}{" "}
              × {copies} {copies === 1 ? "copy" : "copies"}.
              {SERIAL_LABEL_SHOW_QTY ? ` Each label prints ${serialLabelQtyText(quantity)}.` : null}
            </p>
            <div className="serial-frame">
              <SerialItemLabel
                sku={item.sku}
                description={item.description.trim() || item.name}
                quantity={labelQuantity}
                showQuantity={SERIAL_LABEL_SHOW_QTY}
                serial={previewSerial}
              />
            </div>
          </div>
          <div className="print-sheet">
            {serialBatch.flatMap((serial) =>
              Array.from({ length: Math.max(copies, 1) }, (_, index) => (
                <SerialItemLabel
                  key={`${serial}-${index}`}
                  sku={item.sku}
                  description={item.description.trim() || item.name}
                  quantity={labelQuantity}
                  showQuantity={SERIAL_LABEL_SHOW_QTY}
                  serial={serial}
                />
              )),
            )}
          </div>
        </>
      ) : null}
      {mode === "item" && item && readyTemplate && qrReady ? (
        <>
          <div className="no-print label-preview">
            <p className="hint">
              Preview for {item.sku || item.id}. {copies} {copies === 1 ? "copy" : "copies"} will print.
              Template: {labelTemplateLabel(readyTemplate)}.{" "}
              {readyTemplate === "qr" ? `QR code opens ${payload}.` : `Barcode encodes ${code}.`}
            </p>
            <div className="label-frame">
              <PrintedLabel
                template={readyTemplate}
                name={item.name}
                description={item.description}
                code={code}
                sku={item.sku}
                itemId={item.id}
                origin={origin}
                quantity={labelQuantity}
                shortCode={item.shortCode}
                printedOn={printedOn}
              />
            </div>
          </div>
          <div className="print-sheet">
            {Array.from({ length: Math.max(copies, 1) }, (_, index) => (
              <PrintedLabel
                key={`${item.id}-${readyTemplate}-${index}`}
                template={readyTemplate}
                name={item.name}
                description={item.description}
                code={code}
                sku={item.sku}
                itemId={item.id}
                origin={origin}
                quantity={labelQuantity}
                shortCode={item.shortCode}
                printedOn={printedOn}
              />
            ))}
          </div>
        </>
      ) : null}
    </main>
  );
}
