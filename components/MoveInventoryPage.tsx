"use client";

import { FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { errorText } from "@/lib/errors";
import { commitMove, fetchMovePlace, listBinEntries, listRecentMoves, previewMove, undoMove } from "@/lib/moveActions";
import {
  binEntriesCode,
  formatMoveWhen,
  isBinCode,
  moveItemLines,
  placeDescription,
  recentMovesCode,
  setMoveItemQty,
  targetFields,
  toggleMoveItem,
  type BinEntry,
  type MoveChild,
  type MoveItem,
  type MovePlace,
  type MovePreview,
  type RecentMove,
} from "@/lib/moveInventory";
import { createReceivingBin } from "@/lib/receivingActions";
import { isBinType } from "@/lib/bins";

type Choice =
  | { kind: "bin" }
  | { kind: "bins"; refs: string[] }
  | { kind: "items"; lines: { itemId: string; qty: string }[] }
  | { kind: "empty" }
  | null;

type KnownPlace = Extract<MovePlace, { kind: "bin" | "location" }>;

function sourceBin(place: MovePlace | null): string | null {
  if (!place || place.kind !== "bin") return null;
  return place.bin.reference;
}

function knownPlace(place: MovePlace | null): KnownPlace | null {
  if (!place || (place.kind !== "bin" && place.kind !== "location")) return null;
  return place;
}

function matchesCode(place: MovePlace | null, text: string): boolean {
  if (!place) return false;
  return place.code.trim().toUpperCase() === text.trim().toUpperCase();
}

function scopeLabel(place: KnownPlace): string {
  if (place.kind === "bin") return place.bin.label || place.code;
  return place.code;
}

export function MoveInventoryPage() {
  const [sourceText, setSourceText] = useState("");
  const [targetText, setTargetText] = useState("");
  const [place, setPlace] = useState<MovePlace | null>(null);
  const [targetPlace, setTargetPlace] = useState<MovePlace | null>(null);
  const [choice, setChoice] = useState<Choice>(null);
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [result, setResult] = useState<{ summary: string; requestId: string } | null>(null);
  const [recent, setRecent] = useState<RecentMove[]>([]);
  const [recentFor, setRecentFor] = useState<string | null>(null);
  const [entries, setEntries] = useState<BinEntry[]>([]);
  const [entriesFor, setEntriesFor] = useState<string | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migration, setMigration] = useState(false);
  const sourceRequest = useRef(0);
  const targetRequest = useRef(0);
  const recentRequest = useRef(0);
  const entriesRequest = useRef(0);

  function fail(cause: unknown) {
    const message = errorText(cause);
    if (/move_inventory\.sql|could not find the function|schema cache/i.test(message)) {
      setMigration(true);
      setError("Apply supabase/migrations/20261024064500_move_inventory.sql before moves can be saved.");
      return;
    }
    setError(message);
  }

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
    if (!code) {
      sourceRequest.current += 1;
      setPlace(null);
      setChoice(null);
      return;
    }
    const handle = window.setTimeout(() => {
      void loadSource(code);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [sourceText]);

  async function refreshTargetNow(raw: string) {
    const code = raw.trim();
    const request = ++targetRequest.current;
    if (!code) {
      setTargetPlace(null);
      return;
    }
    try {
      const next = await fetchMovePlace(code);
      if (request === targetRequest.current) setTargetPlace(next);
    } catch (cause) {
      if (request === targetRequest.current) fail(cause);
    }
  }

  useEffect(() => {
    const code = targetText.trim();
    if (!code) {
      targetRequest.current += 1;
      setTargetPlace(null);
      return;
    }
    const handle = window.setTimeout(() => {
      void refreshTargetNow(code);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [targetText]);

  useEffect(() => {
    const code = recentMovesCode(place);
    const request = ++recentRequest.current;
    if (!code) {
      setRecent([]);
      setRecentFor(null);
      return;
    }
    void listRecentMoves(code)
      .then((rows) => {
        if (request !== recentRequest.current) return;
        setRecent(rows);
        setRecentFor(code);
      })
      .catch((cause: unknown) => {
        if (request !== recentRequest.current) return;
        setRecent([]);
        setRecentFor(code);
        fail(cause);
      });
  }, [place]);

  useEffect(() => {
    const shown = matchesCode(place, sourceText) ? place : null;
    const code = binEntriesCode(shown);
    const request = ++entriesRequest.current;
    if (!code) {
      setEntries([]);
      setEntriesFor(null);
      setEntriesError(null);
      return;
    }
    void listBinEntries(code)
      .then((rows) => {
        if (request !== entriesRequest.current) return;
        setEntries(rows);
        setEntriesFor(code);
        setEntriesError(null);
      })
      .catch((cause: unknown) => {
        if (request !== entriesRequest.current) return;
        setEntries([]);
        setEntriesFor(code);
        setEntriesError(errorText(cause));
      });
  }, [place, sourceText]);

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
    let kind: "bin" | "bins" | "item" | "items" | "empty" = "bin";
    let binRefs: string[] = [];
    let itemId: string | null = null;
    let qty: number | null = null;
    let items: { itemId: string; qty: number }[] | undefined;
    if (choice.kind === "bin" && fromBin) binRefs = [fromBin];
    if (choice.kind === "bins") {
      kind = "bins";
      binRefs = choice.refs;
    }
    if (choice.kind === "items") {
      const parsed = moveItemLines(choice.lines, (id) => place.items.find((row) => row.itemId === id)?.qty);
      if (!parsed.ok) {
        setPreview({ ok: false, message: parsed.message, summary: null });
        return;
      }
      items = [...parsed.items].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
      if (items.length === 1) {
        kind = "item";
        itemId = items[0].itemId;
        qty = items[0].qty;
      } else {
        kind = "items";
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
        items,
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
      if (!created.ok) {
        setError(created.message);
        return;
      }
      if (sourceText.trim().toUpperCase() === code.toUpperCase() || place?.kind === "missing_bin") {
        setSourceText(created.bin.reference);
        await loadSource(created.bin.reference);
      } else {
        setTargetText(created.bin.reference);
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
    let kind: "bin" | "bins" | "item" | "items" | "empty" = choice.kind === "empty" ? "empty" : choice.kind === "items" ? "items" : choice.kind;
    let binRefs: string[] = [];
    let itemId: string | null = null;
    let qty: number | null = null;
    let items: { itemId: string; qty: number }[] | undefined;
    if (choice.kind === "bin" && fromBin) binRefs = [fromBin];
    if (choice.kind === "bins") binRefs = choice.refs;
    if (choice.kind === "items") {
      const parsed = moveItemLines(choice.lines, (id) => place.items.find((row) => row.itemId === id)?.qty);
      if (!parsed.ok) return;
      items = [...parsed.items].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
      if (items.length === 1) {
        kind = "item";
        itemId = items[0].itemId;
        qty = items[0].qty;
      }
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
        items,
        targetBin: target.targetBin,
        targetLocation: target.targetLocation,
        comment: "",
        requestId,
      });
      setResult(saved);
      setPreview(null);
      setChoice(null);
      await loadSource(place.code, true);
      await refreshTargetNow(targetText);
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
      await refreshTargetNow(targetText);
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
  const known = knownPlace(place);
  const targetShown = matchesCode(targetPlace, targetText) ? targetPlace : null;
  const targetKnown = knownPlace(targetShown);
  const targetMissing =
    targetShown?.kind === "missing_bin" ||
    (isBinCode(targetText) && preview?.message === "No bin with that code. Use New bin.");
  const scope = recentMovesCode(place);
  const scopeReady = scope != null && recentFor === scope;
  const recentName = known ? scopeLabel(known) : scope;
  const sourceTyped = sourceText.trim();
  const sourceShown = matchesCode(place, sourceText) ? place : null;
  const entriesCode = binEntriesCode(sourceShown);
  const entriesReady = entriesCode != null && entriesFor === entriesCode;
  const entriesName = sourceShown && sourceShown.kind === "bin" ? scopeLabel(sourceShown) : entriesCode;

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
          <div className="move-lookup">
            <label className="move-lookup-field" htmlFor="move-source-code">
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
            <PlaceNote place={known}>
              {missing ? <p className="hint">{missing.message}</p> : null}
              {place?.kind === "unknown" ? <p className="hint">{place.message}</p> : null}
            </PlaceNote>
            <div className="move-lookup-actions">
              {known?.kind === "bin" ? (
                <>
                  <button
                    type="button"
                    aria-pressed={choice?.kind === "bin"}
                    disabled={busy}
                    onClick={() => setChoice({ kind: "bin" })}
                  >
                    Move this bin
                  </button>
                  <button
                    type="button"
                    aria-pressed={choice?.kind === "empty"}
                    disabled={busy}
                    onClick={() => setChoice({ kind: "empty" })}
                  >
                    Empty into target
                  </button>
                </>
              ) : null}
              {missing ? (
                <button type="button" disabled={busy} onClick={() => void register(missing.code, missing.type)}>
                  Register this bin
                </button>
              ) : null}
            </div>
          </div>
        </form>
        {known ? (
          <ContentsTable
            place={known}
            selectable
            choice={choice}
            busy={busy}
            onBins={(refs) => setChoice(refs.length > 0 ? { kind: "bins", refs } : null)}
            onToggleItem={(itemId, onHand) => {
              setChoice((current) => {
                const lines = current?.kind === "items" ? current.lines : [];
                const next = toggleMoveItem(lines, itemId, onHand);
                return next.length > 0 ? { kind: "items", lines: next } : null;
              });
            }}
            onQty={(itemId, qty) => {
              setChoice((current) => {
                if (current?.kind !== "items") return current;
                return { kind: "items", lines: setMoveItemQty(current.lines, itemId, qty) };
              });
            }}
          />
        ) : null}
      </section>

      <section className="card move-card" id="move-target">
        <h2>Target</h2>
        <form onSubmit={confirm}>
          <div className="move-lookup">
            <label className="move-lookup-field" htmlFor="move-target-code">
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
            <PlaceNote place={targetKnown}>
              {targetShown?.kind === "missing_bin" ? <p className="hint">{targetShown.message}</p> : null}
              {targetShown?.kind === "unknown" ? <p className="hint">{targetShown.message}</p> : null}
              {preview?.ok && preview.summary ? (
                <p className="move-summary" id="move-summary">
                  {preview.summary}
                </p>
              ) : null}
              {preview && !preview.ok && !targetMissing ? (
                <p className="move-inline-error" role="alert">
                  {preview.message}
                </p>
              ) : null}
            </PlaceNote>
            <div className="move-lookup-actions">
              {targetMissing ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const code = targetShown?.kind === "missing_bin" ? targetShown.code : targetText.trim().toUpperCase();
                    const type = targetShown?.kind === "missing_bin" ? targetShown.type : code.slice(-1);
                    void register(code, type);
                  }}
                >
                  Register this bin
                </button>
              ) : null}
              <button id="move-confirm" type="submit" disabled={busy || !preview?.ok}>
                {busy ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </form>
        {targetKnown ? <ContentsTable place={targetKnown} selectable={false} choice={null} busy={busy} /> : null}
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
            <button type="button" disabled={busy} onClick={moveAnother}>
              Move another from the same source
            </button>
            <button type="button" disabled={busy} onClick={() => void undo()}>
              Undo
            </button>
          </div>
        </section>
      ) : null}

      <div className="move-lists">
        <section className="card move-card" id="move-recent">
          <h2>Recent moves</h2>
          {!scope ? (
            <p className="hint">Scan a bin or a location to see its moves.</p>
          ) : !scopeReady ? (
            <p className="hint">Loading moves…</p>
          ) : recent.length === 0 ? (
            error ? null : <p className="hint">No moves for {recentName} yet.</p>
          ) : (
            <>
              <p className="hint" id="move-recent-scope">
                Moves for {recentName}.
              </p>
              <div className="move-recent-scroll" tabIndex={0} aria-label={`Recent moves for ${recentName}`}>
                <table className="receive-table">
                  <thead>
                    <tr>
                      <th className="fit">Date</th>
                      <th className="fit">Op</th>
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
                        <td>{row.fromPlace}</td>
                        <td>{row.toPlace}</td>
                        <td className="num fit">{row.qty ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="card move-card" id="move-entries">
          <h2>Recent entries</h2>
          {!sourceTyped ? (
            <p className="hint">Scan a source bin to see what's in it.</p>
          ) : !isBinCode(sourceTyped) ? (
            <p className="hint">Entries follow the source bin.</p>
          ) : !entriesCode ? (
            sourceShown?.kind === "missing_bin" || sourceShown?.kind === "unknown" ? (
              <p className="hint">{sourceShown.message}</p>
            ) : (
              <p className="hint">Loading entries…</p>
            )
          ) : !entriesReady ? (
            <p className="hint">Loading entries…</p>
          ) : entriesError ? (
            <p className="move-inline-error" role="alert">
              {entriesError}
            </p>
          ) : entries.length === 0 ? (
            <p className="hint">Nothing in {entriesName} yet.</p>
          ) : (
            <>
              <p className="hint" id="move-entries-scope">
                In {entriesName}, newest arrival first.
              </p>
              <div className="move-recent-scroll" tabIndex={0} aria-label={`Recent entries in ${entriesName}`}>
                <table className="receive-table">
                  <thead>
                    <tr>
                      <th className="fit">Date</th>
                      <th className="fit">Op</th>
                      <th>What</th>
                      <th>From</th>
                      <th className="num fit">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((row) => (
                      <tr key={row.id}>
                        <td className="fit">{formatMoveWhen(row.occurredAt)}</td>
                        <td className="fit initials">{row.initials}</td>
                        <td>{row.what}</td>
                        <td>{row.fromPlace}</td>
                        <td className="num fit">{row.qty ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function PlaceNote({ place, children }: { place: KnownPlace | null; children?: ReactNode }) {
  const described = place ? placeDescription(place.path, place.place) : null;
  return (
    <div className="move-lookup-note">
      {described?.path ? <p className="move-path">{described.path}</p> : null}
      {described?.here ? <p className="hint">{described.here}</p> : null}
      {children}
    </div>
  );
}

function ContentsTable({
  place,
  selectable,
  choice,
  busy,
  onBins,
  onToggleItem,
  onQty,
}: {
  place: KnownPlace;
  selectable: boolean;
  choice: Choice;
  busy: boolean;
  onBins?: (refs: string[]) => void;
  onToggleItem?: (itemId: string, onHand: number) => void;
  onQty?: (itemId: string, qty: string) => void;
}) {
  const empty = place.children.length === 0 && place.items.length === 0;
  if (empty) {
    return <p className="hint move-contents-empty">Nothing in this {place.kind === "bin" ? "bin" : "location"}.</p>;
  }
  const binRefs = choice?.kind === "bins" ? choice.refs : [];
  return (
    <div className="move-contents">
      <h3 className="move-contents-title">Contents</h3>
      <div className="move-table-scroll">
        <table className="receive-table move-contents-table" aria-label={`Contents of ${place.code}`}>
          <thead>
            <tr>
              {selectable ? (
                <th className="pick">
                  <span className="sr-only">Select</span>
                </th>
              ) : null}
              <th>What</th>
              <th className="num fit">Boxes</th>
              <th className="num fit">Items</th>
              <th className="num fit">Qty</th>
            </tr>
          </thead>
          <tbody>
            {place.children.map((child) => (
              <BinRow
                key={child.id}
                child={child}
                selectable={selectable}
                checked={binRefs.includes(child.reference)}
                busy={busy}
                onToggle={() => {
                  const refs = binRefs.includes(child.reference)
                    ? binRefs.filter((ref) => ref !== child.reference)
                    : [...binRefs, child.reference];
                  onBins?.(refs);
                }}
              />
            ))}
            {place.items.map((row) => {
              const line = choice?.kind === "items" ? choice.lines.find((entry) => entry.itemId === row.itemId) : undefined;
              return (
                <ItemRow
                  key={row.itemId}
                  row={row}
                  selectable={selectable}
                  selected={line != null}
                  qty={line?.qty ?? String(row.qty)}
                  busy={busy}
                  onToggle={() => onToggleItem?.(row.itemId, row.qty)}
                  onQty={(qty) => onQty?.(row.itemId, qty)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BinRow({
  child,
  selectable,
  checked,
  busy,
  onToggle,
}: {
  child: MoveChild;
  selectable: boolean;
  checked: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className={checked ? "is-selected" : undefined}>
      {selectable ? (
        <td className="pick">
          <label className="move-choice">
            <input
              type="checkbox"
              checked={checked}
              disabled={busy}
              aria-label={`Move ${child.label}`}
              onChange={onToggle}
            />
          </label>
        </td>
      ) : null}
      <td>{child.label}</td>
      <td className="num fit">{child.boxes}</td>
      <td className="num fit">{child.items}</td>
      <td className="num fit" />
    </tr>
  );
}

function ItemRow({
  row,
  selectable,
  selected,
  qty,
  busy,
  onToggle,
  onQty,
}: {
  row: MoveItem;
  selectable: boolean;
  selected: boolean;
  qty: string;
  busy: boolean;
  onToggle: () => void;
  onQty: (qty: string) => void;
}) {
  const name = [row.sku, row.name].filter(Boolean).join(" ");
  return (
    <tr className={selected ? "is-selected" : undefined}>
      {selectable ? (
        <td className="pick">
          <label className="move-choice">
            <input
              type="checkbox"
              checked={selected}
              disabled={busy}
              aria-label={`Move ${name}`}
              onChange={onToggle}
            />
          </label>
        </td>
      ) : null}
      <td>{name}</td>
      <td className="num fit" />
      <td className="num fit" />
      <td className="num fit">
        {selectable ? (
          <label className="move-qty" htmlFor={`move-qty-${row.itemId}`}>
            <span className="sr-only">Qty</span>
            <input
              id={`move-qty-${row.itemId}`}
              className="num-input"
              inputMode="numeric"
              aria-label={`Qty for ${name}`}
              value={qty}
              disabled={busy || !selected}
              onChange={(event) => onQty(event.target.value)}
            />
          </label>
        ) : (
          row.qty
        )}
      </td>
    </tr>
  );
}
