"use client";

import Link from "next/link";
import { FormEvent, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { BinLabel, binLabelPrintCss } from "@/components/BinLabel";
import { barcodeValue, LABEL_PRINT_CSS } from "@/components/ItemLabel";
import { PrintedLabel } from "@/components/labelRenderers";
import { fetchBin, reprintBin } from "@/lib/binActions";
import {
  itemMoveSummary,
  itemMoveTargetBin,
  itemMoveTargetError,
  linesForSelection,
  type BinMoveLine,
} from "@/lib/binItemMove";
import { readBinSectionOpen, writeBinSectionOpen, type BinSection } from "@/lib/binSectionOpen";
import { binTypeLabel, type BinRecord } from "@/lib/bins";
import { binLabelAtPageMm, binLabelFrameClass, binLabelHitClass, previewBinLabelSheet } from "@/lib/binLabelLayout";
import { errorText } from "@/lib/errors";
import { fetchBinLabelTemplates, fetchLabelTemplate } from "@/lib/labelActions";
import { emptyBinLabelTemplates, qrLabelPayload, type BinLabelTemplates, type LabelTemplateId } from "@/lib/labelTemplates";
import { moveBinItems } from "@/lib/moveActions";
import { fetchBinDetail, moveBinToLocation } from "@/lib/receivingActions";
import { formatReceivedOn, receiptInitials } from "@/lib/receivingSettings";
import { binReceipts, cycleEventParts, type BinContentRow, type BinDetail, type BinReceipt, type StockEventRow } from "@/lib/stockReceive";

function missingMigration(message: string): boolean {
  return /schema cache|does not exist|Could not find the function/i.test(message);
}

function when(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString();
}

function CycleEvent({ event }: { event: StockEventRow }) {
  const parts = cycleEventParts(event);
  return (
    <li className="cycle-event">
      <span className="cycle-event-verb">{parts.verb}</span>
      <span className="cycle-event-qty">{parts.qty}</span>
      <span className="cycle-event-detail">{parts.detail}</span>
      <span className="cycle-event-meta">
        {event.operatorInitials} · {when(event.occurredAt)}
      </span>
    </li>
  );
}

function receiptDate(receipt: BinReceipt): string {
  const day = receipt.receivedOn || receipt.occurredAt;
  return day ? formatReceivedOn(day) : "—";
}

function ReceiptCard({ receipt }: { receipt: BinReceipt }) {
  const title = [receipt.sku, receipt.itemName].filter(Boolean).join(" · ") || "Receipt";
  return (
    <article className="cycle-card">
      <h3>
        {title}
        {receipt.qty == null ? "" : ` · ${receipt.qty}`}
      </h3>
      <dl className="cycle-facts">
        <div>
          <dt>Date</dt>
          <dd>{receiptDate(receipt)}</dd>
        </div>
        <div>
          <dt>Initials</dt>
          <dd>{receiptInitials(receipt.initials) || "—"}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{receipt.project ?? "—"}</dd>
        </div>
        <div>
          <dt>Originating system</dt>
          <dd>{receipt.originatingSystem ?? "—"}</dd>
        </div>
        <div>
          <dt>Incoming bin</dt>
          <dd>{receipt.incomingBin ?? "—"}</dd>
        </div>
        {receipt.originQty == null ? null : (
          <div>
            <dt>Originating system qty</dt>
            <dd>{receipt.originQty}</dd>
          </div>
        )}
        {receipt.comment ? (
          <div>
            <dt>Comment</dt>
            <dd>{receipt.comment}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function todayLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function BinSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="bin-section" aria-labelledby={id}>
      <h2 id={id}>
        <button
          type="button"
          className="bin-section-toggle"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          title={open ? `Collapse ${title}` : `Expand ${title}`}
          onClick={onToggle}
        >
          <ChevronRight
            size={18}
            strokeWidth={2}
            aria-hidden
            className={open ? "bin-section-chevron is-open" : "bin-section-chevron"}
          />
          <span>{title}</span>
        </button>
      </h2>
      <div id={`${id}-panel`} className="bin-section-panel" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

function LocationValue({
  location,
  busy,
  fromLabel,
  lines,
  onMove,
}: {
  location: string | null;
  busy: boolean;
  fromLabel: string;
  lines: BinMoveLine[];
  onMove: (code: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const movingItems = lines.length > 0;
  const targetError = movingItems && draft.trim() ? itemMoveTargetError(draft) : null;
  const summary =
    movingItems && draft.trim() && !targetError ? itemMoveSummary(fromLabel, itemMoveTargetBin(draft), lines) : null;

  function start() {
    setDraft(movingItems ? "" : (location ?? ""));
    setEditing(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const done = await onMove(draft);
      if (done) setEditing(false);
    } catch {
      // The page banner shows the move error. Leave the location open to edit.
    }
  }

  if (!editing) {
    return (
      <button type="button" className="bin-location" disabled={busy} onClick={start}>
        {location ?? "No location yet"}
      </button>
    );
  }

  return (
    <form className="bin-location-edit" onSubmit={(event) => void submit(event)}>
      <input
        aria-label={movingItems ? "Move selected items to bin" : "Move to location"}
        value={draft}
        autoFocus
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        disabled={busy}
        placeholder={movingItems ? "10001-B" : "HWS.00.00.00"}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
          }
        }}
      />
      <button type="submit" disabled={busy || (movingItems && !summary)}>
        {movingItems ? `Move ${lines.length}` : "Move"}
      </button>
      <span className="hint">
        {movingItems
          ? "Scan the bin that receives the selected items. Each line moves its full quantity."
          : "Scan a location code. It must match one location type."}
      </span>
      {targetError ? <p className="banner error">{targetError}</p> : null}
      {summary ? <p className="move-summary">{summary}</p> : null}
    </form>
  );
}

export function BinView({ reference }: { reference: string }) {
  const [detail, setDetail] = useState<BinDetail | null>(null);
  const [basic, setBasic] = useState<BinRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<BinLabelTemplates>(emptyBinLabelTemplates);
  const [itemTemplate, setItemTemplate] = useState<LabelTemplateId>("barcode");
  const [pageOrigin, setPageOrigin] = useState("");
  const [printedOn, setPrintedOn] = useState("");
  const [printJob, setPrintJob] = useState<{ kind: "bin" } | { kind: "item"; row: BinContentRow } | null>(null);
  const [printStamp, setPrintStamp] = useState(0);
  const [itemsOpen, setItemsOpen] = useState(true);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const moving = useRef(false);

  useLayoutEffect(() => {
    const storage = window.localStorage;
    setItemsOpen(readBinSectionOpen(storage, "items"));
    setReceiptsOpen(readBinSectionOpen(storage, "receipts"));
    setHistoryOpen(readBinSectionOpen(storage, "history"));
  }, []);

  function toggleSection(section: BinSection, setOpen: (value: boolean | ((current: boolean) => boolean)) => void) {
    setOpen((current) => {
      const next = !current;
      writeBinSectionOpen(window.localStorage, section, next);
      return next;
    });
  }

  async function load() {
    const loaded = await fetchBinDetail(reference);
    if (!loaded) {
      setMissing(true);
      setDetail(null);
      return;
    }
    setDetail(loaded);
    setMissing(false);
  }

  useEffect(() => {
    setSelected(new Set());
    setNotice(null);
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch (error) {
        if (cancelled) return;
        const text = errorText(error);
        if (missingMigration(text)) {
          try {
            const row = await fetchBin(reference);
            if (cancelled) return;
            if (!row) setMissing(true);
            else setBasic(row);
          } catch (fallback) {
            if (!cancelled) setMessage(errorText(fallback));
          }
          return;
        }
        setMessage(text);
      }
    })();
    setPageOrigin(window.location.origin);
    setPrintedOn(todayLabel(new Date()));
    void fetchBinLabelTemplates()
      .then((loaded) => {
        if (!cancelled) setTemplates(loaded);
      })
      .catch(() => undefined);
    void fetchLabelTemplate()
      .then((loaded) => {
        if (!cancelled) setItemTemplate(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reference]);

  useEffect(() => {
    if (printStamp === 0) return;
    window.print();
  }, [printStamp]);

  async function onMove(code: string): Promise<boolean> {
    if (moving.current) return false;
    const lines = detail ? linesForSelection(detail.contents, selected) : [];
    moving.current = true;
    setBusy(true);
    setMessage(null);
    setNotice(null);
    try {
      if (lines.length > 0) {
        const problem = itemMoveTargetError(code);
        if (problem) throw new Error(problem);
        const result = await moveBinItems({
          fromBin: reference,
          toBin: itemMoveTargetBin(code),
          itemIds: lines.map((line) => line.itemId),
          requestId: crypto.randomUUID(),
        });
        setSelected(new Set());
        setNotice(result.summary);
        try {
          await load();
        } catch (error) {
          setMessage(errorText(error));
        }
        return true;
      }
      await moveBinToLocation(reference, code);
      await load();
      return true;
    } catch (error) {
      setMessage(errorText(error));
      throw error;
    } finally {
      moving.current = false;
      setBusy(false);
    }
  }

  async function printBinLabel() {
    if (!detail || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const printed = await reprintBin(detail.reference, 1);
      setDetail((current) => (current ? { ...current, printedCount: printed.printedCount } : current));
      setPrintJob({ kind: "bin" });
      setPrintStamp((current) => current + 1);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function printItemLabel(row: BinContentRow) {
    setPrintJob({ kind: "item", row });
    setPrintStamp((current) => current + 1);
  }

  const typeName = detail ? binTypeLabel(detail.type) : basic ? binTypeLabel(basic.type) : "";
  const printingItem = printJob?.kind === "item";
  const labelSheet = previewBinLabelSheet(detail?.type, printingItem);
  const labelPage = binLabelAtPageMm(labelSheet);
  const selectedLines = detail ? linesForSelection(detail.contents, selected) : [];
  const allSelected = selectedLines.length > 0 && detail != null && selectedLines.length === detail.contents.length;
  const receipts = detail ? binReceipts(detail.cycles) : [];
  const moves = detail
    ? [
        ...detail.cycles.flatMap((cycle) => cycle.events.filter((event) => event.eventType !== "receive_into_bin" && event.eventType !== "receipt_adjustment")),
        ...detail.looseEvents.filter((event) => event.eventType !== "receive_into_bin"),
      ]
    : [];

  return (
    <main className="page bin-view desk-fields">
      <style key={`${labelPage.widthMm}x${labelPage.heightMm}`}>{`${LABEL_PRINT_CSS}\n${binLabelPrintCss(labelSheet)}`}</style>
      <div className="no-print">
        <div className="bin-head">
          <div className="bin-head-copy">
            <p className="bin-reference">{reference}</p>
            <p className="hint">{typeName ? `${typeName} bin` : "Bin"}</p>
            {notice ? (
              <p className="banner ok" role="status">
                {notice}
              </p>
            ) : null}
            {message ? (
              <p className="banner error" role="alert">
                {message}
              </p>
            ) : null}
            {missing ? <p className="banner error">No bin is numbered {reference}.</p> : null}
            {basic && !detail ? (
              <dl className="bin-stats">
                <div>
                  <dt>Number</dt>
                  <dd>{basic.number}</dd>
                </div>
                <div>
                  <dt>Printed</dt>
                  <dd>{basic.printedCount}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{when(basic.createdAt)}</dd>
                </div>
              </dl>
            ) : null}
            {detail ? (
              <dl className="bin-stats">
                <div>
                  <dt>Current location</dt>
                  <dd>
                    <LocationValue
                      key={reference}
                      location={detail.locationCode}
                      busy={busy}
                      fromLabel={typeName ? `${typeName} ${detail.reference}` : detail.reference}
                      lines={selectedLines}
                      onMove={onMove}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Printed</dt>
                  <dd>{detail.printedCount}</dd>
                </div>
                <div>
                  <dt>Created by</dt>
                  <dd>{detail.createdByInitials ?? "—"}</dd>
                </div>
              </dl>
            ) : null}
          </div>
          {detail ? (
            <div className="bin-head-label">
              <button
                type="button"
                className={binLabelHitClass(detail.type)}
                aria-label={`Print bin label ${detail.reference}`}
                title={`Print bin label ${detail.reference}`}
                disabled={busy}
                onClick={() => void printBinLabel()}
              >
                <span className={binLabelFrameClass(detail.type)}>
                  <BinLabel reference={detail.reference} type={detail.type} layout={templates[detail.type]} />
                </span>
              </button>
              <p className="hint">Click the label to print it.</p>
            </div>
          ) : null}
        </div>
        {detail ? (
          <>
            <BinSection
              id="bin-items"
              title="Items summary"
              open={itemsOpen}
              onToggle={() => toggleSection("items", setItemsOpen)}
            >
              {detail.contents.length === 0 ? (
                <p className="hint">Empty. The next receipt opens a new cycle.</p>
              ) : (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th className="select">
                          <label className="bin-row-select">
                            <input
                              type="checkbox"
                              aria-label="Select all items"
                              checked={allSelected}
                              disabled={busy}
                              ref={(node) => {
                                if (node) node.indeterminate = selectedLines.length > 0 && !allSelected;
                              }}
                              onChange={() => {
                                setSelected(
                                  allSelected ? new Set() : new Set(detail.contents.map((row) => row.itemId)),
                                );
                              }}
                            />
                          </label>
                        </th>
                        <th>SKU</th>
                        <th>Name</th>
                        <th className="num">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.contents.map((row) => {
                        const label = row.sku || row.name || "item";
                        return (
                          <tr key={row.itemId}>
                            <td className="select">
                              <label className="bin-row-select">
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${label}`}
                                  checked={selected.has(row.itemId)}
                                  disabled={busy}
                                  onChange={() => {
                                    setSelected((current) => {
                                      const next = new Set(current);
                                      if (next.has(row.itemId)) next.delete(row.itemId);
                                      else next.add(row.itemId);
                                      return next;
                                    });
                                  }}
                                />
                              </label>
                            </td>
                            <td>{row.sku}</td>
                            <td>{row.name}</td>
                            <td className="num">{row.qty}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="hint">
                    {selectedLines.length > 0
                      ? `${selectedLines.length} selected. Click the location and scan the bin that should receive them.`
                      : "Select items, then click the location to move them into a bin. Leave them unselected to move this bin."}
                  </p>
                  <p className="hint">Click a label to print it.</p>
                  <div className="bin-label-row">
                    {detail.contents.map((row) => (
                      <button
                        key={row.itemId}
                        type="button"
                        className="bin-label-hit"
                        aria-label={`Print item label for ${row.sku || row.name}`}
                        title={`Print item label for ${row.sku || row.name}`}
                        onClick={() => printItemLabel(row)}
                      >
                        <span className="label-frame">
                          <PrintedLabel
                            template={itemTemplate}
                            name={row.name}
                            description={row.description.trim() || row.name}
                            code={
                              itemTemplate === "qr" && pageOrigin
                                ? qrLabelPayload(pageOrigin, row.itemId, row.sku)
                                : barcodeValue(row.sku, row.itemId)
                            }
                            sku={row.sku}
                            itemId={row.itemId}
                            origin={pageOrigin}
                            quantity={String(row.qty)}
                            shortCode={row.shortCode}
                            printedOn={printedOn}
                          />
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </BinSection>
            <BinSection
              id="bin-receipts"
              title="Receipts"
              open={receiptsOpen}
              onToggle={() => toggleSection("receipts", setReceiptsOpen)}
            >
              {receipts.length === 0 ? (
                <p className="hint">No receipts yet.</p>
              ) : (
                <div className="cycle-list">
                  {receipts.map((receipt) => (
                    <ReceiptCard key={receipt.id} receipt={receipt} />
                  ))}
                </div>
              )}
            </BinSection>
            <BinSection
              id="bin-history"
              title="History of movements"
              open={historyOpen}
              onToggle={() => toggleSection("history", setHistoryOpen)}
            >
              {moves.length === 0 ? (
                <p className="hint">No movements yet.</p>
              ) : (
                <ol className="cycle-events">
                  {moves.map((event) => (
                    <CycleEvent key={event.id} event={event} />
                  ))}
                </ol>
              )}
            </BinSection>
            <div className="receive-actions">
              <Link href="/warehouse/receiving">Receive into a bin</Link>
            </div>
          </>
        ) : null}
      </div>
      {detail && printJob?.kind === "bin" ? (
        <div className="print-sheet">
          <BinLabel
            reference={detail.reference}
            type={detail.type}
            layout={templates[detail.type]}
            sheet={labelSheet}
          />
        </div>
      ) : null}
      {printJob?.kind === "item" ? (
        <div className="print-sheet">
          <PrintedLabel
            template={itemTemplate}
            name={printJob.row.name}
            description={printJob.row.description.trim() || printJob.row.name}
            code={
              itemTemplate === "qr" && pageOrigin
                ? qrLabelPayload(pageOrigin, printJob.row.itemId, printJob.row.sku)
                : barcodeValue(printJob.row.sku, printJob.row.itemId)
            }
            sku={printJob.row.sku}
            itemId={printJob.row.itemId}
            origin={pageOrigin}
            quantity={String(printJob.row.qty)}
            shortCode={printJob.row.shortCode}
            printedOn={printedOn}
          />
        </div>
      ) : null}
    </main>
  );
}
