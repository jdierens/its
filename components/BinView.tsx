"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { BIN_LABEL_PRINT_CSS, BinLabel } from "@/components/BinLabel";
import { barcodeValue, LABEL_PRINT_CSS } from "@/components/ItemLabel";
import { PrintedLabel } from "@/components/labelRenderers";
import { fetchBin, reprintBin } from "@/lib/binActions";
import { binTypeLabel, type BinRecord } from "@/lib/bins";
import { errorText } from "@/lib/errors";
import { fetchBinLabelTemplates, fetchLabelTemplate } from "@/lib/labelActions";
import { emptyBinLabelTemplates, qrLabelPayload, type BinLabelTemplates, type LabelTemplateId } from "@/lib/labelTemplates";
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

export function BinView({ reference }: { reference: string }) {
  const [detail, setDetail] = useState<BinDetail | null>(null);
  const [basic, setBasic] = useState<BinRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [locationCode, setLocationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<BinLabelTemplates>(emptyBinLabelTemplates);
  const [itemTemplate, setItemTemplate] = useState<LabelTemplateId>("barcode");
  const [pageOrigin, setPageOrigin] = useState("");
  const [printedOn, setPrintedOn] = useState("");
  const [printJob, setPrintJob] = useState<{ kind: "bin" } | { kind: "item"; row: BinContentRow } | null>(null);
  const [printStamp, setPrintStamp] = useState(0);

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

  async function onMove(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await moveBinToLocation(reference, locationCode);
      setLocationCode("");
      await load();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
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
  const receipts = detail ? binReceipts(detail.cycles) : [];
  const moves = detail
    ? [
        ...detail.cycles.flatMap((cycle) => cycle.events.filter((event) => event.eventType !== "receive_into_bin" && event.eventType !== "receipt_adjustment")),
        ...detail.looseEvents,
      ]
    : [];

  return (
    <main className="page bin-view desk-fields">
      <style>{`${LABEL_PRINT_CSS}\n${BIN_LABEL_PRINT_CSS}`}</style>
      <div className="no-print">
        <p className="bin-reference">{reference}</p>
        <p className="hint">{typeName ? `${typeName} bin` : "Bin"}</p>
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
          <>
            <dl className="bin-stats">
              <div>
                <dt>Current location</dt>
                <dd>{detail.locationCode ?? "No location yet"}</dd>
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
            <h2 id="bin-receipts">Receipts</h2>
            {receipts.length === 0 ? (
              <p className="hint">No receipts yet.</p>
            ) : (
              <div className="cycle-list">
                {receipts.map((receipt) => (
                  <ReceiptCard key={receipt.id} receipt={receipt} />
                ))}
              </div>
            )}
            {moves.length > 0 ? (
              <>
                <h2>Moves</h2>
                <ol className="cycle-events">
                  {moves.map((event) => (
                    <CycleEvent key={event.id} event={event} />
                  ))}
                </ol>
              </>
            ) : null}
            <h2>Contents</h2>
            {detail.contents.length === 0 ? (
              <p className="hint">Empty. The next receipt opens a new cycle.</p>
            ) : (
              <>
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Name</th>
                      <th className="num">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.contents.map((row) => (
                      <tr key={row.itemId}>
                        <td>{row.sku}</td>
                        <td>{row.name}</td>
                        <td className="num">{row.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="hint">Click a label to print it.</p>
                <div className="bin-label-row">
                  {detail.contents.map((row) => (
                    <button
                      key={row.itemId}
                      type="button"
                      className="bin-label-hit"
                      aria-label={`Print item label for ${row.sku || row.name}`}
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
            <form onSubmit={onMove}>
              <div className="field-with-action">
                <label htmlFor="bin-move-location">
                  <span>Move to location</span>
                  <input
                    id="bin-move-location"
                    value={locationCode}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    disabled={busy}
                    placeholder="HWS.00.00.00"
                    onChange={(event) => setLocationCode(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={busy}>
                  Move
                </button>
              </div>
              <span className="hint">Scan a location code. It must match one location type.</span>
            </form>
            <h2>Bin label</h2>
            <p className="hint">Click the label to print it.</p>
            <button
              type="button"
              className="bin-label-hit"
              aria-label={`Print bin label ${detail.reference}`}
              disabled={busy}
              onClick={() => void printBinLabel()}
            >
              <span className="label-frame">
                <BinLabel reference={detail.reference} type={detail.type} layout={templates[detail.type]} />
              </span>
            </button>
            <div className="receive-actions">
              <Link href="/warehouse/receiving">Receive into a bin</Link>
            </div>
          </>
        ) : null}
      </div>
      {detail && printJob?.kind === "bin" ? (
        <div className="print-sheet">
          <BinLabel reference={detail.reference} type={detail.type} layout={templates[detail.type]} />
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
