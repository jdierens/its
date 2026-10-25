"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Save } from "lucide-react";
import { BIN_LABEL_PRINT_CSS, BinLabel } from "@/components/BinLabel";
import { FastInput } from "@/components/FastField";
import { barcodeValue, LABEL_PRINT_CSS } from "@/components/ItemLabel";
import { PrintedLabel } from "@/components/labelRenderers";
import { ReceiptCard, ReceiptTableRow } from "@/components/ReceiptInline";
import { ReceivingProjectField } from "@/components/ReceivingProjectField";
import { fetchBinCounter, reprintBin } from "@/lib/binActions";
import { BIN_TYPES, formatBinReference, type BinType } from "@/lib/bins";
import { errorText } from "@/lib/errors";
import { descriptionSnippet } from "@/lib/labelLookup";
import {
  labelCommitAction,
  labelHighlightedChoice,
  labelSearchOutcome,
} from "@/lib/labelDeskSelection";
import { fetchBinLabelTemplates, fetchLabelTemplate } from "@/lib/labelActions";
import type { BinLabelTemplates, LabelTemplateId } from "@/lib/labelTemplates";
import { emptyBinLabelTemplates, qrLabelPayload } from "@/lib/labelTemplates";
import {
  createReceivingBin,
  fetchBinDetail,
  lastPutawayBin,
  listReceivingEntries,
  receiveIntoBin,
  receivingClerkInitials,
  recentReceivingProjects,
  searchReceivingScan,
  suggestBins,
} from "@/lib/receivingActions";
import { distinctRecentProjects, projectToRestore, readStoredProject, writeStoredProject } from "@/lib/receivingProjects";
import { receiptSearchQuery, scanSearchNote, searchFieldAfterPick } from "@/lib/receivingScan";
import {
  RECEIVING_DATE_EDITABLE,
  RECEIVING_PAGE_SIZE,
  receivingLastPage,
  receivingPageOffset,
  beginReceiptSave,
  finishReceiptSave,
  originQtyInput,
  receiptSavedNote,
  receiveLineQty,
  warehouseToday,
  type ReceiptSaveGate,
  type ReceivingEntry,
} from "@/lib/receivingSettings";
import { binCanReceive, nextReceivingBinCode, receiptFlagsForPrep, receivePrepKind, receivingBinDecision, receivingBinDefault, skuAlreadyInBinNote } from "@/lib/receivingLine";
import {
  parseReceivingBinCode,
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

type PrintJob =
  | { kind: "bin"; reference: string; type: BinType }
  | { kind: "item"; item: LabelItem; qty: number; printedOn: string };

type BinPrompt =
  | { kind: "create"; reference: string; type: BinType; resumeSave: boolean }
  | { kind: "required"; nextNumber: number; type: BinType; resumeSave: boolean };

function ReceiptPager({
  page,
  total,
  loading,
  onPage,
}: {
  page: number;
  total: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const last = receivingLastPage(total);
  const from = total === 0 ? 0 : receivingPageOffset(page) + 1;
  const to = Math.min(receivingPageOffset(page) + RECEIVING_PAGE_SIZE, total);
  return (
    <nav className="receive-pager" aria-label="Pages">
      <button
        type="button"
        className="secondary"
        aria-label="First page"
        title="First page"
        disabled={loading || page <= 1}
        onClick={() => onPage(1)}
      >
        <ChevronsLeft size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className="secondary"
        aria-label="Previous page"
        title="Previous page"
        disabled={loading || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className="secondary"
        aria-label="Next page"
        title="Next page"
        disabled={loading || page >= last}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className="secondary"
        aria-label="Last page"
        title="Last page"
        disabled={loading || page >= last}
        onClick={() => onPage(last)}
      >
        <ChevronsRight size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <span className="hint">
        {from}–{to} of {total}
      </span>
    </nav>
  );
}

export function ReceivingPage() {
  const typed = useRef("");
  const holdQuery = useRef<string | null>(null);
  const requestId = useRef(0);
  const binTyped = useRef("");
  const binSource = useRef<"empty" | "user" | "prefill">("empty");
  const prefilledBin = useRef("");
  const binEdit = useRef(0);
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
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [projectReady, setProjectReady] = useState(false);
  const [projectStorageKey, setProjectStorageKey] = useState<string | null>(null);
  const [receivedOn, setReceivedOn] = useState("");
  const [incomingTag, setIncomingTag] = useState("");
  const [origin, setOrigin] = useState("");
  const [originQty, setOriginQty] = useState("");
  const [entries, setEntries] = useState<ReceivingEntry[]>([]);
  const [entryPage, setEntryPage] = useState(1);
  const [entryTotal, setEntryTotal] = useState(0);
  const listedProject = useRef<string | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [listStamp, setListStamp] = useState(0);
  const [editorInitials, setEditorInitials] = useState("");
  const [scanRaw, setScanRaw] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [binCode, setBinCode] = useState("");
  const [binHeld, setBinHeld] = useState(0);
  const [confirmed, setConfirmed] = useState<BinDetail | null>(null);
  const [binPrompt, setBinPrompt] = useState<BinPrompt | null>(null);
  const [created, setCreated] = useState<CreatedBin | null>(null);
  const [cleaned, setCleaned] = useState(false);
  const [wiped, setWiped] = useState(false);
  const [qty, setQty] = useState("");
  const [comment, setComment] = useState("");
  const [suggestions, setSuggestions] = useState<BinSuggestion[]>([]);
  const [receipt, setReceipt] = useState<{ result: ReceiptResult; item: LabelItem; qty: number; printedOn: string } | null>(null);
  const [templates, setTemplates] = useState<BinLabelTemplates>(emptyBinLabelTemplates);
  const [itemTemplate, setItemTemplate] = useState<LabelTemplateId>("barcode");
  const [pageOrigin, setPageOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveGate = useRef<ReceiptSaveGate>({ inFlight: false, requestId: null });
  const [focusSku, setFocusSku] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [printStamp, setPrintStamp] = useState(0);

  useEffect(() => {
    setReceivedOn(warehouseToday());
    setPageOrigin(window.location.origin);
    void receivingClerkInitials()
      .then(setEditorInitials)
      .catch(() => setEditorInitials(""));
    void Promise.all([fetchLabelTemplate(), fetchBinLabelTemplates()])
      .then(([itemChoice, binChoice]) => {
        setItemTemplate(itemChoice);
        setTemplates(binChoice);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void recentReceivingProjects()
      .then((recent) => {
        if (cancelled) return;
        setRecentProjects(recent.projects);
        setProjectStorageKey(recent.storageKey);
        const stored = readStoredProject(window.localStorage, recent.storageKey);
        setProject(projectToRestore(stored, recent.latest));
        setProjectReady(true);
      })
      .catch(() => {
        if (!cancelled) setProjectReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectReady || !projectStorageKey) return;
    writeStoredProject(window.localStorage, projectStorageKey, project);
  }, [project, projectReady, projectStorageKey]);

  useEffect(() => {
    if (!item) {
      if (binSource.current !== "user" && binTyped.current) {
        binSource.current = "empty";
        prefilledBin.current = "";
        binTyped.current = "";
        setBinCode("");
        setBinHeld((current) => current + 1);
        setConfirmed(null);
        setBinPrompt(null);
      }
      return;
    }
    if (binSource.current === "user" && binTyped.current.trim()) return;
    let cancelled = false;
    const itemId = item.id;
    const editAtStart = binEdit.current;
    void lastPutawayBin(itemId)
      .then((reference) => {
        if (cancelled || binEdit.current !== editAtStart) return;
        if (binSource.current === "user" && binTyped.current.trim()) return;
        const next = receivingBinDefault({ lastReference: reference, userTyped: false, current: "" });
        const source = next ? "prefill" : "empty";
        if (binTyped.current === next && binSource.current === source) return;
        binSource.current = source;
        prefilledBin.current = next;
        binTyped.current = next;
        setBinCode(next);
        setBinHeld((current) => current + 1);
        setConfirmed(null);
        setBinPrompt(null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item]);

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
    if (focusSku === 0) return;
    document.getElementById("receive-sku")?.focus();
  }, [focusSku]);

  useEffect(() => {
    if (!projectReady) return;
    if (listedProject.current !== null && listedProject.current !== project && entryPage !== 1) {
      listedProject.current = project;
      setEntryPage(1);
      return;
    }
    listedProject.current = project;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setEntriesLoading(true);
      void listReceivingEntries(project, receivingPageOffset(entryPage))
        .then((page) => {
          if (cancelled) return;
          const last = receivingLastPage(page.total);
          if (entryPage > last) {
            setEntryPage(last);
            return;
          }
          setEntries(page.rows);
          setEntryTotal(page.total);
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
  }, [project, listStamp, projectReady, entryPage]);

  function choose(next: LabelItem, rawScan: string | null = null, typedQuery: string | null = null) {
    const search = searchFieldAfterPick(typed.current, next);
    holdQuery.current = search.trim();
    setItem(next);
    setMatches([]);
    setTruncated(false);
    setActive(-1);
    setSettledQuery("");
    setError(null);
    setSearchQuery(receiptSearchQuery(typedQuery ?? search));
    if (rawScan) setComment((current) => (current.trim() ? current : rawScan));
    setCleaned(false);
    setWiped(false);
  }

  async function runSearch(raw: string, submitted: boolean) {
    const query = raw.trim();
    if (!query) {
      setItem(null);
      setMatches([]);
      setScanRaw(null);
      setSearchQuery(null);
      setScanNote(null);
      setError("Enter a SKU, name, or description.");
      return;
    }
    const id = ++requestId.current;
    setSearching(true);
    setError(null);
    try {
      const result = await searchReceivingScan(query);
      if (id !== requestId.current) return;
      if (!submitted && typed.current.trim() !== query) return;
      const found = Boolean(result.exact || result.matches.length > 0);
      const rawScan = result.tried.length > 1 ? result.scanRaw : null;
      setScanRaw(rawScan);
      setScanNote(scanSearchNote({ token: result.token, tried: result.tried, found }));
      const outcome = labelSearchOutcome({
        submitted,
        exact: result.exact,
        matches: result.matches,
        truncated: result.truncated,
        loneSelects: true,
      });
      setSettledQuery(query);
      if (outcome.type === "select") {
        choose(outcome.item, rawScan, query);
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
      choose(highlighted, null, settledQuery || field);
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

  function acceptBin(detail: BinDetail) {
    binTyped.current = detail.reference;
    setBinCode(detail.reference);
    setBinHeld((current) => current + 1);
    setConfirmed(detail);
    setBinPrompt(null);
  }

  async function lookupBin(raw: string, resumeSave: boolean): Promise<string | null> {
    const preliminary = receivingBinDecision(raw, null);
    if (preliminary.action === "empty") return null;
    if (preliminary.action === "invalid") {
      setConfirmed(null);
      setBinPrompt(null);
      setError(preliminary.message);
      return null;
    }
    const parsed = parseReceivingBinCode(raw);
    if (parsed && confirmed?.reference === parsed.reference && binCanReceive(confirmed)) {
      setBinPrompt(null);
      return confirmed.reference;
    }
    setBusy(true);
    setError(null);
    try {
      const detail = parsed ? await fetchBinDetail(parsed.reference) : null;
      const outcome = receivingBinDecision(
        raw,
        detail ? { reference: detail.reference, canReceive: binCanReceive(detail) } : null,
      );
      if (outcome.action === "accept" && detail) {
        acceptBin(detail);
        return detail.reference;
      }
      if (outcome.action === "create") {
        setConfirmed(null);
        setBinPrompt({ kind: "create", reference: outcome.reference, type: outcome.type, resumeSave });
        return null;
      }
      setConfirmed(null);
      setBinPrompt(null);
      if (outcome.action === "unusable" || outcome.action === "invalid") setError(outcome.message);
      return null;
    } catch (lookupError) {
      setError(errorText(lookupError));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function askForNextBin(resumeSave: boolean): Promise<void> {
    const counter = await fetchBinCounter();
    const code = nextReceivingBinCode(counter.nextNumber, "B");
    if (!code) {
      setBinPrompt(null);
      setError("The next bin number must be five digits. Set it in Settings.");
      return;
    }
    setError(null);
    setBinPrompt({ kind: "required", nextNumber: counter.nextNumber, type: "B", resumeSave });
  }

  async function confirmBinPrompt() {
    const prompt = binPrompt;
    if (!prompt) return;
    const type = prompt.type;
    const code = prompt.kind === "create" ? prompt.reference : formatBinReference(prompt.nextNumber, type);
    setBusy(true);
    setError(null);
    try {
      const bin = await createReceivingBin(type, code);
      setCreated(bin);
      binTyped.current = bin.reference;
      binSource.current = "user";
      prefilledBin.current = "";
      binEdit.current += 1;
      setBinCode(bin.reference);
      setBinHeld((current) => current + 1);
      const detail = await fetchBinDetail(bin.reference);
      if (detail && binCanReceive(detail)) setConfirmed(detail);
      else setConfirmed(detail);
      setBinPrompt(null);
      setPrintJob({ kind: "bin", reference: bin.reference, type: bin.type });
      setPrintStamp((current) => current + 1);
      if (prompt.resumeSave) {
        const claim = beginReceiptSave(saveGate.current, crypto.randomUUID());
        if (!claim.ok) return;
        saveGate.current = claim.gate;
        await commitReceipt(bin.reference, claim.requestId);
      }
    } catch (createError) {
      setError(errorText(createError));
    } finally {
      setBusy(false);
    }
  }

  function releaseSave(saved: boolean) {
    saveGate.current = finishReceiptSave(saveGate.current, saved);
    setSaving(false);
  }

  async function commitReceipt(reference: string, requestId: string) {
    if (!item) {
      releaseSave(false);
      setError("Choose an item.");
      return;
    }
    const parsed = receiveLineQty(qty);
    if (!parsed.ok) {
      releaseSave(false);
      setError(parsed.message);
      return;
    }
    const originParsed = originQtyInput(originQty);
    if (!originParsed.ok) {
      releaseSave(false);
      setError("Originating system qty is a whole number from 0 to 1000000.");
      return;
    }
    if (RECEIVING_DATE_EDITABLE && !/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) {
      releaseSave(false);
      setError("Enter a receiving date.");
      return;
    }
    const flags = receiptFlagsForPrep(
      receivePrepKind({ shortCode: item.shortCode, longCode: item.longCode, taxonomyName: item.taxonomyName }),
      cleaned,
      wiped,
    );
    setSaving(true);
    setError(null);
    try {
      const result = await receiveIntoBin({
        reference,
        itemId: item.id,
        qty: parsed.qty,
        comment,
        project,
        origin,
        incomingTag,
        receivedOn,
        originQty: originParsed.qty,
        clientRequestId: requestId,
        scanRaw,
        searchQuery,
        cleaned: flags.cleaned,
        wiped: flags.wiped,
      });
      const printedOn = todayLabel(new Date());
      const savedItem = item;
      setReceipt({ result, item: savedItem, qty: parsed.qty, printedOn });
      typed.current = "";
      holdQuery.current = null;
      binTyped.current = "";
      binSource.current = "empty";
      prefilledBin.current = "";
      binEdit.current += 1;
      setHeld((current) => current + 1);
      setBinHeld((current) => current + 1);
      setEdited(false);
      setIdentifier("");
      setItem(null);
      setMatches([]);
      setTruncated(false);
      setActive(-1);
      setSettledQuery("");
      setSuggestions([]);
      setBinCode("");
      setConfirmed(null);
      setCreated(null);
      setBinPrompt(null);
      setCleaned(false);
      setWiped(false);
      setQty("");
      setComment("");
      setScanRaw(null);
      setSearchQuery(null);
      setScanNote(null);
      setFocusSku((current) => current + 1);
      if (project.trim()) {
        setRecentProjects((current) =>
          distinctRecentProjects([{ project }, ...current.map((name) => ({ project: name }))]),
        );
      }
      const page = await listReceivingEntries(project, 0);
      setEntries(page.rows);
      setEntryTotal(page.total);
      setEntryPage(1);
      void recentReceivingProjects()
        .then((recent) => {
          setRecentProjects((current) =>
            distinctRecentProjects([
              ...current.map((name) => ({ project: name })),
              ...recent.projects.map((name) => ({ project: name })),
            ]),
          );
        })
        .catch(() => undefined);
      releaseSave(true);
    } catch (saveError) {
      setError(errorText(saveError));
      releaseSave(false);
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    const claim = beginReceiptSave(saveGate.current, crypto.randomUUID());
    if (!claim.ok) return;
    saveGate.current = claim.gate;
    if (!item) {
      releaseSave(false);
      setError("Choose an item.");
      return;
    }
    const parsed = receiveLineQty(qty);
    if (!parsed.ok) {
      releaseSave(false);
      setError(parsed.message);
      return;
    }
    const rawBin = (binTyped.current || binCode).trim();
    if (!rawBin) {
      releaseSave(false);
      try {
        await askForNextBin(true);
      } catch (counterError) {
        setError(errorText(counterError));
      }
      return;
    }
    const reference = await lookupBin(rawBin, true);
    if (!reference) {
      releaseSave(false);
      return;
    }
    await commitReceipt(reference, claim.requestId);
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
  const listOpen = matches.length > 0;
  const prep = receivePrepKind({
    shortCode: item?.shortCode,
    longCode: item?.longCode,
    taxonomyName: item?.taxonomyName,
  });
  const suggestedCode =
    binPrompt?.kind === "required" ? formatBinReference(binPrompt.nextNumber, binPrompt.type) : null;

  return (
    <main className="page receiving-page desk-fields ds">
      <style>{`${LABEL_PRINT_CSS}\n${BIN_LABEL_PRINT_CSS}`}</style>
      <div className="no-print">
        <p className="page-note">The header is the receipt. The line is one SKU into one bin.</p>
        <section className="card receive-card" id="receive-header">
          <h2>Receipt</h2>
          <div className="receive-header-grid">
            <ReceivingProjectField
              value={project}
              projects={recentProjects}
              disabled={busy || !projectReady}
              onChange={setProject}
            />
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
              <span>Orig. system qty</span>
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

        {receipt ? (
          <section className="receive-saved" id="receive-saved" aria-label="Saved receipt">
            <p className="banner ok" role="status">
              {receiptSavedNote({
                qty: receipt.qty,
                sku: receipt.item.sku,
                name: receipt.item.name,
                reference: receipt.result.reference,
                cycleOpened: receipt.result.cycleOpened,
              })}{" "}
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

        <section className="card receive-card" id="receive-line">
          <h2>Line</h2>
          <form onSubmit={onSave}>
            <div className="receive-line-row">
              <div className="receive-search">
                <label htmlFor="receive-sku">
                  <span>Search</span>
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
                      setScanRaw(null);
                      setSearchQuery(null);
                      setScanNote(null);
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
                          onClick={() => choose(match, null, settledQuery)}
                        >
                          <strong>{match.sku || match.name}</strong>
                          <span>{match.name}</span>
                          {match.description ? <span className="muted">{descriptionSnippet(match.description)}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <label className="receive-readout" htmlFor="receive-line-sku">
                <span>SKU</span>
                <input id="receive-line-sku" value={item?.sku ?? ""} readOnly tabIndex={-1} />
              </label>
              <div className="receive-readout receive-name">
                <span>Name</span>
                <div id="receive-line-name" className="receive-name-value" title={item?.name || undefined}>
                  {item?.name || "\u00a0"}
                </div>
                {item && item.description.trim() ? (
                  <p className="receive-name-desc" title={item.description}>
                    {item.description}
                  </p>
                ) : null}
              </div>
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
              <label className="receive-bin-field" htmlFor="receive-bin">
                <span>Bin</span>
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
                  onBlur={() => {
                    const raw = binTyped.current.trim();
                    if (!raw) return;
                    void lookupBin(raw, false);
                  }}
                  onValue={(value) => {
                    setBinCode(value);
                    const next = value.trim().toUpperCase();
                    if (!(binSource.current === "prefill" && next === prefilledBin.current)) {
                      binSource.current = next ? "user" : "empty";
                      if (!next) prefilledBin.current = "";
                      binEdit.current += 1;
                    }
                    if (confirmed && next !== confirmed.reference) setConfirmed(null);
                    setBinPrompt((current) => {
                      if (!current) return null;
                      if (current.kind === "create" && current.reference === next) return current;
                      if (current.kind === "required" && next === "") return current;
                      return null;
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void lookupBin(binTyped.current, false);
                    }
                  }}
                />
              </label>
              {prep === "cleaned" ? (
                <label className="receive-prep" htmlFor="receive-cleaned">
                  <span>Cleaned</span>
                  <div className="receive-prep-control">
                    <input
                      id="receive-cleaned"
                      type="checkbox"
                      checked={cleaned}
                      disabled={busy}
                      onChange={(event) => setCleaned(event.target.checked)}
                    />
                  </div>
                </label>
              ) : null}
              {prep === "wiped" ? (
                <label className="receive-prep" htmlFor="receive-wiped">
                  <span>Wiped</span>
                  <div className="receive-prep-control">
                    <input
                      id="receive-wiped"
                      type="checkbox"
                      checked={wiped}
                      disabled={busy}
                      onChange={(event) => setWiped(event.target.checked)}
                    />
                  </div>
                </label>
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
              <div className="receive-save">
                <button
                  id="receive-save"
                  className="so-icon-action"
                  type="submit"
                  disabled={busy || saving}
                  aria-label={saving ? "Saving" : "Save receipt"}
                  title={saving ? "Saving" : "Save receipt"}
                >
                  <Save size={18} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            </div>
            {suggestions.some((suggestion) => skuAlreadyInBinNote(suggestion.locationCode, suggestion.qty)) ? (
              <div className="receive-bin-notes">
                {suggestions.map((suggestion) => {
                  const note = skuAlreadyInBinNote(suggestion.locationCode, suggestion.qty);
                  if (!note) return null;
                  return (
                    <button
                      key={suggestion.cycleId}
                      type="button"
                      className="receive-bin-note"
                      disabled={busy}
                      onClick={() => {
                        binSource.current = "user";
                        prefilledBin.current = "";
                        binEdit.current += 1;
                        void lookupBin(suggestion.reference, false);
                      }}
                    >
                      {note}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {scanNote ? (
              <p className="hint" id="receive-scan-note">
                {scanNote}
              </p>
            ) : null}
            {truncated ? <span className="hint">Showing the first matches. Type more to narrow them.</span> : null}
            {binPrompt ? (
              <div className="receive-bin-ask" role="region" aria-label="Create bin">
                <p id="receive-bin-ask-title">
                  {binPrompt.kind === "create"
                    ? `No bin ${binPrompt.reference}. Create it?`
                    : `A bin is required. Create the next bin, ${suggestedCode}?`}
                </p>
                {binPrompt.kind === "required" ? (
                  <div className="label-segments receive-segments" role="group" aria-label="Bin type">
                    {BIN_TYPES.map((type) => (
                      <button
                        key={type.id}
                        type="button"
                        aria-pressed={binPrompt.type === type.id}
                        onClick={() =>
                          setBinPrompt((current) =>
                            current && current.kind === "required" ? { ...current, type: type.id } : current,
                          )
                        }
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="receive-actions">
                  <button type="button" disabled={busy} onClick={() => void confirmBinPrompt()}>
                    Create bin
                  </button>
                  <button type="button" className="secondary" disabled={busy} onClick={() => setBinPrompt(null)}>
                    Cancel
                  </button>
                </div>
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
            {error ? (
              <p className="banner error" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        </section>

        <section className="card receive-card" id="receive-recent">
          <h2>Recent entries</h2>
          <p className="hint">
            {project.trim()
              ? `Receipts for ${project.trim()}, newest first.`
              : "Receipts with no project, newest first."}{" "}
            Click a value to correct it. Initials stay with the person who received the line. Putaway is the bin from the receipt.
          </p>
          {entries.length === 0 ? (
            <p className="hint">
              {!projectReady || entriesLoading ? "Loading receipts…" : "No receipts for this project yet."}
            </p>
          ) : (
            <>
              <div className="receive-table-scroll">
                <table className="receive-table">
                  <thead>
                    <tr>
                      <th className="fit">Date</th>
                      <th className="fit">Init.</th>
                      <th className="fit">Project</th>
                      <th className="fit">Incoming bin</th>
                      <th className="origin">System</th>
                      <th className="num fit">System Qty</th>
                      <th className="search">Search</th>
                      <th className="fit">SKU</th>
                      <th className="item">Item name</th>
                      <th className="num fit">Item Qty</th>
                      <th className="putaway">Putaway</th>
                      <th className="note">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <ReceiptTableRow
                        key={entry.id}
                        entry={entry}
                        initials={editorInitials}
                        onSaved={() => setListStamp((current) => current + 1)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="receive-cards">
                {entries.map((entry) => (
                  <li key={`card-${entry.id}`} className="receive-card-row">
                    <ReceiptCard
                      entry={entry}
                      initials={editorInitials}
                      onSaved={() => setListStamp((current) => current + 1)}
                    />
                  </li>
                ))}
              </ul>
              <ReceiptPager
                page={entryPage}
                total={entryTotal}
                loading={entriesLoading}
                onPage={setEntryPage}
              />
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
