"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Save, TriangleAlert } from "lucide-react";
import { BinLabel, binLabelPrintCss } from "@/components/BinLabel";
import { FastInput } from "@/components/FastField";
import { barcodeValue, LABEL_PRINT_CSS } from "@/components/ItemLabel";
import { PrintedLabel } from "@/components/labelRenderers";
import { ReceiptCard, ReceiptTableRow } from "@/components/ReceiptInline";
import { ReceiptReports, type ReceiptListView } from "@/components/ReceiptReports";
import { ReceivingOriginField, ReceivingProjectField } from "@/components/ReceivingProjectField";
import { fetchBinCounter, reprintBin } from "@/lib/binActions";
import { BIN_TYPES, binTypeLabel, formatBinReference, type BinType } from "@/lib/bins";
import { binLabelAtPageMm, binLabelFrameClass, binLabelSheet, previewBinLabelSheet } from "@/lib/binLabelLayout";
import {
  readStoredVendor,
  receiveConsignment,
  receivingVendorStorageKey,
  writeStoredVendor,
} from "@/lib/consignedReceive";
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
  fetchReceivingBinNumber,
  lastPutawayBin,
  listReceivingEntries,
  listReceivingVendors,
  receiveIntoBin,
  receivingClerkInitials,
  searchReceivingPurchaseOrders,
  type ReceivingPurchaseOrder,
  type ReceivingVendor,
  recentReceivingOrigins,
  recentReceivingProjects,
  searchReceivingScan,
  suggestBins,
} from "@/lib/receivingActions";
import { distinctRecentOrigins } from "@/lib/receivingOrigins";
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
  systemQtyMultipleWarning,
  warehouseToday,
  type ReceiptSaveGate,
  type ReceivingEntry,
} from "@/lib/receivingSettings";
import { alreadyInBinNote, binBlurStartsLookup, binCanReceive, nextReceivingBinCode, receiptFlagsForPrep, receivePrepKind, receivingBinDecision, receivingBinDefault, receivingSkuOverride } from "@/lib/receivingLine";
import {
  parseReceivingBinCode,
  type BinDetail,
  type BinSuggestion,
  type CreatedBin,
  type ReceiptResult,
} from "@/lib/stockReceive";
import type { LabelItem } from "@/lib/types";
import {
  RECEIVE_UNIT_ROW_CAP,
  collectReceiveUnits,
  receiveUnitRows,
  resizeUnitRows,
  rowsToPaste,
  type UnitDraft,
} from "@/lib/stockUnits";

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
  | { kind: "required"; nextNumber: number; type: BinType; resumeSave: boolean }
  | {
      kind: "mismatch";
      number: number;
      selected: BinType;
      selectedReference: string;
      existing: BinType;
      existingReference: string;
      message: string;
      resumeSave: boolean;
    };

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
  const qtyField = useRef<HTMLInputElement>(null);
  const holdQuery = useRef<string | null>(null);
  const requestId = useRef(0);
  const binTyped = useRef("");
  const binSource = useRef<"empty" | "user" | "prefill">("empty");
  const prefilledBin = useRef("");
  const binEdit = useRef(0);
  const [identifier, setIdentifier] = useState("");
  const [skuDraft, setSkuDraft] = useState<string | null>(null);
  const skuLookup = useRef(0);
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
  const [recentOrigins, setRecentOrigins] = useState<string[]>([]);
  const [projectReady, setProjectReady] = useState(false);
  const [projectStorageKey, setProjectStorageKey] = useState<string | null>(null);
  const [receivedOn, setReceivedOn] = useState("");
  const [incomingTag, setIncomingTag] = useState("");
  const [origin, setOrigin] = useState("");
  const [originQty, setOriginQty] = useState("");
  const [vendors, setVendors] = useState<ReceivingVendor[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [poQuery, setPoQuery] = useState("");
  const [poHits, setPoHits] = useState<ReceivingPurchaseOrder[]>([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState<string | null>(null);
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [poVendorName, setPoVendorName] = useState("");
  const [entries, setEntries] = useState<ReceivingEntry[]>([]);
  const [entryPage, setEntryPage] = useState(1);
  const [entryTotal, setEntryTotal] = useState(0);
  const listedProject = useRef<string | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [listStamp, setListStamp] = useState(0);
  const [recentView, setRecentView] = useState<ReceiptListView>("detail");
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
  const [unitRows, setUnitRows] = useState<UnitDraft[]>([]);
  const [unitPaste, setUnitPaste] = useState("");
  const [pasteCoo, setPasteCoo] = useState("");
  const unitCooDefault = useRef("");
  const unitItemId = useRef("");
  const [comment, setComment] = useState("");
  const [suggestions, setSuggestions] = useState<BinSuggestion[]>([]);
  const [receipt, setReceipt] = useState<{
    result: ReceiptResult;
    item: LabelItem | null;
    search: string | null;
    qty: number;
    printedOn: string;
    qtyWarning: string | null;
  } | null>(null);
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
    void recentReceivingOrigins()
      .then((origins) => {
        if (!cancelled) setRecentOrigins(origins);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
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
    if (!projectStorageKey) return;
    let cancelled = false;
    void listReceivingVendors()
      .then((rows) => {
        if (cancelled) return;
        setVendors(rows);
        const stored = readStoredVendor(window.localStorage, receivingVendorStorageKey(projectStorageKey));
        if (stored && rows.some((row) => row.id === stored)) setVendorId(stored);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectStorageKey]);

  useEffect(() => {
    if (!projectReady || !projectStorageKey || purchaseOrderId) return;
    writeStoredVendor(window.localStorage, receivingVendorStorageKey(projectStorageKey), vendorId);
  }, [vendorId, purchaseOrderId, projectReady, projectStorageKey]);

  useEffect(() => {
    if (purchaseOrderId) return;
    const handle = window.setTimeout(() => {
      void searchReceivingPurchaseOrders(poQuery)
        .then(setPoHits)
        .catch(() => setPoHits([]));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [poQuery, purchaseOrderId]);

  const vendorOptions = useMemo(() => {
    if (!vendorId || vendors.some((row) => row.id === vendorId)) return vendors;
    return [...vendors, { id: vendorId, name: poVendorName || "Vendor on this purchase order" }];
  }, [vendors, vendorId, poVendorName]);

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

  useEffect(() => {
    const nextId = item?.id ?? "";
    const nextCoo = item?.coo ?? "";
    const parsed = receiveLineQty(qty);
    const rowCount = parsed.ok ? receiveUnitRows(parsed.qty) : 0;
    const previousCoo = unitCooDefault.current;
    if (unitItemId.current !== nextId) {
      setPasteCoo((current) => (current === previousCoo ? nextCoo : current));
      unitItemId.current = nextId;
      unitCooDefault.current = nextCoo;
    }
    setUnitRows((current) => resizeUnitRows(current, rowCount, nextCoo, previousCoo));
  }, [item, qty]);

  function adoptSku(next: LabelItem, focusQty: boolean) {
    skuLookup.current += 1;
    setItem(next);
    setSkuDraft(null);
    setCleaned(false);
    setWiped(false);
    setError(null);
    if (focusQty) queueMicrotask(() => qtyField.current?.focus());
  }

  function choose(next: LabelItem, rawScan: string | null = null, typedQuery: string | null = null) {
    skuLookup.current += 1;
    const search = searchFieldAfterPick(typed.current, next);
    holdQuery.current = search.trim();
    setSkuDraft(null);
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
    queueMicrotask(() => qtyField.current?.focus());
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

  useEffect(() => {
    if (skuDraft == null) return;
    const text = skuDraft.trim();
    if (receivingSkuOverride({ typedSku: text, currentSku: item?.sku ?? "", exactSku: null }) !== "pending") return;
    const id = ++skuLookup.current;
    const handle = window.setTimeout(() => {
      void searchReceivingScan(text)
        .then((result) => {
          if (id !== skuLookup.current || !result.exact) return;
          if (receivingSkuOverride({ typedSku: text, currentSku: item?.sku ?? "", exactSku: result.exact.sku }) !== "apply") return;
          adoptSku(result.exact, true);
        })
        .catch((cause: unknown) => {
          if (id === skuLookup.current) setError(errorText(cause));
        });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [skuDraft, item?.sku]);

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
      let owner: { reference: string; type: BinType } | null = null;
      if (parsed && !detail) {
        const looked = await fetchReceivingBinNumber(parsed.number);
        if (!looked.ok) {
          setConfirmed(null);
          setBinPrompt(null);
          setError(looked.message);
          return null;
        }
        owner = looked.owner;
      }
      const outcome = receivingBinDecision(
        raw,
        detail ? { reference: detail.reference, canReceive: binCanReceive(detail) } : null,
        owner,
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
      if (outcome.action === "mismatch") {
        setConfirmed(null);
        setBinPrompt({
          kind: "mismatch",
          number: outcome.number,
          selected: outcome.selected,
          selectedReference: outcome.selectedReference,
          existing: outcome.existing,
          existingReference: outcome.existingReference,
          message: outcome.message,
          resumeSave,
        });
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
    if (!prompt || prompt.kind === "mismatch") return;
    const type = prompt.type;
    const code = prompt.kind === "create" ? prompt.reference : formatBinReference(prompt.nextNumber, type);
    setBusy(true);
    setError(null);
    try {
      const createdResult = await createReceivingBin(type, code);
      if (!createdResult.ok) {
        setBinPrompt(null);
        setError(createdResult.message);
        return;
      }
      const bin = createdResult.bin;
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
      if (prompt.resumeSave) await continueReceipt(bin.reference);
    } catch (createError) {
      setError(errorText(createError));
    } finally {
      setBusy(false);
    }
  }

  async function useExistingBin(reference: string, resumeSave: boolean) {
    binTyped.current = reference;
    binSource.current = "user";
    prefilledBin.current = "";
    binEdit.current += 1;
    setBinCode(reference);
    setBinHeld((current) => current + 1);
    setBinPrompt(null);
    setError(null);
    const accepted = await lookupBin(reference, false);
    if (accepted && resumeSave) await continueReceipt(accepted);
  }

  async function continueReceipt(reference: string) {
    const claim = beginReceiptSave(saveGate.current, crypto.randomUUID());
    if (!claim.ok) return;
    saveGate.current = claim.gate;
    const chosen = await resolveLineItem();
    if (!chosen.ok) {
      releaseSave(false);
      return;
    }
    await commitReceipt(reference, claim.requestId, chosen.item, chosen.search);
  }

  function releaseSave(saved: boolean) {
    saveGate.current = finishReceiptSave(saveGate.current, saved);
    setSaving(false);
  }

  async function resolveLineItem(): Promise<{ ok: true; item: LabelItem | null; search: string | null } | { ok: false }> {
    const current = item;
    const draft = skuDraft;
    const typedSku = (draft ?? "").trim();
    const search = receiptSearchQuery(searchQuery ?? (typed.current || identifier));
    const decision = receivingSkuOverride({
      typedSku: draft == null ? (current?.sku ?? "") : typedSku,
      currentSku: current?.sku ?? "",
      exactSku: null,
    });
    if (draft == null || decision === "same") {
      if (!current) {
        if (!search) {
          setError("Enter a search.");
          return { ok: false };
        }
        setSkuDraft(null);
        return { ok: true, item: null, search };
      }
      setSkuDraft(null);
      return { ok: true, item: current, search };
    }
    const id = ++skuLookup.current;
    try {
      const result = await searchReceivingScan(typedSku);
      if (id !== skuLookup.current) return { ok: false };
      if (
        result.exact &&
        receivingSkuOverride({ typedSku, currentSku: current?.sku ?? "", exactSku: result.exact.sku }) === "apply"
      ) {
        adoptSku(result.exact, false);
        return { ok: true, item: result.exact, search };
      }
      setError(`No item with SKU ${typedSku}.`);
      return { ok: false };
    } catch (cause) {
      if (id === skuLookup.current) setError(errorText(cause));
      return { ok: false };
    }
  }

  async function commitSkuDraft() {
    const draft = skuDraft;
    if (draft == null) return;
    const text = draft.trim();
    const currentSku = item?.sku ?? "";
    if (receivingSkuOverride({ typedSku: text, currentSku, exactSku: null }) !== "pending") {
      setSkuDraft(null);
      return;
    }
    const id = ++skuLookup.current;
    try {
      const result = await searchReceivingScan(text);
      if (id !== skuLookup.current) return;
      if (
        result.exact &&
        receivingSkuOverride({ typedSku: text, currentSku, exactSku: result.exact.sku }) === "apply"
      ) {
        adoptSku(result.exact, true);
        return;
      }
      setError(`No item with SKU ${text}.`);
      setSkuDraft(null);
    } catch (cause) {
      if (id === skuLookup.current) setError(errorText(cause));
    }
  }

  async function commitReceipt(reference: string, requestId: string, lineItem: LabelItem | null, search: string | null) {
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
    if (!lineItem && !search) {
      releaseSave(false);
      setError("Enter a search.");
      return;
    }
    const owner = receiveConsignment({ purchaseOrderId, vendorId });
    if (!owner.ok) {
      releaseSave(false);
      setError(owner.message);
      return;
    }
    const units = collectReceiveUnits({
      qty: parsed.qty,
      sku: lineItem?.sku ?? "",
      hasItem: Boolean(lineItem),
      rows: unitRows,
      paste: unitPaste,
      pasteCoo,
    });
    if (!units.ok) {
      releaseSave(false);
      setError(units.message);
      return;
    }
    const qtyWarning = systemQtyMultipleWarning(parsed.qty, originParsed.qty);
    const flags = lineItem
      ? receiptFlagsForPrep(
          receivePrepKind({ shortCode: lineItem.shortCode, longCode: lineItem.longCode, taxonomyName: lineItem.taxonomyName }),
          cleaned,
          wiped,
        )
      : { cleaned: null, wiped: null };
    setSaving(true);
    setError(null);
    try {
      const result = await receiveIntoBin({
        reference,
        itemId: lineItem?.id ?? null,
        qty: parsed.qty,
        comment,
        project,
        origin,
        incomingTag,
        receivedOn,
        originQty: originParsed.qty,
        clientRequestId: requestId,
        scanRaw,
        searchQuery: search,
        cleaned: flags.cleaned,
        wiped: flags.wiped,
        units: units.units,
        vendorId: owner.vendorId,
        purchaseOrderId: owner.purchaseOrderId,
      });
      const printedOn = todayLabel(new Date());
      setReceipt({ result, item: lineItem, search, qty: parsed.qty, printedOn, qtyWarning });
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
      setSkuDraft(null);
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
      setUnitRows([]);
      setUnitPaste("");
      setPasteCoo("");
      unitCooDefault.current = "";
      unitItemId.current = "";
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
      if (origin.trim()) {
        setRecentOrigins((current) =>
          distinctRecentOrigins([{ origin_description: origin }, ...current.map((name) => ({ origin_description: name }))]),
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
      void recentReceivingOrigins()
        .then((origins) => {
          setRecentOrigins((current) =>
            distinctRecentOrigins([
              ...current.map((name) => ({ origin_description: name })),
              ...origins.map((name) => ({ origin_description: name })),
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
    const chosen = await resolveLineItem();
    if (!chosen.ok) {
      releaseSave(false);
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
    await commitReceipt(reference, claim.requestId, chosen.item, chosen.search);
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
    if (!receipt?.item) return;
    setPrintJob({
      kind: "item",
      item: receipt.item,
      qty: receipt.qty,
      printedOn: receipt.printedOn,
    });
    setPrintStamp((current) => current + 1);
  }

  const lineQty = receiveLineQty(qty);
  const lineOriginQty = originQtyInput(originQty);
  const qtyMultipleWarning =
    lineQty.ok && lineOriginQty.ok ? systemQtyMultipleWarning(lineQty.qty, lineOriginQty.qty) : null;
  const listOpen = matches.length > 0;
  const prep = receivePrepKind({
    shortCode: item?.shortCode,
    longCode: item?.longCode,
    taxonomyName: item?.taxonomyName,
  });
  const suggestedCode =
    binPrompt?.kind === "required" ? formatBinReference(binPrompt.nextNumber, binPrompt.type) : null;
  const binNote = item ? alreadyInBinNote({ currentBin: binCode, rows: suggestions }) : null;

  const printingItem = printJob?.kind === "item";
  const shownBinType = printingItem
    ? null
    : printJob?.kind === "bin"
      ? printJob.type
      : created && !receipt
        ? created.type
        : null;
  const labelSheet = previewBinLabelSheet(shownBinType, printingItem);
  const labelPage = binLabelAtPageMm(labelSheet);

  function choosePurchaseOrder(hit: ReceivingPurchaseOrder) {
    setPurchaseOrderId(hit.id);
    setPurchaseOrderNumber(hit.number);
    setPoQuery(hit.number);
    setPoVendorName(hit.vendorName);
    setVendorId(hit.vendorId);
    setPoHits([]);
  }

  function clearPurchaseOrder() {
    setPurchaseOrderId(null);
    setPurchaseOrderNumber("");
    setPoQuery("");
    setPoVendorName("");
  }

  return (
    <main className="page receiving-page desk-fields ds">
      <style key={`${labelPage.widthMm}x${labelPage.heightMm}`}>{`${LABEL_PRINT_CSS}\n${binLabelPrintCss(labelSheet)}`}</style>
      <div className="no-print">
        <p className="page-note">The header is the receipt. The line is one quantity into one bin. Leave the SKU empty to save the search and link an item later.</p>
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
            <ReceivingOriginField value={origin} origins={recentOrigins} disabled={busy} onChange={setOrigin} />
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
          <div className="receive-owner-grid">
            <div className="receive-po">
              <label htmlFor="receive-po">
                <span>Purchase order</span>
                <input
                  id="receive-po"
                  value={poQuery}
                  autoComplete="off"
                  placeholder="Optional"
                  disabled={busy}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPoQuery(value);
                    if (value.trim() !== purchaseOrderNumber) {
                      setPurchaseOrderId(null);
                      setPurchaseOrderNumber("");
                      setPoVendorName("");
                    }
                  }}
                />
              </label>
              {purchaseOrderId ? (
                <button type="button" className="receive-po-clear" onClick={clearPurchaseOrder} disabled={busy}>
                  Clear PO
                </button>
              ) : poQuery.trim() && poHits.length > 0 ? (
                <ul className="receive-po-hits">
                  {poHits.map((hit) => (
                    <li key={hit.id}>
                      <button type="button" onClick={() => choosePurchaseOrder(hit)} disabled={busy}>
                        {hit.number}
                        {hit.vendorName ? ` · ${hit.vendorName}` : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <label htmlFor="receive-vendor">
              <span>Vendor</span>
              <select
                id="receive-vendor"
                value={vendorId}
                required={!purchaseOrderId}
                disabled={busy || Boolean(purchaseOrderId)}
                onChange={(event) => setVendorId(event.target.value)}
              >
                <option value="">Choose a vendor</option>
                {vendorOptions.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="receive-owner-note">
              {purchaseOrderId
                ? `Vendor comes from PO ${purchaseOrderNumber}.`
                : "Consigned. This receipt stays with that vendor."}
            </p>
          </div>
          <p className="hint">
            A bin that already has stock keeps the cycle it opened with. Each saved line stores this header, including the receiving date.
            A receipt with no purchase order is consigned and requires a vendor.
          </p>
        </section>

        {receipt ? (
          <section className="receive-saved" id="receive-saved" aria-label="Saved receipt">
            <p className="banner ok" role="status">
              {receiptSavedNote({
                qty: receipt.qty,
                sku: receipt.item?.sku ?? "",
                name: receipt.item?.name,
                reference: receipt.result.reference,
                cycleOpened: receipt.result.cycleOpened,
                pending: !receipt.item || receipt.result.pending,
                search: receipt.search,
              })}{" "}
              <Link href={`/warehouse/bins/${receipt.result.reference}`}>Open this bin</Link>
            </p>
            {receipt.qtyWarning ? (
              <p className="banner warn" id="receive-saved-qty-warn" role="status" title={receipt.qtyWarning}>
                <TriangleAlert size={18} strokeWidth={1.75} aria-hidden />
                <span>{receipt.qtyWarning}</span>
              </p>
            ) : null}
            <div className="receive-actions">
              <button
                type="button"
                onClick={() => void printBinLabel(receipt.result.reference, receipt.result.type)}
              >
                Print bin label
              </button>
              {receipt.item ? (
                <button type="button" onClick={printItemLabel}>
                  Print item label
                </button>
              ) : null}
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
                      skuLookup.current += 1;
                      setEdited(true);
                      setIdentifier(value);
                      setSkuDraft(null);
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
              <label className="receive-readout receive-sku" htmlFor="receive-line-sku">
                <span>SKU</span>
                <input
                  id="receive-line-sku"
                  value={skuDraft ?? item?.sku ?? ""}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={busy}
                  onChange={(event) => setSkuDraft(event.target.value)}
                  onBlur={() => {
                    void commitSkuDraft();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || skuDraft == null) return;
                    event.preventDefault();
                    void commitSkuDraft();
                  }}
                />
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
                <span>
                  {qtyMultipleWarning ? (
                    <span title={qtyMultipleWarning}>
                      <TriangleAlert className="receive-qty-warn-icon" size={15} strokeWidth={1.75} aria-hidden />
                    </span>
                  ) : null}
                  Qty
                </span>
                <input
                  id="receive-qty"
                  ref={qtyField}
                  className="num-input"
                  value={qty}
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={busy}
                  aria-describedby={qtyMultipleWarning ? "receive-qty-warn" : undefined}
                  onChange={(event) => {
                    const value = event.target.value;
                    const parsed = receiveLineQty(value);
                    const previous = receiveLineQty(qty);
                    if (
                      previous.ok &&
                      receiveUnitRows(previous.qty) > 0 &&
                      parsed.ok &&
                      parsed.qty > RECEIVE_UNIT_ROW_CAP &&
                      !unitPaste.trim()
                    ) {
                      const pasted = rowsToPaste(unitRows);
                      if (pasted) setUnitPaste(pasted);
                    }
                    setQty(value);
                  }}
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
                  onBlur={(event) => {
                    if (!binBlurStartsLookup(event.relatedTarget)) return;
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
                      if (current.kind === "mismatch" && current.selectedReference === next) return current;
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
              {item && prep === "cleaned" ? (
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
              {item && prep === "wiped" ? (
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
                  onMouseDown={(event) => event.preventDefault()}
                >
                  <Save size={18} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            </div>
            {lineQty.ok ? (
              <div className="receive-units">
                <p className="hint">
                  Serials and country of origin are optional. Leave them blank to receive quantity only.
                  {item?.coo ? ` COO prefills from the item (${item.coo}).` : " COO is a 2- or 3-letter country code."}
                </p>
                {lineQty.qty > RECEIVE_UNIT_ROW_CAP ? (
                  <div className="receive-unit-paste">
                    <label htmlFor="receive-serials">
                      <span>Serials, one per line</span>
                      <textarea
                        id="receive-serials"
                        rows={4}
                        value={unitPaste}
                        disabled={busy}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={"SN-1\nSN-2, CHN"}
                        onChange={(event) => setUnitPaste(event.target.value)}
                      />
                    </label>
                    <label htmlFor="receive-paste-coo">
                      <span>COO</span>
                      <input
                        id="receive-paste-coo"
                        value={pasteCoo}
                        disabled={busy}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="USA"
                        onChange={(event) => setPasteCoo(event.target.value.toUpperCase())}
                      />
                    </label>
                  </div>
                ) : (
                  <table className="receive-serials">
                    <thead>
                      <tr>
                        <th className="num">#</th>
                        <th>Serial</th>
                        <th>COO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unitRows.map((row, index) => (
                        <tr key={index}>
                          <td className="num">{index + 1}</td>
                          <td>
                            <input
                              id={`receive-serial-${index}`}
                              aria-label={`Serial ${index + 1}`}
                              value={row.serial}
                              disabled={busy}
                              autoComplete="off"
                              spellCheck={false}
                              onChange={(event) => {
                                const value = event.target.value;
                                setUnitRows((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, serial: value } : entry,
                                  ),
                                );
                              }}
                            />
                          </td>
                          <td className="receive-coo">
                            <input
                              id={`receive-coo-${index}`}
                              aria-label={`COO ${index + 1}`}
                              value={row.coo}
                              disabled={busy}
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="USA"
                              onChange={(event) => {
                                const value = event.target.value.toUpperCase();
                                setUnitRows((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, coo: value } : entry,
                                  ),
                                );
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : null}
            {qtyMultipleWarning ? (
              <p className="banner warn" id="receive-qty-warn" role="status" title={qtyMultipleWarning}>
                <TriangleAlert size={18} strokeWidth={1.75} aria-hidden />
                <span>{qtyMultipleWarning}</span>
              </p>
            ) : null}
            {binNote ? (
              <p className="receive-bin-notes" id="receive-bin-note">
                {binNote.current ? <span>{binNote.current}</span> : null}
                {binNote.othersLead ? (
                  <>
                    {binNote.current ? " " : null}
                    <span>{binNote.othersLead} </span>
                    {binNote.others.map((bin, index) => (
                      <span key={bin.reference}>
                        {index > 0 ? ", " : null}
                        <button
                          type="button"
                          className="receive-bin-note"
                          disabled={busy}
                          onClick={() => {
                            binSource.current = "user";
                            prefilledBin.current = "";
                            binEdit.current += 1;
                            void lookupBin(bin.reference, false);
                          }}
                        >
                          {bin.reference} (x{bin.qty})
                        </button>
                      </span>
                    ))}
                    .
                  </>
                ) : null}
              </p>
            ) : null}
            {scanNote ? (
              <p className="hint" id="receive-scan-note">
                {scanNote}
              </p>
            ) : null}
            {truncated ? <span className="hint">Showing the first matches. Type more to narrow them.</span> : null}
            {binPrompt ? (
              <div
                className="receive-bin-ask"
                role="region"
                aria-label={binPrompt.kind === "mismatch" ? "Bin type" : "Create bin"}
              >
                <p id="receive-bin-ask-title">
                  {binPrompt.kind === "create"
                    ? `No bin ${binPrompt.reference}. Create it?`
                    : binPrompt.kind === "mismatch"
                      ? binPrompt.message
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
                  {binPrompt.kind === "mismatch" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void useExistingBin(binPrompt.existingReference, binPrompt.resumeSave)}
                    >
                      {`Use ${binTypeLabel(binPrompt.existing)} ${binPrompt.existingReference}`}
                    </button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => void confirmBinPrompt()}>
                      Create bin
                    </button>
                  )}
                  <button type="button" className="secondary" disabled={busy} onClick={() => setBinPrompt(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {created && !receipt ? (
              <div className="label-preview">
                <div className={binLabelFrameClass(created.type)}>
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
          <ReceiptReports
            project={project}
            ready={projectReady}
            stamp={listStamp}
            view={recentView}
            onView={setRecentView}
          />
          {recentView === "detail" ? (
          <>
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
                      <th className="fit">Vendor</th>
                      <th className="fit">Basis</th>
                      <th className="fit">Incoming bin</th>
                      <th className="origin">System</th>
                      <th className="num fit">System Qty</th>
                      <th className="search">Search</th>
                      <th className="fit sku">SKU</th>
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
                  <li key={`card-${entry.id}`} className={entry.itemId ? "receive-card-row" : "receive-card-row receipt-unmatched"}>
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
          </>
          ) : null}
        </section>
      </div>
      <div className="print-sheet">
        {printJob?.kind === "bin" ? (
          <BinLabel
            reference={printJob.reference}
            type={printJob.type}
            layout={templates[printJob.type]}
            sheet={binLabelSheet([printJob.type])}
          />
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
