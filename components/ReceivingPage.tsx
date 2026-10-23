"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { BIN_LABEL_PRINT_CSS, BinLabel } from "@/components/BinLabel";
import { FastInput } from "@/components/FastField";
import { barcodeValue, LABEL_PRINT_CSS } from "@/components/ItemLabel";
import { PrintedLabel } from "@/components/labelRenderers";
import { reprintBin } from "@/lib/binActions";
import { BIN_TYPES, type BinType } from "@/lib/bins";
import { errorText } from "@/lib/errors";
import { descriptionSnippet } from "@/lib/labelLookup";
import {
  labelCommitAction,
  labelHighlightedChoice,
  labelSearchOutcome,
  labelShownText,
} from "@/lib/labelDeskSelection";
import { fetchBinLabelTemplates, fetchLabelTemplate } from "@/lib/labelActions";
import { searchItemsForLabel } from "@/lib/labelLookupServer";
import type { BinLabelTemplates, LabelTemplateId } from "@/lib/labelTemplates";
import { emptyBinLabelTemplates, qrLabelPayload } from "@/lib/labelTemplates";
import { fetchPutawaySetting, type LocationRow } from "@/lib/locationSettings";
import {
  createReceivingBin,
  fetchBinDetail,
  listReceivingEntries,
  receiveIntoBin,
  suggestBins,
} from "@/lib/receivingActions";
import {
  RECEIVING_DATE_EDITABLE,
  formatReceivedOn,
  originQtyInput,
  warehouseToday,
  type ReceivingEntry,
} from "@/lib/receivingSettings";
import {
  parseReceivingBinCode,
  typedBinCodeError,
  type BinDetail,
  type BinSuggestion,
  type CreatedBin,
  type ReceiptResult,
} from "@/lib/stockReceive";
import type { LabelItem } from "@/lib/types";

function todayLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function parseQty(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000000) return null;
  return parsed;
}

type PrintJob =
  | { kind: "bin"; reference: string; type: BinType }
  | { kind: "item"; item: LabelItem; qty: number; printedOn: string };

