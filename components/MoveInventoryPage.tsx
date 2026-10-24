"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/errors";
import { commitMove, fetchMovePlace, listRecentMoves, previewMove, undoMove } from "@/lib/moveActions";
import {
  formatMoveWhen,
  parseMoveQty,
  targetFields,
  type MovePlace,
  type MovePreview,
  type RecentMove,
} from "@/lib/moveInventory";
import { createReceivingBin } from "@/lib/receivingActions";
import { isBinType } from "@/lib/bins";

type Choice =
  | { kind: "bin" }
  | { kind: "bins"; refs: string[] }
  | { kind: "item"; itemId: string; qty: string }
  | { kind: "empty" }
  | null;

function sourceBin(place: MovePlace | null): string | null {
  if (!place || place.kind !== "bin") return null;
  return place.bin.reference;
}

export function MoveInventoryPage() {
  const [sourceText, setSourceText] = useState("");
  const [targetText, setTargetText] = useState("");
  const [place, setPlace] = useState<MovePlace | null>(null);
  const [choice, setChoice] = useState<Choice>(null);
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [result, setResult] = useState<{ summary: string; requestId: string } | null>(null);
  const [recent, setRecent] = useState<RecentMove[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migration, setMigration] = useState(false);
  const sourceRequest = useRef(0);

  function fail(cause: unknown) {
    const message = errorText(cause);
    if (/move_inventory\.sql|could not find the function|schema cache/i.test(message)) {
      setMigration(true);
      setError("Apply supabase/migrations/20261024064500_move_inventory.sql before moves can be saved.");
      return;
    }
    setError(message);
  }

  async function refreshRecent() {
    try {
      setRecent(await listRecentMoves());
    } catch (cause) {
      fail(cause);
    }
  }

  useEffect(() => {
    void refreshRecent();
  }, []);

  async function loadSource(raw: string, keepResult = false) {
    const code = raw.trim();
    const request = ++sourceRequest.current;
    if (!code) {
      setPlace(null);
      setChoice(null);
      return;
    }
    setError(null);
    try {
      const next = await fetchMovePlace(code);
      if (request !== sourceRequest.current) return;
      setPlace(next);
      setChoice(null);
      setPreview(null);
      if (!keepResult) setResult(null);
    } catch (cause) {
      if (request === sourceRequest.current) fail(cause);
    }
  }

  useEffect(() => {
    const code = sourceText.trim();
    if (!code) return;
    const handle = window.setTimeout(() => {
      void loadSource(code);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [sourceText]);

  useEffect(() => {
    if (!place || (place.kind !== "bin" && place.kind !== "location") || !choice) {
      setPreview(null);
      return;
    }
    const target = targetFields(targetText);
    if (!target.targetBin && !target.targetLocation) {
      setPreview(null);
      return;
    }
    const fromBin = sourceBin(place);
    let kind: "bin" | "bins" | "item" | "empty" = "bin";
    let binRefs: string[] = [];
    let itemId: string | null = null;
    let qty: number | null = null;
    if (choice.kind === "bin" && fromBin) binRefs = [fromBin];
    if (choice.kind === "bins") {
      kind = "bins";
      binRefs = choice.refs;
    }
    if (choice.kind === "item") {
      kind = "item";
      itemId = choice.itemId;
      const held = place.items.find((row) => row.itemId === choice.itemId);
      qty = parseMoveQty(choice.qty, held?.qty ?? 0);
      if (qty == null) {
        setPreview({
          ok: false,
          message: held && Number(choice.qty) > held.qty ? `Only ${held.qty} are in that bin.` : "Enter a whole number of at least 1.",
          summary: null,
        });
        return;
      }
    }
    if (choice.kind === "empty") kind = "empty";
    if ((kind === "bin" || kind === "bins") && binRefs.length === 0) {
      setPreview(null);
      return;
    }
    setPreview(null);
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void previewMove({
        kind,
        binRefs,
        fromBin,
        itemId,
        qty,
        targetBin: target.targetBin,
        targetLocation: target.targetLocation,
      })
        .then((next) => {
          if (!cancelled) setPreview(next);
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setPreview(null);
            fail(cause);
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [place, choice, targetText]);

  async function register(code: string, type: string) {
    if (!isBinType(type)) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createReceivingBin(type, code);
      if (sourceText.trim().toUpperCase() === code.toUpperCase() || place?.kind === "missing_bin") {
        setSourceText(created.reference);
        await loadSource(created.reference);
      } else {
        setTargetText(created.reference);
      }
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!place || (place.kind !== "bin" && place.kind !== "location") || !choice || !preview?.ok) return;
    const target = targetFields(targetText);
    const fromBin = sourceBin(place);
    const requestId = crypto.randomUUID();
    let kind: "bin" | "bins" | "item" | "empty" = choice.kind === "empty" ? "empty" : choice.kind === "item" ? "item" : choice.kind;
    let binRefs: string[] = [];
    let itemId: string | null = null;
    let qty: number | null = null;
    if (choice.kind === "bin" && fromBin) binRefs = [fromBin];
    if (choice.kind === "bins") binRefs = choice.refs;
    if (choice.kind === "item") {
      itemId = choice.itemId;
      const held = place.items.find((row) => row.itemId === choice.itemId);
      qty = parseMoveQty(choice.qty, held?.qty ?? 0);
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await commitMove({
        kind,
        binRefs,
        fromBin,
        itemId,
        qty,
        targetBin: target.targetBin,
        targetLocation: target.targetLocation,
        comment: "",
        requestId,
      });
      setResult(saved);
      setPreview(null);
      setChoice(null);
      setTargetText("");
      await loadSource(place.code, true);
      await refreshRecent();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await undoMove(result.requestId, crypto.randomUUID());
      setResult(saved);
      if (place && (place.kind === "bin" || place.kind === "location")) await loadSource(place.code, true);
      await refreshRecent();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  function moveAnother() {
    setResult(null);
    setChoice(null);
    setPreview(null);
    setTargetText("");
    setError(null);
    if (place && (place.kind === "bin" || place.kind === "location")) void loadSource(place.code);
  }

  const missing = place?.kind === "missing_bin" ? place : null;
  const known = place && (place.kind === "bin" || place.kind === "location") ? place : null;
  const targetMissing = isBinCodeTarget(targetText) && preview?.message === "No bin with that code. Use New bin.";

  return (
    <main className="page move-page desk-fields">
      <p className="page-note">Scan a bin or a location, choose what moves, then scan where it goes.</p>
      {migration ? (
        <p className="banner error" role="alert">
          Apply supabase/migrations/20261024064500_move_inventory.sql before moves can be saved.
        </p>
      ) : null}
      <section className="card move-card" id="move-source">
        <h2>Source</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void loadSource(sourceText);
          }}
        >
          <label htmlFor="move-source-code">
            <span>Bin or location</span>
            <input
              id="move-source-code"
              value={sourceText}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              disabled={busy}
              onChange={(event) => setSourceText(event.target.value)}
            />
          </label>
        </form>
        {missing ? (
          <div className="move-register">
            <p className="hint">{missing.message}</p>
            <button type="button" className="secondary" disabled={busy} onClick={() => void register(missing.code, missing.type)}>
              Register this bin
            </button>
          </div>
        ) : null}
        {place?.kind === "unknown" ? <p className="hint">{place.message}</p> : null}
        {known ? (
          <>
            <p className="move-path">{known.path}</p>
            <p className="hint">Now at {known.place}.</p>
            {known.kind === "bin" ? (
              <button
                type="button"
                className={choice?.kind === "bin" ? "" : "secondary"}
                aria-pressed={choice?.kind === "bin"}
                disabled={busy}
                onClick={() => setChoice({ kind: "bin" })}
              >
                Move this bin
              </button>
            ) : null}
            {known.children.length > 0 ? (
              <ul className="move-tree">
                {known.children.map((child) => {
                  const checked = choice?.kind === "bins" && choice.refs.includes(child.reference);
                  return (
                    <li key={child.id}>
                      <label className="move-choice">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy}
                          onChange={() => {
                            const current = choice?.kind === "bins" ? choice.refs : [];
                            const refs = checked
                              ? current.filter((ref) => ref !== child.reference)
                              : [...current, child.reference];
                            setChoice(refs.length > 0 ? { kind: "bins", refs } : null);
                          }}
                        />
                        <span>
                          {child.label}
                          <span className="muted"> · {child.boxes} boxes · {child.items} items</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {known.items.length > 0 ? (
              <ul className="move-items">
                {known.items.map((row) => {
                  const selected = choice?.kind === "item" && choice.itemId === row.itemId;
                  return (
                    <li key={row.itemId}>
                      <label className="move-choice">
                        <input
                          type="radio"
                          name="move-item"
                          checked={selected}
                          disabled={busy}
                          onChange={() => setChoice({ kind: "item", itemId: row.itemId, qty: String(row.qty) })}
                        />
                        <span>{[row.sku, row.name].filter(Boolean).join(" ")}</span>
                      </label>
                      <label className="move-qty" htmlFor={`move-qty-${row.itemId}`}>
                        <span>Qty</span>
                        <input
                          id={`move-qty-${row.itemId}`}
                          className="num-input"
                          inputMode="numeric"
                          value={selected && choice.kind === "item" ? choice.qty : String(row.qty)}
                          disabled={busy || !selected}
                          onChange={(event) => {
                            if (choice?.kind === "item" && choice.itemId === row.itemId) {
                              setChoice({ kind: "item", itemId: row.itemId, qty: event.target.value });
                            }
                          }}
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {known.kind === "bin" ? (
              <button
                type="button"
                className={choice?.kind === "empty" ? "" : "secondary"}
                aria-pressed={choice?.kind === "empty"}
                disabled={busy}
                onClick={() => setChoice({ kind: "empty" })}
              >
                Empty into target
              </button>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="card move-card" id="move-target">
        <h2>Target</h2>
        <form onSubmit={confirm}>
          <label htmlFor="move-target-code">
            <span>Bin or location</span>
            <input
              id="move-target-code"
              value={targetText}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              disabled={busy}
              onChange={(event) => setTargetText(event.target.value)}
            />
          </label>
          {targetMissing ? (
            <div className="move-register">
              <p className="hint">No bin with that code. Use New bin.</p>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void register(targetText.trim().toUpperCase(), targetText.trim().slice(-1))}
              >
                Register this bin
              </button>
            </div>
          ) : null}
          {preview && !preview.ok && !targetMissing ? <p className="banner error">{preview.message}</p> : null}
          {preview?.ok && preview.summary ? (
            <p className="move-summary" id="move-summary">
              {preview.summary}
            </p>
          ) : null}
          <div className="actions">
            <button id="move-confirm" type="submit" disabled={busy || !preview?.ok}>
              {busy ? "Saving…" : "Confirm"}
            </button>
          </div>
        </form>
      </section>

      {error && !migration ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <section className="move-done" id="move-done" aria-label="Saved move">
          <p className="banner ok" role="status">
            {result.summary}
          </p>
          <div className="move-actions">
            <button type="button" className="secondary" disabled={busy} onClick={moveAnother}>
              Move another from the same source
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void undo()}>
              Undo
            </button>
          </div>
        </section>
      ) : null}

      <section className="card move-card" id="move-recent">
        <h2>Recent moves</h2>
        {recent.length === 0 ? (
          <p className="hint">No moves yet.</p>
        ) : (
          <>
            <div className="receive-table-scroll">
              <table className="receive-table">
                <thead>
                  <tr>
                    <th className="fit">Date/time</th>
                    <th className="fit">Init.</th>
                    <th>What</th>
                    <th>From</th>
                    <th>To</th>
                    <th className="num fit">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row) => (
                    <tr key={row.id}>
                      <td className="fit">{formatMoveWhen(row.occurredAt)}</td>
                      <td className="fit initials">{row.initials}</td>
                      <td>{row.what}</td>
                      <td>{row.fromPlace}</td>
                      <td>{row.toPlace}</td>
                      <td className="num fit">{row.qty ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="receive-cards">
              {recent.map((row) => (
                <li key={`card-${row.id}`} className="receive-card-row">
                  <dl>
                    <dt>Date/time</dt>
                    <dd>{formatMoveWhen(row.occurredAt)}</dd>
                    <dt>Initials</dt>
                    <dd className="initials">{row.initials}</dd>
                    <dt>What</dt>
                    <dd>{row.what}</dd>
                    <dt>From</dt>
                    <dd>{row.fromPlace}</dd>
                    <dt>To</dt>
                    <dd>{row.toPlace}</dd>
                    <dt>Qty</dt>
                    <dd className="num">{row.qty ?? ""}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}

function isBinCodeTarget(value: string): boolean {
  return /^\d{1,5}-[BCP]$/.test(value.trim().toUpperCase());
}
