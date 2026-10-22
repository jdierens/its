"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Printer, X } from "lucide-react";
import { FastInput } from "@/components/FastField";
import { PrintedLabel } from "@/components/labelRenderers";
import { barcodeValue, LABEL_PRINT_CSS } from "@/components/ItemLabel";
import { errorText } from "@/lib/errors";
import { findItemForLabel } from "@/lib/items";
import { fetchLabelTemplate } from "@/lib/labelActions";
import { labelCopiesCommit, labelCopiesDraft, labelQuantityCommit, labelQuantityDraft } from "@/lib/labelDesk";
import { descriptionSnippet, labelLookupChoice, labelResultApplies } from "@/lib/labelLookup";
import { searchItemsForLabel } from "@/lib/labelLookupServer";
import {
  labelTemplateLabel,
  labelTemplateOrDefault,
  qrLabelPayload,
  type LabelTemplateId,
} from "@/lib/labelTemplates";
import type { LabelItem } from "@/lib/types";

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
  const [item, setItem] = useState<LabelItem | null>(null);
  const [matches, setMatches] = useState<LabelItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [active, setActive] = useState(-1);
  const [settledQuery, setSettledQuery] = useState("");
  const [printedOn, setPrintedOn] = useState(() => todayLabel(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [printStamp, setPrintStamp] = useState(0);
  const [template, setTemplate] = useState<LabelTemplateId | null>(null);
  const [origin, setOrigin] = useState("");
  const [edited, setEdited] = useState(false);
  const requestId = useRef(0);
  const holdQuery = useRef<string | null>(null);
  const typed = useRef(initialIdentifier);
  const [held, setHeld] = useState(0);

  useEffect(() => {
    if (printStamp === 0) return;
    window.print();
  }, [printStamp]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

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
    const shown = found.sku || found.name;
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
      const choice = labelLookupChoice({
        submitted,
        exact: Boolean(result.exact),
        matchCount: result.matches.length,
        truncated: result.truncated,
      });
      setSettledQuery(query);
      if (choice === "select") {
        const found = result.exact ?? result.matches[0];
        if (!found) {
          setItem(null);
          setMatches([]);
          setError("No items found");
          return;
        }
        choose(found);
        return;
      }
      if (choice === "empty") {
        setItem(null);
        setMatches([]);
        setTruncated(false);
        setActive(-1);
        setError("No items found");
        return;
      }
      setItem(null);
      setMatches(result.matches);
      setTruncated(result.truncated);
      setActive(result.matches.length > 0 ? 0 : -1);
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

  function onFind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = identifier.trim();
    if (matches.length > 1 && settledQuery === query && active >= 0 && matches[active]) {
      choose(matches[active]);
      return;
    }
    void runSearch(query, true);
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
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

  function printLabel() {
    const nextQuantity = labelQuantityCommit(quantity);
    const nextCopies = labelCopiesCommit(copiesText);
    setQuantity(nextQuantity);
    setCopiesText(nextCopies);
    if (!item) return;
    setError(null);
    setPrintedOn(todayLabel(new Date()));
    setPrintStamp((current) => current + 1);
  }

  const code = item ? barcodeValue(item.sku, item.id) : "";
  const labelQuantity = labelQuantityCommit(quantity);
  const readyTemplate = template;
  const qrReady = readyTemplate !== "qr" || origin !== "";
  const payload = item && readyTemplate === "qr" && origin ? qrLabelPayload(origin, item.id, item.sku) : "";
  const listOpen = matches.length > 0;

  return (
    <main className="page">
      <style>{LABEL_PRINT_CSS}</style>
      <form className="no-print label-desk" onSubmit={onFind}>
        <p className="hint">The quantity is printed on the label. It does not change the item&apos;s stock.</p>
        <div className="label-row">
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
                  if (value !== typed.current) return;
                  if (holdQuery.current === value) return;
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
          <label className="label-qty" htmlFor="label-qty">
            <span className="label-caption">Qty on label</span>
            <FastInput
              id="label-qty"
              inputMode="numeric"
              autoComplete="off"
              value={quantity}
              transform={labelQuantityDraft}
              onValue={setQuantity}
              onBlur={() => setQuantity((current) => labelQuantityCommit(current))}
            />
          </label>
          <label className="label-copies" htmlFor="label-copies">
            <span className="label-caption">Copies</span>
            <FastInput
              id="label-copies"
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
            disabled={!item}
            onClick={printLabel}
          >
            <Printer size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
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
          <p>Brother QL-820NWB, DK-1201 die-cut labels, from a Mac browser. In the print dialog use:</p>
          <ul>
            <li>Paper size: 29 × 90 mm</li>
            <li>Orientation: Landscape</li>
            <li>Scale: 100%</li>
            <li>Margins: None</li>
            <li>Headers and footers: off</li>
          </ul>
          <p>Each copy is one 90 mm × 29 mm page. The preview below is the same size.</p>
        </div>
      </form>
      {item && readyTemplate && qrReady ? (
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