export function ReceivingPage() {
  const typed = useRef("");
  const holdQuery = useRef<string | null>(null);
  const requestId = useRef(0);
  const binTyped = useRef("");
  const codeTyped = useRef("");
  const [identifier, setIdentifier] = useState("");
  const [held, setHeld] = useState(0);
  const [edited, setEdited] = useState(false);
  const [item, setItem] = useState<LabelItem | null>(null);
  const [matches, setMatches] = useState<LabelItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [active, setActive] = useState(-1);
  const [settledQuery, setSettledQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [project, setProject] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [incomingTag, setIncomingTag] = useState("");
  const [origin, setOrigin] = useState("");
  const [originQty, setOriginQty] = useState("");
  const [entries, setEntries] = useState<ReceivingEntry[]>([]);
  const [entriesNext, setEntriesNext] = useState<number | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [binMode, setBinMode] = useState<"existing" | "new">("existing");
  const [binCode, setBinCode] = useState("");
  const [binHeld, setBinHeld] = useState(0);
  const [confirmed, setConfirmed] = useState<BinDetail | null>(null);
  const [suffix, setSuffix] = useState<BinType>("B");
  const [codeMode, setCodeMode] = useState<"next" | "typed">("next");
  const [typedCode, setTypedCode] = useState("");
  const [codeHeld, setCodeHeld] = useState(0);
  const [created, setCreated] = useState<CreatedBin | null>(null);
  const [qty, setQty] = useState("1");
  const [comment, setComment] = useState("");
  const [suggestions, setSuggestions] = useState<BinSuggestion[]>([]);
  const [receipt, setReceipt] = useState<{ result: ReceiptResult; item: LabelItem; qty: number; printedOn: string } | null>(null);
  const [templates, setTemplates] = useState<BinLabelTemplates>(emptyBinLabelTemplates);
  const [itemTemplate, setItemTemplate] = useState<LabelTemplateId>("barcode");
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [defaultIds, setDefaultIds] = useState<Record<BinType, string>>({ B: "", C: "", P: "" });
  const [pageOrigin, setPageOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [printStamp, setPrintStamp] = useState(0);

  useEffect(() => {
    setReceivedOn(warehouseToday());
    setPageOrigin(window.location.origin);
    void Promise.all([fetchLabelTemplate(), fetchBinLabelTemplates()])
      .then(([itemChoice, binChoice]) => {
        setItemTemplate(itemChoice);
        setTemplates(binChoice);
      })
      .catch(() => undefined);
    void fetchPutawaySetting()
      .then((setting) => {
        setLocations(setting.locations);
        setDefaultIds(setting.defaults);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!item) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void suggestBins(item.id, project)
        .then((rows) => {
          if (!cancelled) setSuggestions(rows);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [item, project]);

  useEffect(() => {
    if (printStamp === 0) return;
    window.print();
  }, [printStamp]);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setEntriesLoading(true);
      void listReceivingEntries(project, 0)
        .then((page) => {
          if (cancelled) return;
          setEntries(page.rows);
          setEntriesNext(page.nextOffset);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(errorText(cause));
        })
        .finally(() => {
          if (!cancelled) setEntriesLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [project]);

  async function loadMoreEntries() {
    if (entriesNext == null) return;
    setEntriesLoading(true);
    setError(null);
    try {
      const page = await listReceivingEntries(project, entriesNext);
      setEntries((current) => [...current, ...page.rows]);
      setEntriesNext(page.nextOffset);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setEntriesLoading(false);
    }
  }

  function choose(next: LabelItem) {
    const shown = labelShownText(next);
    holdQuery.current = shown;
    typed.current = shown;
    setHeld((current) => current + 1);
    setIdentifier(shown);
    setItem(next);
    setMatches([]);
    setTruncated(false);
    setActive(-1);
    setSettledQuery("");
    setError(null);
  }

  async function runSearch(raw: string, submitted: boolean) {
    const query = raw.trim();
    if (!query) {
      setItem(null);
      setMatches([]);
      setError("Enter a SKU, name, or description.");
      return;
    }
    const id = ++requestId.current;
    setSearching(true);
    setError(null);
    try {
      const result = await searchItemsForLabel(query);
      if (id !== requestId.current) return;
      if (!submitted && typed.current.trim() !== query) return;
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
        setActive(-1);
        setError("No items found");
        return;
      }
      setItem(null);
      setMatches(outcome.matches);
      setTruncated(outcome.truncated);
      setActive(outcome.matches.length > 0 ? 0 : -1);
    } catch (searchError) {
      if (id === requestId.current) setError(errorText(searchError));
    } finally {
      if (id === requestId.current) setSearching(false);
    }
  }

  useEffect(() => {
    if (!edited) return;
    const query = identifier.trim();
    if (holdQuery.current && query === holdQuery.current) return;
    holdQuery.current = null;
    if (!query) {
      setMatches([]);
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

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      selectOrSearch();
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length > 0) {
      event.preventDefault();
      setActive((current) => {
        if (event.key === "ArrowDown") return current < 0 ? 0 : Math.min(matches.length - 1, current + 1);
        return current < 0 ? matches.length - 1 : Math.max(0, current - 1);
      });
    }
  }

  async function confirmBin(raw: string) {
    const reference = (parseReceivingBinCode(raw)?.reference ?? raw.trim().toUpperCase());
    if (!reference) {
      setError("Scan or type a bin code.");
      setConfirmed(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const detail = await fetchBinDetail(reference);
      if (!detail) {
        setConfirmed(null);
        setError("No bin with that code. Use New bin.");
        return;
      }
      binTyped.current = detail.reference;
      setBinCode(detail.reference);
      setBinHeld((current) => current + 1);
      setConfirmed(detail);
    } catch (lookupError) {
      setError(errorText(lookupError));
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    const code = codeMode === "typed" ? codeTyped.current.trim() : null;
    if (codeMode === "typed") {
      const problem = typedBinCodeError(code ?? "", suffix);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const bin = await createReceivingBin(suffix, code ? code.toUpperCase() : null);
      setCreated(bin);
      binTyped.current = bin.reference;
      setBinCode(bin.reference);
      setBinHeld((current) => current + 1);
      setBinMode("existing");
      const detail = await fetchBinDetail(bin.reference);
      setConfirmed(detail);
      setPrintJob({ kind: "bin", reference: bin.reference, type: bin.type });
      setPrintStamp((current) => current + 1);
    } catch (createError) {
      setError(errorText(createError));
    } finally {
      setBusy(false);
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!item) {
      setError("Choose an item.");
      return;
    }
    const reference = confirmed?.reference;
    if (!reference) {
      setError("Scan an existing bin, or create one.");
      return;
    }
    const parsed = parseQty(qty);
    if (parsed == null) {
      setError("Enter a whole number of at least 1.");
      return;
    }
    const originParsed = originQtyInput(originQty);
    if (!originParsed.ok) {
      setError("Originating system qty is a whole number from 0 to 1000000.");
      return;
    }
    if (RECEIVING_DATE_EDITABLE && !/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) {
      setError("Enter a receiving date.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await receiveIntoBin({
        reference,
        itemId: item.id,
        qty: parsed,
        comment,
        project,
        origin,
        incomingTag,
        receivedOn,
        originQty: originParsed.qty,
      });
      const printedOn = todayLabel(new Date());
      const savedItem = item;
      setReceipt({ result, item: savedItem, qty: parsed, printedOn });
      const detail = await fetchBinDetail(reference);
      setConfirmed(detail);
      typed.current = "";
      holdQuery.current = null;
      setHeld((current) => current + 1);
      setEdited(false);
      setIdentifier("");
      setItem(null);
      setMatches([]);
      setTruncated(false);
      setActive(-1);
      setSettledQuery("");
      setSuggestions([]);
      setQty("1");
      setComment("");
      const page = await listReceivingEntries(project, 0);
      setEntries(page.rows);
      setEntriesNext(page.nextOffset);
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function printBinLabel(reference: string, type: BinType) {
    setError(null);
    try {
      await reprintBin(reference, 1);
    } catch (printError) {
      setError(errorText(printError));
      return;
    }
    setPrintJob({ kind: "bin", reference, type });
    setPrintStamp((current) => current + 1);
  }

  function printItemLabel() {
    if (!receipt) return;
    setPrintJob({
      kind: "item",
      item: receipt.item,
      qty: receipt.qty,
      printedOn: receipt.printedOn,
    });
    setPrintStamp((current) => current + 1);
  }

  const openCycle = confirmed?.cycles.find((cycle) => cycle.status === "open") ?? null;
  const defaultCode = locations.find((location) => location.id === defaultIds[suffix])?.code;
  const listOpen = matches.length > 0;

  return (
    <main className="page receiving-page desk-fields">
      <style>{`${LABEL_PRINT_CSS}\n${BIN_LABEL_PRINT_CSS}`}</style>
      <div className="no-print">
        <p className="page-note">The header is the receipt. The line is one SKU into one bin.</p>
        {receipt ? (
          <section className="receive-saved" id="receive-saved" aria-label="Saved receipt">
            <p className="banner ok" role="status">
              Saved {receipt.qty} of {receipt.item.sku || receipt.item.name} into {receipt.result.reference}.{" "}
              {receipt.result.cycleOpened ? "A new cycle is open." : "Joined the open cycle."}{" "}
              <Link href={`/warehouse/bins/${receipt.result.reference}`}>Open this bin</Link>
            </p>
            <div className="receive-actions">
              <button
                type="button"
                onClick={() => void printBinLabel(receipt.result.reference, receipt.result.type)}
              >
                Print bin label
              </button>
              <button type="button" onClick={printItemLabel}>
                Print item label
              </button>
            </div>
          </section>
        ) : null}
        <section className="card receive-card" id="receive-header">
          <h2>Receipt</h2>
          <div className="receive-header-grid">
            <label htmlFor="receive-project">
              <span>Project</span>
              <input
                id="receive-project"
                value={project}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setProject(event.target.value)}
              />
            </label>
            <label htmlFor="receive-date">
              <span>Receiving date</span>
              <input
                id="receive-date"
                type={RECEIVING_DATE_EDITABLE ? "date" : "text"}
                value={receivedOn}
                readOnly={!RECEIVING_DATE_EDITABLE}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setReceivedOn(event.target.value)}
              />
            </label>
            <label htmlFor="receive-incoming">
              <span>Incoming bin</span>
              <input
                id="receive-incoming"
                value={incomingTag}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setIncomingTag(event.target.value)}
              />
            </label>
            <label htmlFor="receive-origin">
              <span>Originating system</span>
              <input
                id="receive-origin"
                value={origin}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setOrigin(event.target.value)}
              />
            </label>
            <label htmlFor="receive-origin-qty">
              <span>Originating system qty</span>
              <input
                id="receive-origin-qty"
                className="num-input"
                value={originQty}
                inputMode="numeric"
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setOriginQty(event.target.value)}
              />
            </label>
          </div>
          <p className="hint">
            A bin that already has stock keeps the cycle it opened with. Each saved line stores this header, including the receiving date.
          </p>
        </section>

        <section className="card receive-card" id="receive-line">
          <h2>Line</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            selectOrSearch();
          }}
        >
          <label htmlFor="receive-sku">
            <span>SKU, name, or description</span>
          <FastInput
            id="receive-sku"
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
            aria-controls="receive-results"
            aria-busy={searching}
            aria-activedescendant={active >= 0 ? `receive-hit-${matches[active]?.id}` : undefined}
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
          </label>
          {listOpen ? (
            <ul className="label-results" id="receive-results" role="listbox">
              {matches.map((match, index) => (
                <li key={match.id}>
                  <button
                    type="button"
                    id={`receive-hit-${match.id}`}
                    className="label-hit"
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(match)}
                  >
                    <strong>{match.sku || match.name}</strong>
                    <span>{match.name}</span>
                    {match.description ? <span className="muted">{descriptionSnippet(match.description)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {truncated ? <span className="hint">Showing the first matches. Type more to narrow them.</span> : null}
          {item ? (
            <p className="hint">
              {item.sku || item.id}
              {item.name ? ` · ${item.name}` : ""}
            </p>
          ) : null}
        </form>

        <form onSubmit={onSave}>
          {item && suggestions.length > 0 ? (
            <div>
              <p className="hint">This SKU is already in these bins on this project.</p>
              <div className="receive-actions">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.cycleId}
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setBinMode("existing");
                      void confirmBin(suggestion.reference);
                    }}
                  >
                    {suggestion.reference}
                    {suggestion.locationCode ? ` · ${suggestion.locationCode}` : ""} · {suggestion.qty}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {item && suggestions.length === 0 ? (
            <p className="hint">No bin on this project already holds that SKU. An empty bin is not suggested.</p>
          ) : null}

          <div className="receive-line-row">
            <div className="receive-toggle-field">
              <span id="receive-bin-mode-label">Bin</span>
              <div className="label-segments receive-segments" role="group" aria-labelledby="receive-bin-mode-label">
                <button type="button" aria-pressed={binMode === "existing"} onClick={() => setBinMode("existing")}>
                  Existing
                </button>
                <button type="button" aria-pressed={binMode === "new"} onClick={() => setBinMode("new")}>
                  New
                </button>
              </div>
            </div>
            {binMode === "existing" ? (
              <div className="receive-code-field">
                <label htmlFor="receive-bin">Code</label>
                <div className="receive-code-controls">
                  <FastInput
                    id="receive-bin"
                    className="receive-bin-code"
                    value={binCode}
                    syncKey={binHeld}
                    maxLength={10}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    disabled={busy}
                    onDraft={(value) => {
                      binTyped.current = value;
                    }}
                    onValue={(value) => {
                      setBinCode(value);
                      if (confirmed && value.trim().toUpperCase() !== confirmed.reference) setConfirmed(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void confirmBin(binTyped.current);
                      }
                    }}
                  />
                  <button type="button" className="secondary" disabled={busy} onClick={() => void confirmBin(binTyped.current || binCode)}>
                    Look up
                  </button>
                </div>
              </div>
            ) : (
              <div className="receive-code-field">
                <label htmlFor="receive-new-code">Code</label>
                <div className="receive-code-controls">
                  <FastInput
                    id="receive-new-code"
                    className="receive-bin-code"
                    value={codeMode === "next" ? "" : typedCode}
                    syncKey={codeHeld}
                    maxLength={10}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder={codeMode === "next" ? "Next" : `20000-${suffix}`}
                    disabled={busy || codeMode === "next"}
                    onDraft={(value) => {
                      codeTyped.current = value;
                    }}
                    onValue={setTypedCode}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void onCreate();
                      }
                    }}
                  />
                  <button type="button" className="secondary" disabled={busy} onClick={() => void onCreate()}>
                    Create
                  </button>
                </div>
              </div>
            )}
            <label className="receive-line-qty" htmlFor="receive-qty">
              <span>Qty</span>
              <input
                id="receive-qty"
                className="num-input"
                value={qty}
                inputMode="numeric"
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setQty(event.target.value)}
              />
            </label>
          </div>

          {binMode === "new" ? (
            <div className="receive-new-options">
              <div className="label-segments receive-segments" role="group" aria-label="Bin suffix">
                {BIN_TYPES.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    aria-pressed={suffix === type.id}
                    onClick={() => setSuffix(type.id)}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
              <div className="label-segments receive-segments" role="group" aria-label="Bin code source">
                <button type="button" aria-pressed={codeMode === "next"} onClick={() => setCodeMode("next")}>
                  Next free code
                </button>
                <button type="button" aria-pressed={codeMode === "typed"} onClick={() => setCodeMode("typed")}>
                  Type a code
                </button>
              </div>
              <p className="hint">
                {codeMode === "next"
                  ? `The next number from the shared counter, with suffix -${suffix}.${defaultCode ? ` It is placed at ${defaultCode}.` : ""}`
                  : `Type a five-digit code, then Create. Suffix -${suffix}.`}
              </p>
            </div>
          ) : null}

          {confirmed ? (
            <p className="hint">
              {confirmed.reference}
              {confirmed.locationCode ? ` is at ${confirmed.locationCode}` : " has no location yet"}
              {created ? ", and its label is printed" : ""}.{" "}
              {openCycle
                ? `Open cycle${openCycle.project ? ` for ${openCycle.project}` : ""}${openCycle.originDescription ? `. ${openCycle.originDescription}` : ""}.`
                : "Empty. The next save opens a cycle."}
            </p>
          ) : null}

          {created && !receipt ? (
            <div className="label-preview">
              <div className="label-frame">
                <BinLabel reference={created.reference} type={created.type} layout={templates[created.type]} />
              </div>
            </div>
          ) : null}

          <label className="receive-comment" htmlFor="receive-comment">
            <span>Comment</span>
            <input
              id="receive-comment"
              value={comment}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          {error ? (
            <p className="banner error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="actions">
            <button id="receive-save" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save receipt"}
            </button>
          </div>
        </form>
        </section>

        <section className="card receive-card" id="receive-recent">
          <h2>Recent entries</h2>
          <p className="hint">
            {project.trim()
              ? `Receipts for ${project.trim()}, newest first.`
              : "Receipts with no project, newest first."}
          </p>
          {entries.length === 0 ? (
            <p className="hint">{entriesLoading ? "Loading receipts…" : "No receipts for this project yet."}</p>
          ) : (
            <>
              <div className="receive-table-scroll">
                <table className="receive-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>SKU</th>
                      <th>Bin</th>
                      <th className="num">Qty</th>
                      <th>Comment</th>
                      <th>Received by</th>
                      <th>Incoming bin</th>
                      <th>Originating system</th>
                      <th className="num">Originating system qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatReceivedOn(entry.receivedOn)}</td>
                        <td className="sku">{entry.sku}</td>
                        <td className="sku">{entry.bin}</td>
                        <td className="num">{entry.qty}</td>
                        <td>{entry.comment ?? ""}</td>
                        <td>{entry.receivedBy}</td>
                        <td>{entry.incomingBin ?? ""}</td>
                        <td>{entry.originatingSystem ?? ""}</td>
                        <td className="num">{entry.originQty ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="receive-cards">
                {entries.map((entry) => (
                  <li key={`card-${entry.id}`} className="receive-card-row">
                    <div className="receive-card-top">
                      <span className="sku">{entry.sku || "—"}</span>
                      <span className="num">{entry.qty}</span>
                    </div>
                    <div className="sku">{entry.bin}</div>
                    <p>
                      {formatReceivedOn(entry.receivedOn)}
                      {entry.receivedBy ? ` · ${entry.receivedBy}` : ""}
                    </p>
                    {entry.comment ? <p>{entry.comment}</p> : null}
                    <p className="hint">
                      {[entry.incomingBin, entry.originatingSystem, entry.originQty == null ? "" : String(entry.originQty)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
              {entriesNext != null ? (
                <div className="actions">
                  <button
                    id="receive-load-more"
                    type="button"
                    className="secondary"
                    disabled={entriesLoading}
                    onClick={() => void loadMoreEntries()}
                  >
                    {entriesLoading ? "Loading…" : "Load more"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
      <div className="print-sheet">
        {printJob?.kind === "bin" ? (
          <BinLabel reference={printJob.reference} type={printJob.type} layout={templates[printJob.type]} />
        ) : null}
        {printJob?.kind === "item" ? (
          <PrintedLabel
            template={itemTemplate}
            name={printJob.item.name}
            description={printJob.item.description}
            code={
              itemTemplate === "qr" && pageOrigin
                ? qrLabelPayload(pageOrigin, printJob.item.id, printJob.item.sku)
                : barcodeValue(printJob.item.sku, printJob.item.id)
            }
            sku={printJob.item.sku}
            itemId={printJob.item.id}
            origin={pageOrigin}
            quantity={String(printJob.qty)}
            shortCode={printJob.item.shortCode}
            printedOn={printJob.printedOn}
          />
        ) : null}
      </div>
    </main>
  );
}
