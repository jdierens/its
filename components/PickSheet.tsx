"use client";

import { Plus, Printer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { usePageMeta } from "@/components/AppShell";
import { ReplaceSkuPicker } from "@/components/ReplaceSkuPicker";
import {
  finishPick,
  lookupPickSerial,
  assignPickStagingBin,
  recordPick,
  recordPickSerial,
  removePickSerial,
  setPickReplacement,
  setPickShort,
  undoPick,
} from "@/lib/pickActions";
import { errorText } from "@/lib/errors";
import { SALES_ORDER_REFERENCE_LABEL } from "@/lib/salesOrderDraft";
import { formatPullFrom, pullCue, type SerialPull } from "@/lib/pickSerialLocation";
import { cooProblem } from "@/lib/stockUnits";
import {
  formatPickQty,
  lineRemaining,
  parsePickQty,
  pickTargetForBin,
  serialProblem,
  omitPickTicketSku,
  sheetProgress,
  stagingBinCode,
  stagingLabel,
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
  const [stageScan, setStageScan] = useState("");
  const [replaceId, setReplaceId] = useState<string | null>(null);
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

  const recorded = [
    ...sheet.lines.flatMap((line) => line.picks.map((pick) => ({ line, pick }))),
    ...sheet.orphans.map((pick) => ({ line: null, pick })),
  ];
  const serialRows = recorded.flatMap(({ line, pick }) =>
    pick.serials.map((serial) => ({
      line,
      pick,
      serial,
    })),
  );
  const showSerials = open || serialRows.length > 0;
  const ticketLines = sheet.lines.filter((line) => !omitPickTicketSku(line.sku));

  return (
    <main className="page pick-page">
      <header className="pick-head">
        <div>
          <h1>{title}</h1>
          <p>{sheet.customer || "No customer"}</p>
          {sheet.orderReference ? (
            <p className="muted">{SALES_ORDER_REFERENCE_LABEL} {sheet.orderReference}</p>
          ) : null}
        </div>
        <div>
          <p className="pick-progress">
            {formatPickQty(progress.picked)} of {formatPickQty(progress.ordered)} picked
          </p>
          <p>{sheet.stagingBin ? `Staging bin ${sheet.stagingBin}` : stagingLabel(sheet.soNumber)}</p>
          <button type="button" className="secondary no-print" onClick={() => window.print()}>
            <Printer size={16} strokeWidth={1.75} aria-hidden />
            Print ticket
          </button>
        </div>
      </header>
      {open && !sheet.stagingBin ? (
        <form
          className="card pick-scan no-print"
          onSubmit={(event) => {
            event.preventDefault();
            const code = stagingBinCode(stageScan);
            if (!code) {
              setError("A bin code is five digits, a hyphen, and B, C, or P.");
              return;
            }
            setStageScan("");
            void run(() => assignPickStagingBin(sheet.orderId, code));
          }}
        >
          <label>
            Scan an existing staging bin
            <input
              aria-label="Existing staging bin"
              value={stageScan}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="20018-B"
              onChange={(event) => setStageScan(event.target.value.toUpperCase())}
            />
          </label>
          <button type="submit" disabled={busy || !stageScan.trim()}>
            Use bin
          </button>
          <p className="hint">Leave this blank to keep {stagingLabel(sheet.soNumber)}. Scanning does not create a bin.</p>
        </form>
      ) : null}

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
      {sheet.pickStatus === "picked" || sheet.pickStatus === "short" ? (
        <p className="banner ok" role="status">
          {sheet.pickStatus === "short" ? "Short pick is recorded." : "Picked into the staging bin."}{" "}
          <Link href={`/warehouse/pack/${sheet.orderId}`}>Pack this order</Link>
        </p>
      ) : sheet.handoff ? (
        <p className="banner ok" role="status">
          {sheet.handoff}
        </p>
      ) : null}
      {!canPick ? <p className="muted">You can look at this sheet. Recording a pick is turned off for this sign-in.</p> : null}

      {open ? (
        <form className="card pick-scan no-print" onSubmit={(event) => void onScan(event)}>
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

      {replaceId ? (
        <ReplaceSkuPicker
          plannedItemId={sheet.lines.find((line) => line.allocationId === replaceId)?.plannedItemId || replaceId}
          onCancel={() => setReplaceId(null)}
          onChoose={(hit, reason) => {
            const allocationId = replaceId;
            void run(async () => {
              const next = await setPickReplacement({
                allocationId,
                actualItemId: hit.id,
                reason,
              });
              setReplaceId(null);
              return next;
            });
          }}
        />
      ) : null}

      <div className="card pick-table-wrap">
        <table className="pick-sheet pick-ticket">
          <colgroup>
            <col className="pick-col-sku" />
            <col className="pick-col-name" />
            <col className="pick-col-ordered" />
            <col className="pick-col-picked" />
            <col className="pick-col-pending" />
          </colgroup>
          <thead>
            <tr className="pick-head-item">
              <th>SKU</th>
              <th>Name</th>
              <th className="num">Ordered</th>
              <th className="num">Picked</th>
              <th className="num">Pending</th>
            </tr>
          </thead>
          {ticketLines.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={5}>No stock lines on this order.</td>
              </tr>
            </tbody>
          ) : (
            ticketLines.map((line) => {
              const remaining = lineRemaining(line.ordered, line.picked);
              const bins = line.bins.length > 0 ? line.bins : [null];
              return (
                <tbody key={line.allocationId} className="pick-line-group">
                  <tr className="pick-item">
                    <td className="sku">
                      <span className="pick-sku-cell">
                        <span>{line.sku}</span>
                        {line.replaced ? (
                          <span className="pick-planned">
                            Planned {line.plannedSku}
                            {line.plannedName ? ` ${line.plannedName}` : ""}
                            {line.swapReason ? ` · ${line.swapReason}` : ""}
                          </span>
                        ) : null}
                        {open && sheet.allowReplacement && line.picked < 1 ? (
                          <span className="pick-icon-cell">
                            <button
                              type="button"
                              className="secondary icon-button"
                              aria-label={`Replace SKU ${line.plannedSku || line.sku}`}
                              title="Replace SKU"
                              disabled={busy}
                              onClick={() => setReplaceId(line.allocationId)}
                            >
                              <Plus size={16} strokeWidth={1.75} aria-hidden />
                            </button>
                            {line.replaced ? (
                              <button
                                type="button"
                                className="secondary icon-button"
                                aria-label={`Clear replacement for ${line.plannedSku || line.sku}`}
                                title="Clear replacement"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    const next = await setPickReplacement({
                                      allocationId: line.allocationId,
                                      actualItemId: null,
                                      reason: "",
                                    });
                                    setReplaceId(null);
                                    return next;
                                  })
                                }
                              >
                                <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                              </button>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="pick-name">{line.name}</td>
                    <td className="num">{formatPickQty(line.ordered)}</td>
                    <td className="num">{formatPickQty(line.picked)}</td>
                    <td className="num">
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
                  </tr>
                  <tr className="pick-head-bin">
                    <th scope="col">Bin</th>
                    <th scope="col">Location</th>
                    <th scope="col" className="num">QOH</th>
                    <th scope="col" className="num">Pick qty</th>
                    <th scope="col" className="num">Action</th>
                  </tr>
                  {bins.map((bin) => {
                    const pulled = Boolean(bin && activePull?.allocationId === line.allocationId && activePull.binId === bin.binId);
                    if (!bin) {
                      return (
                        <tr key={`${line.allocationId}:none`} className="pick-bin">
                          <td className="pick-code" colSpan={5}>
                            No open quantity for this SKU.
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={`${line.allocationId}:${bin.binId}`} className={pulled ? "pick-bin pick-pull" : "pick-bin"}>
                        <td className="pick-code" aria-label={`Bin ${bin.reference}`}>
                          {bin.reference}
                          {pulled ? <span className="sr-only">Pulling from this bin</span> : null}
                        </td>
                        <td className="pick-code" aria-label={`Location ${bin.location || "none"}`}>
                          {dash(bin.location)}
                        </td>
                        <td className="num pick-code" aria-label={`On hand ${formatPickQty(bin.qty)}`}>
                          {formatPickQty(bin.qty)}
                        </td>
                        <td className="num">
                          {open ? (
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
                            </div>
                          ) : null}
                        </td>
                        <td className="pick-action-cell">
                          {open ? (
                            <button type="button" className="pick-action no-print" disabled={busy} onClick={() => onLinePick(line, bin.binId, bin.qty)}>
                              Pick
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })
          )}
        </table>
      </div>

      {recorded.length > 0 ? (
        <div className="card pick-table-wrap pick-recorded-wrap">
          <table className="pick-sheet pick-recorded">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="num">Qty</th>
                <th>From</th>
                {open ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {recorded.map(({ line, pick }) => (
                <tr key={pick.id}>
                  <td className="sku">
                    {line?.sku || ("sku" in pick ? pick.sku : null) || "SKU"}
                    {line?.replaced ? <span className="pick-planned">Planned {line.plannedSku}</span> : null}
                  </td>
                  <td className="num pick-code">{formatPickQty(pick.qty)}</td>
                  <td className="pick-code">{dash(pick.fromBin)}</td>
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
        <div className="card pick-table-wrap no-print">
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
                      <td className="pick-code">{dash(serial.coo)}</td>
                      <td className="pick-code">{dash(pick.fromBin)}</td>
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

      {open ? (
        <div className="pick-finish no-print">
          <button id="pick-finish" type="button" disabled={busy || Boolean(sheet.finishBlock)} onClick={() => void run(() => finishPick(sheet.orderId))}>
            Finish pick
          </button>
          {sheet.finishBlock ? <p className="muted">{sheet.finishBlock}</p> : null}
        </div>
      ) : null}

      <p className="pick-links no-print">
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
          className="pick-from"
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
