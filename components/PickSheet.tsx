"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { usePageMeta } from "@/components/AppShell";
import {
  finishPick,
  lookupPickSerial,
  recordPick,
  recordPickSerial,
  removePickSerial,
  setPickShort,
  undoPick,
} from "@/lib/pickActions";
import { errorText } from "@/lib/errors";
import { formatPullFrom, pullCue, type SerialPull } from "@/lib/pickSerialLocation";
import { cooProblem } from "@/lib/stockUnits";
import {
  formatPickQty,
  lineRemaining,
  parsePickQty,
  pickTargetForBin,
  serialProblem,
  sheetProgress,
  type PickLine,
  type PickSheetModel,
} from "@/lib/pickSheet";

function qtyKey(allocationId: string, binId: string): string {
  return `${allocationId}:${binId}`;
}

function itemSerials(sheet: PickSheetModel, sku: string): string[] {
  const found: string[] = [];
  for (const line of sheet.lines) {
    if (line.sku !== sku) continue;
    for (const pick of line.picks) {
      for (const serial of pick.serials) found.push(serial.serial);
    }
  }
  for (const orphan of sheet.orphans) {
    if (orphan.sku !== sku) continue;
    for (const serial of orphan.serials) found.push(serial.serial);
  }
  return found;
}

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

