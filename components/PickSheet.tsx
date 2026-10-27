"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { usePageMeta } from "@/components/AppShell";
import {
  finishPick,
  recordPick,
  recordPickSerial,
  removePickSerial,
  setPickShort,
  undoPick,
} from "@/lib/pickActions";
import { errorText } from "@/lib/errors";
import { cooProblem } from "@/lib/stockUnits";
import {
  formatPickQty,
  lineRemaining,
  parsePickQty,
  pickTargetForBin,
  serialAttachError,
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

export function PickSheet({ initial, canPick }: { initial: PickSheetModel; canPick: boolean }) {
  const [sheet, setSheet] = useState(initial);
  const [qtyText, setQtyText] = useState<Record<string, string>>({});
  const [serialText, setSerialText] = useState<Record<string, string>>({});
  const [cooText, setCooText] = useState<Record<string, string>>({});
  const [scan, setScan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = canPick && sheet.pickStatus === "open";
  const progress = sheetProgress(sheet.lines);
  const title = sheet.soNumber ? `Pick SO${sheet.soNumber}` : "Pick sheet";

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

  async function onScan(event: FormEvent) {
    event.preventDefault();
    const target = pickTargetForBin(
      sheet.lines.map((line) => ({
        allocationId: line.allocationId,
        remaining: lineRemaining(line.ordered, line.picked),
        bins: line.bins,
      })),
      scan,
    );
    if (!target) {
      setError("That bin is not on this pick.");
      return;
    }
    setScan("");
    await pickQty(target.allocationId, target.binId, target.qty);
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

  function onSerial(pickId: string, sku: string, picked: number, attached: number) {
    const message = serialAttachError({
      serial: serialText[pickId] ?? "",
      sku,
      existing: itemSerials(sheet, sku),
      attached,
      picked,
    });
    if (message) {
      setError(message);
      return;
    }
    const country = cooProblem(cooText[pickId] ?? "");
    if (country) {
      setError(country);
      return;
    }
    const serial = (serialText[pickId] ?? "").trim();
    const coo = (cooText[pickId] ?? "").trim();
    void run(async () => {
      const next = await recordPickSerial(pickId, serial, coo);
      setSerialText((current) => ({ ...current, [pickId]: "" }));
      setCooText((current) => ({ ...current, [pickId]: "" }));
      return next;
    });
  }

  const stagingProjects = [
    ...new Set(
      sheet.staging.map((row) => `${row.project ?? "No project"}${row.ownership ? ` · ${row.ownership}` : ""}`),
    ),
  ];

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
      {sheet.handoff ? (
        <p className="banner ok" role="status">
          {sheet.handoff}
        </p>
      ) : null}
      {!canPick ? <p className="muted">You can look at this sheet. Recording a pick is turned off for this sign-in.</p> : null}

      {open ? (
        <form className="card pick-scan" onSubmit={(event) => void onScan(event)}>
          <label>
            Scan a bin
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
            Pick scanned bin
          </button>
        </form>
      ) : null}

      {sheet.lines.map((line) => {
        const remaining = lineRemaining(line.ordered, line.picked);
        return (
          <section className="card pick-line" key={line.allocationId}>
            <header>
              <h2>
                <span className="sku">{line.sku}</span> {line.name}
              </h2>
              <p>
                Ordered {formatPickQty(line.ordered)} · Picked {formatPickQty(line.picked)} · Still{" "}
                {formatPickQty(remaining)}
                {line.short && remaining > 0 ? " · Short acknowledged" : ""}
              </p>
            </header>

            {line.bins.length === 0 ? (
              <p className="muted">No open quantity for this SKU.</p>
            ) : (
              <table className="pick-bins">
                <thead>
                  <tr>
                    <th>Bin</th>
                    <th>Location</th>
                    <th>Project</th>
                    <th>Ownership</th>
                    <th>On hand</th>
                    {open ? <th>Qty</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {line.bins.map((bin) => (
                    <tr key={bin.binId}>
                      <td>{bin.reference}</td>
                      <td>{bin.location || "—"}</td>
                      <td>{bin.project || "—"}</td>
                      <td>{bin.ownership}</td>
                      <td>{formatPickQty(bin.qty)}</td>
                      {open ? (
                        <td className="pick-qty-cell">
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
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {line.picks.length > 0 ? (
              <ul className="pick-done">
                {line.picks.map((pick) => (
                  <li key={pick.id}>
                    <div>
                      {formatPickQty(pick.qty)} from {pick.fromBin || "—"}
                      {pick.project ? ` · ${pick.project}` : ""}
                      {pick.ownership ? ` · ${pick.ownership}` : ""}
                    </div>
                    {pick.serials.length > 0 ? (
                      <ul>
                        {pick.serials.map((serial) => (
                          <li key={serial.id}>
                            {serial.serial}
                            {serial.coo ? ` · ${serial.coo}` : ""}
                            {open ? (
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy}
                                onClick={() => void run(() => removePickSerial(serial.id))}
                              >
                                Remove serial
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {open ? (
                      <div className="pick-serial-row">
                        <label>
                          Serial, optional
                          <input
                            aria-label={`Serial for ${line.sku} from ${pick.fromBin || "bin"}`}
                            value={serialText[pick.id] ?? ""}
                            autoComplete="off"
                            onChange={(event) =>
                              setSerialText((current) => ({ ...current, [pick.id]: event.target.value }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                onSerial(pick.id, line.sku, pick.qty, pick.serials.length);
                              }
                            }}
                          />
                        </label>
                        <label>
                          COO, optional
                          <input
                            className="pick-coo"
                            aria-label={`Country of origin for ${line.sku} from ${pick.fromBin || "bin"}`}
                            value={cooText[pick.id] ?? ""}
                            placeholder={line.itemCoo || "USA"}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(event) =>
                              setCooText((current) => ({ ...current, [pick.id]: event.target.value.toUpperCase() }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                onSerial(pick.id, line.sku, pick.qty, pick.serials.length);
                              }
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => onSerial(pick.id, line.sku, pick.qty, pick.serials.length)}
                        >
                          Add serial
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => void run(() => undoPick(pick.id))}
                        >
                          Undo pick
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {open && remaining > 0 ? (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void run(() => setPickShort(sheet.orderId, line.allocationId, !line.short))}
              >
                {line.short ? "Clear short" : "Acknowledge short"}
              </button>
            ) : null}
          </section>
        );
      })}

      {sheet.orphans.length > 0 ? (
        <section className="card pick-line">
          <h2>Picks no longer on a line</h2>
          <ul className="pick-done">
            {sheet.orphans.map((pick) => (
              <li key={pick.id}>
                {formatPickQty(pick.qty)} of {pick.sku || "SKU"} from {pick.fromBin || "—"}
                {open ? (
                  <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => undoPick(pick.id))}>
                    Undo pick
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sheet.skipped.length > 0 ? (
        <section className="pick-skipped">
          <h2>Not picked</h2>
          <ul>
            {sheet.skipped.map((row) => (
              <li key={`${row.lineNo}-${row.sku ?? "none"}`}>
                Line {row.lineNo}
                {row.sku ? ` ${row.sku}` : ""} {row.name ? ` ${row.name}` : ""} — {row.reason}
              </li>
            ))}
          </ul>
        </section>
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
