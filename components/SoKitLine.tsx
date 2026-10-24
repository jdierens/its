"use client";

import { useEffect, useState } from "react";
import { errorText } from "@/lib/errors";
import { genericStillNeedsPart } from "@/lib/kitRules";
import {
  assertKitLineReleasable,
  loadSoKitLine,
  searchParts,
  swapSoComponent,
  type PartChoice,
  type SoKitLineView,
} from "@/lib/kits";

export function SoKitLine({ lineId }: { lineId: string }) {
  const [line, setLine] = useState<SoKitLineView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [customerView, setCustomerView] = useState(false);
  const [swapId, setSwapId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<PartChoice[]>([]);
  const [picked, setPicked] = useState<PartChoice | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const loaded = await loadSoKitLine(lineId);
    setLine(loaded);
  }

  useEffect(() => {
    let cancelled = false;
    loadSoKitLine(lineId)
      .then((loaded) => {
        if (!cancelled) setLine(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [lineId]);

  useEffect(() => {
    if (!swapId) return;
    const component = line?.components.find((row) => row.id === swapId);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchParts(query, component?.plannedItemId ?? null)
        .then((found) => {
          if (!cancelled) setChoices(found);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(errorText(err));
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, swapId, line]);

  async function onSwap() {
    if (!swapId || !picked) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await swapSoComponent(swapId, picked.id, reason);
      setSwapId(null);
      setPicked(null);
      setReason("");
      setQuery("");
      await reload();
      setNotice("Swap saved.");
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRelease() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await assertKitLineReleasable(lineId);
      setNotice("This line can be picked, shipped, or invoiced.");
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!line && !error) return <p className="muted">Loading…</p>;
  if (!line) return <p className="banner error">{error}</p>;

  const blocked = line.components.some((row) =>
    genericStillNeedsPart({
      plannedGeneric: row.plannedGeneric,
      hasActual: Boolean(row.actualItemId),
      actualGeneric: row.actualItemId ? row.actualGeneric : null,
    }),
  );

  return (
    <section className="kit-panel" aria-label="Sales order kit line">
      <p className="kit-line-title">
        Line {line.lineNo}. {line.kitSku ? `${line.kitSku} ` : ""}
        {line.kitName || line.description} · qty {line.qty}
      </p>
      <label className="kit-check">
        <input type="checkbox" checked={customerView} onChange={(event) => setCustomerView(event.target.checked)} />
        Customer document
      </label>
      {customerView ? (
        <p>Quote, pro forma, invoice, and packing slip show this kit line only.</p>
      ) : (
        <>
          <p className="hint">Pick ticket and this page show every component. Swaps stay visible.</p>
          {error ? <p className="banner error">{error}</p> : null}
          {notice ? <p className="banner">{notice}</p> : null}
          <div className="kit-table-wrap">
          <table className="kit-table">
            <thead>
              <tr>
                <th>Planned</th>
                <th>Actual</th>
                <th>Qty</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {line.components.map((row) => {
                const needs = genericStillNeedsPart({
                  plannedGeneric: row.plannedGeneric,
                  hasActual: Boolean(row.actualItemId),
                  actualGeneric: row.actualItemId ? row.actualGeneric : null,
                });
                return (
                  <tr key={row.id} className={row.swapped ? "kit-swapped" : undefined}>
                    <td data-label="Planned">
                      {row.plannedSku} {row.plannedName}{" "}
                      {row.plannedGeneric ? <span className="code-badge">Generic</span> : null}
                    </td>
                    <td data-label="Actual">
                      {needs ? (
                        <strong>Pick physical part</strong>
                      ) : (
                        <>
                          {row.actualSku} {row.actualName}
                          {row.swapped ? <span className="code-badge">Swapped</span> : null}
                        </>
                      )}
                      {row.swapReason ? <span className="hint">{row.swapReason}</span> : null}
                    </td>
                    <td data-label="Qty">{row.qty}</td>
                    <td>
                      <button type="button" className="secondary" onClick={() => { setSwapId(row.id); setPicked(null); setReason(row.swapReason); }}>
                        Swap
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {swapId ? (
            <fieldset className="kit-swap">
              <legend>{line.components.find((row) => row.id === swapId)?.plannedGeneric ? "Pick physical part" : "Swap"}</legend>
              <label>
                Find a part
                <input aria-label="Find a replacement part" value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
              <ul className="kit-choices">
                {choices.map((choice) => (
                  <li key={choice.id}>
                    <button type="button" className={picked?.id === choice.id ? "" : "secondary"} onClick={() => setPicked(choice)}>
                      {choice.suggested ? "Suggested · " : ""}
                      {choice.sku} {choice.name}
                      {choice.generic ? " · Generic" : ""}
                    </button>
                  </li>
                ))}
              </ul>
              <label>
                Reason
                <input aria-label="Swap reason" value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <div className="kit-actions">
                <button type="button" onClick={() => void onSwap()} disabled={busy || !picked}>
                  Save swap
                </button>
                <button type="button" className="secondary" onClick={() => setSwapId(null)}>
                  Cancel
                </button>
              </div>
            </fieldset>
          ) : null}
          <div className="kit-actions">
            <button type="button" onClick={() => void onRelease()} disabled={busy || blocked}>
              Release line
            </button>
          </div>
          {blocked ? <p className="hint">Pick a physical part for each generic component before release.</p> : null}
        </>
      )}
    </section>
  );
}