export function PickSheet({ initial, canPick }: { initial: PickSheetModel; canPick: boolean }) {
  const [sheet, setSheet] = useState(initial);
  const [qtyText, setQtyText] = useState<Record<string, string>>({});
  const [serialText, setSerialText] = useState<Record<string, string>>({});
  const [cooText, setCooText] = useState<Record<string, string>>({});
  const [pull, setPull] = useState<SerialPull | null>(null);
  const [scan, setScan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = canPick && sheet.pickStatus === "open";
  const progress = sheetProgress(sheet.lines);
  const title = sheet.soNumber ? `Pick SO${sheet.soNumber}` : "Pick sheet";
  const activePull =
    pull && (serialText[pull.allocationId] ?? "").trim().toLowerCase() === pull.serial.trim().toLowerCase() ? pull : null;

  usePageMeta({
    title,
    crumbs: [
      { label: "Warehouse" },
      { label: "Picking", href: "/warehouse/pick" },
      { label: title },
    ],
  });

  async function run(action: () => Promise<PickSheetModel>) {
    setBusy(true);
    setError(null);
    try {
      setSheet(await action());
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function pickQty(allocationId: string, binId: string, amount: number) {
    await run(() =>
      recordPick({
        orderId: sheet.orderId,
        allocationId,
        binId,
        qty: amount,
        requestId: crypto.randomUUID(),
      }),
    );
  }

  async function fillSerialLocation(raw: string, allocationId: string | null) {
    const line = allocationId ? sheet.lines.find((row) => row.allocationId === allocationId) : undefined;
    if (line) {
      const problem = serialProblem({ serial: raw, sku: line.sku, existing: itemSerials(sheet, line.sku) });
      if (problem) {
        setError(problem);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const found = await lookupPickSerial(sheet.orderId, raw, allocationId);
      if (itemSerials(sheet, found.sku).some((row) => row.toLowerCase() === found.serial.toLowerCase())) {
        setPull(null);
        setError("That serial is already recorded for this item.");
        return;
      }
      setPull(found);
      setSerialText((current) => ({ ...current, [found.allocationId]: found.serial }));
      const key = qtyKey(found.allocationId, found.binId);
      setQtyText((current) => ({ ...current, [key]: current[key]?.trim() ? current[key] : "1" }));
      if (found.coo) {
        setCooText((current) => ({
          ...current,
          [found.allocationId]: current[found.allocationId]?.trim() ? current[found.allocationId] : found.coo ?? "",
        }));
      }
    } catch (cause) {
      setPull(null);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onScan(event: FormEvent) {
    event.preventDefault();
    const code = scan.trim();
    if (!code) return;
    const target = pickTargetForBin(
      sheet.lines.map((line) => ({
        allocationId: line.allocationId,
        remaining: lineRemaining(line.ordered, line.picked),
        bins: line.bins,
      })),
      code,
    );
    if (/^\d{1,5}-[A-Za-z]$/.test(code)) {
      if (!target) {
        setError("That bin is not on this pick.");
        return;
      }
      setScan("");
      await pickQty(target.allocationId, target.binId, target.qty);
      return;
    }
    setScan("");
    await fillSerialLocation(code, null);
  }

  function onLinePick(line: PickLine, binId: string, onHand: number) {
    const remaining = lineRemaining(line.ordered, line.picked);
    const parsed = parsePickQty(qtyText[qtyKey(line.allocationId, binId)] ?? "", onHand, remaining);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    void pickQty(line.allocationId, binId, parsed.qty);
  }

  async function onAddSerial(line: PickLine) {
    const serial = (serialText[line.allocationId] ?? "").trim();
    const problem = serialProblem({ serial, sku: line.sku, existing: itemSerials(sheet, line.sku) });
    if (problem) {
      setError(problem);
      return;
    }
    const country = cooProblem(cooText[line.allocationId] ?? "");
    if (country) {
      setError(country);
      return;
    }
    setBusy(true);
    setError(null);
    let found: SerialPull;
    try {
      found = await lookupPickSerial(sheet.orderId, serial, line.allocationId);
    } catch (cause) {
      setPull(null);
      setError(errorText(cause));
      setBusy(false);
      return;
    }
    setPull(found);
    setSerialText((current) => ({ ...current, [found.allocationId]: found.serial }));
    const key = qtyKey(found.allocationId, found.binId);
    setQtyText((current) => ({ ...current, [key]: current[key]?.trim() ? current[key] : "1" }));
    const pick = line.picks.find(
      (row) => (row.fromBin ?? "").toUpperCase() === found.reference.toUpperCase() && row.serials.length < row.qty,
    );
    if (!pick) {
      setError(`Pick a quantity from ${found.reference} before adding this serial.`);
      setBusy(false);
      return;
    }
    try {
      const next = await recordPickSerial(pick.id, found.serial, (cooText[line.allocationId] ?? "").trim() || found.coo);
      setSheet(next);
      setSerialText((current) => ({ ...current, [line.allocationId]: "" }));
      setCooText((current) => ({ ...current, [line.allocationId]: "" }));
      setPull(null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const stagingProjects = [
    ...new Set(
      sheet.staging.map((row) => `${row.project ?? "No project"}${row.ownership ? ` · ${row.ownership}` : ""}`),
    ),
  ];
  const recorded = [
    ...sheet.lines.flatMap((line) => line.picks.map((pick) => ({ line, pick, orphan: false }))),
    ...sheet.orphans.map((pick) => ({ line: null, pick, orphan: true })),
  ];
  const serialRows = recorded.flatMap(({ line, pick }) =>
    pick.serials.map((serial) => ({
      line,
      pick,
      serial,
    })),
  );
  const showSerials = open || serialRows.length > 0;
  const columnCount = open ? 11 : 10;

  return (
    <main className="page pick-page">
      <header className="pick-head">
        <div>
          <h1>{title}</h1>
          <p>{sheet.customer || "No customer"}</p>
          {sheet.customerPo ? <p className="muted">Customer PO {sheet.customerPo}</p> : null}
        </div>
        <div>
          <p className="pick-progress">
            {formatPickQty(progress.picked)} of {formatPickQty(progress.ordered)} picked
          </p>
          <p>{sheet.stagingBin ? `Staging bin ${sheet.stagingBin}` : "Staging bin opens with this sheet."}</p>
          <p className="muted">
            {stagingProjects.length > 0
              ? stagingProjects.join(", ")
              : "Project and ownership are copied on the first pick."}
          </p>
        </div>
      </header>

      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      {activePull ? (
        <p className="banner ok pick-pull-note" role="status">
          {pullCue(activePull)}
        </p>
      ) : null}
      {sheet.handoff ? (
        <p className="banner ok" role="status">
          {sheet.handoff}
        </p>
      ) : null}
      {!canPick ? <p className="muted">You can look at this sheet. Recording a pick is turned off for this sign-in.</p> : null}

      {open ? (
        <form className="card pick-scan" onSubmit={(event) => void onScan(event)}>
          <label>
            Scan a bin or serial
            <input
              id="pick-scan"
              value={scan}
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(event) => setScan(event.target.value.toUpperCase())}
            />
          </label>
          <button type="submit" disabled={busy || !scan.trim()}>
            Scan
          </button>
        </form>
      ) : null}

      <div className="card pick-table-wrap">
        <table className="pick-sheet">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th className="num">Ordered</th>
              <th className="num">Picked</th>
              <th>Still</th>
              <th>Bin</th>
              <th>Location</th>
              <th>Project</th>
              <th>Ownership</th>
              <th className="num">On hand</th>
              {open ? <th>Qty</th> : null}
            </tr>
          </thead>
          <tbody>
            {sheet.lines.map((line) => {
              const remaining = lineRemaining(line.ordered, line.picked);
              const bins = line.bins.length > 0 ? line.bins : [null];
              return bins.map((bin, index) => {
                const pulled = Boolean(bin && activePull?.allocationId === line.allocationId && activePull.binId === bin.binId);
                return (
                  <tr key={`${line.allocationId}:${bin?.binId ?? "none"}`} className={pulled ? "pick-pull" : undefined}>
                    {index === 0 ? (
                      <>
                        <td className="sku" rowSpan={bins.length}>
                          {line.sku}
                        </td>
                        <td rowSpan={bins.length}>{line.name}</td>
                        <td className="num" rowSpan={bins.length}>
                          {formatPickQty(line.ordered)}
                        </td>
                        <td className="num" rowSpan={bins.length}>
                          {formatPickQty(line.picked)}
                        </td>
                        <td rowSpan={bins.length}>
                          <span>
                            {formatPickQty(remaining)}
                            {line.short && remaining > 0 ? " · Short acknowledged" : ""}
                          </span>
                          {open && remaining > 0 ? (
                            <button
                              type="button"
                              className="secondary pick-short"
                              disabled={busy}
                              onClick={() => void run(() => setPickShort(sheet.orderId, line.allocationId, !line.short))}
                            >
                              {line.short ? "Clear short" : "Acknowledge short"}
                            </button>
                          ) : null}
                        </td>
                      </>
                    ) : null}
                    {bin ? (
                      <>
                        <td>
                          {bin.reference}
                          {pulled ? <span className="sr-only">Pulling from this bin</span> : null}
                        </td>
                        <td>{dash(bin.location)}</td>
                        <td>{dash(bin.project)}</td>
                        <td>{bin.ownership}</td>
                        <td className="num">{formatPickQty(bin.qty)}</td>
                        {open ? (
                          <td>
                            <div className="pick-qty-cell">
                              <input
                                aria-label={`Quantity from ${bin.reference}`}
                                inputMode="numeric"
                                value={qtyText[qtyKey(line.allocationId, bin.binId)] ?? ""}
                                onChange={(event) =>
                                  setQtyText((current) => ({
                                    ...current,
                                    [qtyKey(line.allocationId, bin.binId)]: event.target.value,
                                  }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    onLinePick(line, bin.binId, bin.qty);
                                  }
                                }}
                              />
                              <button type="button" disabled={busy} onClick={() => onLinePick(line, bin.binId, bin.qty)}>
                                Pick
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </>
                    ) : (
                      <td colSpan={open ? 6 : 5}>No open quantity for this SKU.</td>
                    )}
                  </tr>
                );
              });
            })}
            {sheet.lines.length === 0 ? (
              <tr>
                <td colSpan={columnCount}>No stock lines on this order.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {recorded.length > 0 ? (
        <div className="card pick-table-wrap">
          <table className="pick-sheet pick-recorded">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="num">Qty</th>
                <th>From</th>
                <th>Project</th>
                <th>Ownership</th>
                {open ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {recorded.map(({ line, pick, orphan }) => (
                <tr key={pick.id}>
                  <td className="sku">{line?.sku || ("sku" in pick ? pick.sku : null) || "SKU"}</td>
                  <td className="num">{formatPickQty(pick.qty)}</td>
                  <td>{dash(pick.fromBin)}</td>
                  <td>{dash(pick.project)}</td>
                  <td>{dash(pick.ownership)}</td>
                  {open ? (
                    <td>
                      <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => undoPick(pick.id))}>
                        Undo pick
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showSerials ? (
        <div className="card pick-table-wrap">
          <table className="pick-serials">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Serial</th>
                <th>COO</th>
                <th>From</th>
                {open ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {sheet.lines.flatMap((line) => {
                const rows = line.picks.flatMap((pick) => pick.serials.map((serial) => ({ pick, serial })));
                const entry = open ? (
                  <SerialEntryRow
                    key={`${line.allocationId}-entry`}
                    line={line}
                    busy={busy}
                    serial={serialText[line.allocationId] ?? ""}
                    coo={cooText[line.allocationId] ?? ""}
                    from={activePull?.allocationId === line.allocationId ? formatPullFrom(activePull.reference, activePull.location) : ""}
                    onSerial={(value) => setSerialText((current) => ({ ...current, [line.allocationId]: value }))}
                    onCoo={(value) => setCooText((current) => ({ ...current, [line.allocationId]: value }))}
                    onScan={() => void fillSerialLocation(serialText[line.allocationId] ?? "", line.allocationId)}
                    onAdd={() => void onAddSerial(line)}
                  />
                ) : null;
                return [
                  ...rows.map(({ pick, serial }) => (
                    <tr key={serial.id}>
                      <td className="sku">{line.sku}</td>
                      <td>{serial.serial}</td>
                      <td>{dash(serial.coo)}</td>
                      <td>{dash(pick.fromBin)}</td>
                      {open ? (
                        <td>
                          <div className="pick-icon-cell">
                            <button
                              type="button"
                              className="secondary icon-button"
                              aria-label="Remove serial"
                              title="Remove serial"
                              disabled={busy}
                              onClick={() => void run(() => removePickSerial(serial.id))}
                            >
                              <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  )),
                  entry,
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {sheet.skipped.length > 0 ? (
        <div className="card pick-table-wrap">
          <table className="pick-sheet">
            <thead>
              <tr>
                <th>Line</th>
                <th>SKU</th>
                <th>Name</th>
                <th>Not picked</th>
              </tr>
            </thead>
            <tbody>
              {sheet.skipped.map((row) => (
                <tr key={`${row.lineNo}-${row.sku ?? "none"}`}>
                  <td>{row.lineNo}</td>
                  <td className="sku">{dash(row.sku)}</td>
                  <td>{dash(row.name)}</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {open ? (
        <div className="pick-finish">
          <button id="pick-finish" type="button" disabled={busy || Boolean(sheet.finishBlock)} onClick={() => void run(() => finishPick(sheet.orderId))}>
            Finish pick
          </button>
          {sheet.finishBlock ? <p className="muted">{sheet.finishBlock}</p> : null}
        </div>
      ) : null}

      <p className="pick-links">
        <Link href="/warehouse/pick">All picks</Link>
        {" · "}
        <Link href={`/sales/orders/${sheet.orderId}`}>Sales order</Link>
      </p>
    </main>
  );
}

function SerialEntryRow({
  line,
  busy,
  serial,
  coo,
  from,
  onSerial,
  onCoo,
  onScan,
  onAdd,
}: {
  line: PickLine;
  busy: boolean;
  serial: string;
  coo: string;
  from: string;
  onSerial: (value: string) => void;
  onCoo: (value: string) => void;
  onScan: () => void;
  onAdd: () => void;
}) {
  return (
    <tr className="pick-serial-entry">
      <td className="sku">{line.sku}</td>
      <td>
        <input
          aria-label={`Serial for ${line.sku}`}
          value={serial}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onSerial(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onScan();
            }
          }}
        />
      </td>
      <td>
        <input
          className="pick-coo"
          aria-label={`Country of origin for ${line.sku}`}
          value={coo}
          placeholder={line.itemCoo || "USA"}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onCoo(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd();
            }
          }}
        />
      </td>
      <td>
        <input
          aria-label={`Pull from location for ${line.sku}`}
          value={from}
          readOnly
          placeholder="Location"
        />
      </td>
      <td>
        <div className="pick-icon-cell">
          <button
            type="button"
            className="secondary icon-button"
            aria-label="Add serial"
            title="Add serial"
            disabled={busy}
            onClick={onAdd}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </td>
    </tr>
  );
}
