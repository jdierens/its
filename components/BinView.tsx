"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { BIN_LABEL_PRINT_CSS, BinLabel } from "@/components/BinLabel";
import { fetchBin } from "@/lib/binActions";
import { binTypeLabel, type BinRecord } from "@/lib/bins";
import { errorText } from "@/lib/errors";
import { fetchBinLabelTemplates } from "@/lib/labelActions";
import { emptyBinLabelTemplates, type BinLabelTemplates } from "@/lib/labelTemplates";
import { fetchBinDetail, moveBinToLocation } from "@/lib/receivingActions";
import { cycleEventParts, type BinCycleView, type BinDetail, type StockEventRow } from "@/lib/stockReceive";

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

function CycleCard({ cycle }: { cycle: BinCycleView }) {
  return (
    <article className="cycle-card">
      <h3>{cycle.status === "open" ? "Open cycle" : "Closed cycle"}</h3>
      <dl className="cycle-facts">
        <div>
          <dt>Opened</dt>
          <dd>
            {when(cycle.openedAt)}
            {cycle.openedByInitials ? ` · ${cycle.openedByInitials}` : ""}
          </dd>
        </div>
        {cycle.closedAt ? (
          <div>
            <dt>Closed</dt>
            <dd>{when(cycle.closedAt)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Originating system</dt>
          <dd>{cycle.originDescription ?? "—"}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{cycle.project ?? "—"}</dd>
        </div>
        <div>
          <dt>Incoming bin</dt>
          <dd>{cycle.incomingTag ?? "—"}</dd>
        </div>
        <div>
          <dt>Put-away default at open</dt>
          <dd>{cycle.defaultLocationCode ?? "—"}</dd>
        </div>
        <div>
          <dt>Location at open</dt>
          <dd>{cycle.openedLocationCode ?? "—"}</dd>
        </div>
      </dl>
      {cycle.events.length > 0 ? (
        <ol className="cycle-events">
          {cycle.events.map((event) => (
            <CycleEvent key={event.id} event={event} />
          ))}
        </ol>
      ) : (
        <p className="hint">No events on this cycle.</p>
      )}
    </article>
  );
}

export function BinView({ reference }: { reference: string }) {
  const [detail, setDetail] = useState<BinDetail | null>(null);
  const [basic, setBasic] = useState<BinRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [locationCode, setLocationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<BinLabelTemplates>(emptyBinLabelTemplates);
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
    void fetchBinLabelTemplates()
      .then((loaded) => {
        if (!cancelled) setTemplates(loaded);
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

  const typeName = detail ? binTypeLabel(detail.type) : basic ? binTypeLabel(basic.type) : "";

  return (
    <main className="page bin-view desk-fields">
      <style>{BIN_LABEL_PRINT_CSS}</style>
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
            <h2 id="bin-cycles">Cycles</h2>
            {detail.cycles.length === 0 ? (
              <p className="hint">No cycles yet.</p>
            ) : (
              <div className="cycle-list">
                {detail.cycles.map((cycle) => (
                  <CycleCard key={cycle.id} cycle={cycle} />
                ))}
              </div>
            )}
            {detail.looseEvents.length > 0 ? (
              <>
                <h2>Moves while empty</h2>
                <ol className="cycle-events">
                  {detail.looseEvents.map((event) => (
                    <CycleEvent key={event.id} event={event} />
                  ))}
                </ol>
              </>
            ) : null}
            <h2>Contents</h2>
            {detail.contents.length === 0 ? (
              <p className="hint">Empty. The next receipt opens a new cycle.</p>
            ) : (
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
            <div className="receive-actions">
              <button type="button" className="secondary" onClick={() => setPrintStamp((current) => current + 1)}>
                Print bin label
              </button>
              <Link href="/warehouse/receiving">Receive into a bin</Link>
            </div>
            <div className="label-frame">
              <BinLabel reference={detail.reference} type={detail.type} layout={templates[detail.type]} />
            </div>
          </>
        ) : null}
      </div>
      {detail ? (
        <div className="print-sheet">
          <BinLabel reference={detail.reference} type={detail.type} layout={templates[detail.type]} />
        </div>
      ) : null}
    </main>
  );
}
