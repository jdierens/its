"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { usePageMeta } from "@/components/AppShell";
import { SalesOrderStageNav } from "@/components/SalesOrderStageNav";
import {
  addPackagingType,
  addShippingBin,
  assignPackQty,
  finishPack,
  removePackAssignment,
  removeShippingBin,
  retirePackagingType,
  setShippingBinHeight,
  setShippingBinWeight,
} from "@/lib/packActions";
import { errorText } from "@/lib/errors";
import {
  formatBinSize,
  formatPackQty,
  packagingTypeError,
  packRoom,
  parseInches,
  parsePackQty,
  parsePackWeight,
  sheetPackProgress,
  shippingBinLabel,
  type PackLine,
  type PackSheetModel,
  type ShippingBin,
} from "@/lib/packSheet";

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

export function PackSheet({ initial, canPack }: { initial: PackSheetModel; canPack: boolean }) {
  const [sheet, setSheet] = useState(initial);
  const [typeId, setTypeId] = useState(initial.types[0]?.id ?? "");
  const [palletHeight, setPalletHeight] = useState("");
  const [qtyText, setQtyText] = useState<Record<string, string>>({});
  const [binChoice, setBinChoice] = useState<Record<string, string>>({});
  const [typeName, setTypeName] = useState("");
  const [typeKind, setTypeKind] = useState("box");
  const [typeLength, setTypeLength] = useState("");
  const [typeWidth, setTypeWidth] = useState("");
  const [typeHeight, setTypeHeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const editing = canPack && sheet.status === "packing";
  const progress = sheetPackProgress(sheet.lines);
  const title = sheet.soNumber ? `Pack SO${sheet.soNumber}` : "Pack";
  const selectedType = sheet.types.find((row) => row.id === typeId) ?? sheet.types[0] ?? null;

  usePageMeta({
    title,
    crumbs: [
      { label: "Warehouse" },
      { label: "Packing", href: "/warehouse/pack" },
      { label: title },
    ],
  });

  async function run(action: () => Promise<PackSheetModel>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      setSheet(await action());
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onAddBin() {
    const chosen = selectedType;
    if (!chosen) {
      setError("Add a packaging type before creating a shipping bin.");
      return;
    }
    if (chosen.kind === "pallet") {
      const parsed = parseInches(palletHeight, "the pallet height");
      if (!parsed.ok) {
        setError(parsed.message);
        return;
      }
    }
    const saved = await run(() =>
      addShippingBin({
        orderId: sheet.orderId,
        typeId: chosen.id,
        height: chosen.kind === "pallet" ? palletHeight : null,
      }),
    );
    if (saved) setPalletHeight("");
  }

  async function onAssign(line: PackLine) {
    const packageId = binChoice[line.allocationId] || sheet.bins[0]?.id;
    if (!packageId) {
      setError("Add a shipping bin before assigning a quantity.");
      return;
    }
    const room = packRoom(line.picked, line.packed, 0);
    const typed = qtyText[line.allocationId] ?? (room > 0 ? formatPackQty(room) : "");
    const parsed = parsePackQty(typed, room);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    const saved = await run(() => assignPackQty({ packageId, allocationId: line.allocationId, qty: parsed.qty }));
    if (!saved) return;
    setQtyText((current) => {
      const next = { ...current };
      delete next[line.allocationId];
      return next;
    });
  }

  async function onAddType() {
    const problem = packagingTypeError({
      name: typeName,
      kind: typeKind,
      length: typeLength,
      width: typeWidth,
      height: typeKind === "pallet" ? "" : typeHeight,
    });
    if (problem) {
      setError(problem);
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const types = await addPackagingType({
        name: typeName,
        kind: typeKind,
        length: typeLength,
        width: typeWidth,
        height: typeKind === "pallet" ? "" : typeHeight,
      });
      setSheet((current) => ({ ...current, types }));
      setTypeId(types[types.length - 1]?.id ?? typeId);
      setTypeName("");
      setTypeLength("");
      setTypeWidth("");
      setTypeHeight("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onRetireType(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const types = await retirePackagingType(id);
      setSheet((current) => ({ ...current, types }));
      setTypeId((current) => (current === id ? types[0]?.id ?? "" : current));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function saveWeight(bin: ShippingBin, value: string) {
    const current = bin.weightLb == null ? "" : formatPackQty(bin.weightLb);
    if (value.trim() === current) return;
    const parsed = parsePackWeight(value);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    void run(() => setShippingBinWeight(bin.id, parsed.weight));
  }

  function saveHeight(bin: ShippingBin, value: string) {
    const current = bin.heightIn == null ? "" : formatPackQty(bin.heightIn);
    if (value.trim() === current) return;
    const parsed = parseInches(value, "the pallet height");
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    void run(() => setShippingBinHeight(bin.id, parsed.inches));
  }

  return (
    <main className="page pick-page">
      <header className="pick-head">
        <div>
          <div className="pick-title">
            <h1>{title}</h1>
            <SalesOrderStageNav
              orderId={sheet.orderId}
              status={sheet.status}
              pickStatus={sheet.pickStatus}
              numbered={sheet.soNumber != null}
              current="pack"
            />
          </div>
          <p>{sheet.customer || "No customer"}</p>
          {sheet.customerPo ? <p className="muted">Customer PO {sheet.customerPo}</p> : null}
        </div>
        <p className="pick-progress">
          {formatPackQty(progress.packed)} of {formatPackQty(progress.picked)} packed
        </p>
      </header>

      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      {sheet.status === "packed" ? (
        <p className="banner ok" role="status">
          Packed. <Link href="/warehouse/ship">Shipping</Link> is next. Carrier labels and rate shopping are not on this screen.
        </p>
      ) : null}
      {!canPack ? <p className="muted">You can look at this sheet. Packing is turned off for this sign-in.</p> : null}

      <section className="card pick-table-wrap">
        <h2>Shipping bins</h2>
        {sheet.bins.length === 0 ? (
          <p className="muted">No shipping bins yet. Choose a box or a pallet from the list.</p>
        ) : (
          <table className="pick-sheet">
            <thead>
              <tr>
                <th>Bin</th>
                <th>Type</th>
                <th>Size</th>
                <th>Weight</th>
                {editing ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {sheet.bins.map((bin) => (
                <tr key={bin.id}>
                  <td className="pick-code">{shippingBinLabel(bin.kind, bin.number)}</td>
                  <td>{bin.typeName}</td>
                  <td className="pick-code">
                    {bin.kind === "pallet" && editing ? (
                      <span className="pick-qty-cell">
                        {formatPackQty(bin.lengthIn)} × {formatPackQty(bin.widthIn)} ×
                        <input
                          key={`${bin.id}-h-${bin.heightIn ?? ""}`}
                          className="pack-measure"
                          aria-label={`Height for ${shippingBinLabel(bin.kind, bin.number)}`}
                          defaultValue={bin.heightIn == null ? "" : formatPackQty(bin.heightIn)}
                          inputMode="decimal"
                          onBlur={(event) => saveHeight(bin, event.target.value)}
                        />
                        in
                      </span>
                    ) : (
                      formatBinSize(bin)
                    )}
                  </td>
                  <td className="pick-code">
                    {editing ? (
                      <input
                        className="pack-measure"
                        aria-label={`Weight for ${shippingBinLabel(bin.kind, bin.number)}`}
                        key={`${bin.id}-${bin.weightLb ?? ""}`}
                        defaultValue={bin.weightLb == null ? "" : formatPackQty(bin.weightLb)}
                        inputMode="decimal"
                        placeholder="lb"
                        onBlur={(event) => saveWeight(bin, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            saveWeight(bin, event.currentTarget.value);
                          }
                        }}
                      />
                    ) : (
                      bin.weightLb == null ? "—" : `${formatPackQty(bin.weightLb)} lb`
                    )}
                  </td>
                  {editing ? (
                    <td>
                      <div className="pick-icon-cell">
                        <button
                          type="button"
                          className="secondary icon-button"
                          aria-label={`Remove ${shippingBinLabel(bin.kind, bin.number)}`}
                          title={`Remove ${shippingBinLabel(bin.kind, bin.number)}`}
                          disabled={busy}
                          onClick={() => void run(() => removeShippingBin(bin.id))}
                        >
                          <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {editing ? (
          <div className="pack-add">
            <label>
              Packaging
              <select
                aria-label="Packaging type"
                value={selectedType?.id ?? ""}
                onChange={(event) => setTypeId(event.target.value)}
              >
                {sheet.types.length === 0 ? <option value="">No packaging types</option> : null}
                {sheet.types.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · {row.kind === "pallet"
                      ? `${formatPackQty(row.lengthIn)} × ${formatPackQty(row.widthIn)} in`
                      : formatBinSize(row)}
                  </option>
                ))}
              </select>
            </label>
            {selectedType?.kind === "pallet" ? (
              <label>
                Height
                <input
                  className="pack-measure"
                  aria-label="Pallet height in inches"
                  value={palletHeight}
                  inputMode="decimal"
                  placeholder="in"
                  onChange={(event) => setPalletHeight(event.target.value)}
                />
              </label>
            ) : null}
            <button
              type="button"
              className="secondary icon-button"
              aria-label="Add shipping bin"
              title="Add shipping bin"
              disabled={busy || !selectedType}
              onClick={() => void onAddBin()}
            >
              <Plus size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        ) : null}
      </section>

      <section className="card pick-table-wrap">
        <h2>Picked lines</h2>
        {sheet.lines.length === 0 ? (
          <p className="muted">Nothing picked is waiting to pack. Freight and service lines stay off this sheet.</p>
        ) : (
          <table className="pick-sheet">
            <thead>
              <tr>
                <th className="sku">SKU</th>
                <th>Name</th>
                <th className="num">Picked</th>
                <th className="num">Packed</th>
                <th>Bin</th>
                {editing ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {sheet.lines.map((line) => {
                const chosen = binChoice[line.allocationId] || sheet.bins[0]?.id || "";
                const room = packRoom(line.picked, line.packed, 0);
                return (
                  <tr key={line.allocationId}>
                    <td className="sku">
                      <span className="pick-sku-cell">
                        {line.sku}
                        {line.replaced ? <span className="pick-planned">Planned {line.plannedSku}</span> : null}
                      </span>
                    </td>
                    <td>{dash(line.name)}</td>
                    <td className="num">{formatPackQty(line.picked)}</td>
                    <td className="num">
                      {formatPackQty(line.packed)}
                      {line.assignments.length > 0 ? (
                        <span className="pick-planned">
                          {line.assignments
                            .map((row) => `${shippingBinLabel(row.kind, row.binNumber)} ${formatPackQty(row.qty)}`)
                            .join(", ")}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {editing && sheet.bins.length > 0 ? (
                        <span className="pick-qty-cell">
                          <select
                            aria-label={`Shipping bin for ${line.sku}`}
                            value={chosen}
                            onChange={(event) =>
                              setBinChoice((current) => ({ ...current, [line.allocationId]: event.target.value }))
                            }
                          >
                            {sheet.bins.map((bin) => (
                              <option key={bin.id} value={bin.id}>
                                {shippingBinLabel(bin.kind, bin.number)}
                              </option>
                            ))}
                          </select>
                          <input
                            className="pack-measure"
                            aria-label={`Quantity for ${line.sku}`}
                            value={qtyText[line.allocationId] ?? (room > 0 ? formatPackQty(room) : "")}
                            inputMode="numeric"
                            onChange={(event) =>
                              setQtyText((current) => ({ ...current, [line.allocationId]: event.target.value }))
                            }
                          />
                        </span>
                      ) : line.assignments.length === 0 ? (
                        "—"
                      ) : (
                        line.assignments
                          .map((row) => `${shippingBinLabel(row.kind, row.binNumber)} ${formatPackQty(row.qty)}`)
                          .join(", ")
                      )}
                    </td>
                    {editing ? (
                      <td>
                        <div className="pick-icon-cell">
                          <button
                            type="button"
                            className="secondary icon-button"
                            aria-label={`Assign ${line.sku}`}
                            title={`Assign ${line.sku}`}
                            disabled={busy || sheet.bins.length === 0}
                            onClick={() => void onAssign(line)}
                          >
                            <Plus size={16} strokeWidth={1.75} aria-hidden />
                          </button>
                          {line.assignments.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              className="secondary icon-button"
                              aria-label={`Remove ${line.sku} from ${shippingBinLabel(row.kind, row.binNumber)}`}
                              title={`Remove ${line.sku} from ${shippingBinLabel(row.kind, row.binNumber)}`}
                              disabled={busy}
                              onClick={() => void run(() => removePackAssignment(row.id))}
                            >
                              <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                            </button>
                          ))}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {editing && sheet.bins.length === 0 && sheet.lines.length > 0 ? (
          <p className="muted">Add a shipping bin, then assign what was picked. A line can split across bins.</p>
        ) : null}
      </section>

      <section className="card pick-table-wrap">
        <h2>Packaging types</h2>
        {sheet.types.length === 0 ? (
          <p className="muted">The list is empty. Add a box or a pallet.</p>
        ) : (
          <table className="pick-sheet">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Size</th>
                {canPack ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {sheet.types.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td className="pick-code">{row.kind === "pallet" ? "Pallet" : "Box"}</td>
                  <td className="pick-code">
                    {row.kind === "pallet"
                      ? `${formatPackQty(row.lengthIn)} × ${formatPackQty(row.widthIn)} in, height at packing`
                      : formatBinSize(row)}
                  </td>
                  {canPack ? (
                    <td>
                      <div className="pick-icon-cell">
                        <button
                          type="button"
                          className="secondary icon-button"
                          aria-label={`Remove ${row.name}`}
                          title={`Remove ${row.name}`}
                          disabled={busy}
                          onClick={() => void onRetireType(row.id)}
                        >
                          <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canPack ? (
          <div className="pack-add">
            <label>
              Name
              <input aria-label="Packaging name" value={typeName} onChange={(event) => setTypeName(event.target.value)} />
            </label>
            <label>
              Kind
              <select aria-label="Packaging kind" value={typeKind} onChange={(event) => setTypeKind(event.target.value)}>
                <option value="box">Box</option>
                <option value="pallet">Pallet</option>
              </select>
            </label>
            <label>
              Length
              <input
                className="pack-measure"
                aria-label="Length in inches"
                value={typeLength}
                inputMode="decimal"
                onChange={(event) => setTypeLength(event.target.value)}
              />
            </label>
            <label>
              Width
              <input
                className="pack-measure"
                aria-label="Width in inches"
                value={typeWidth}
                inputMode="decimal"
                onChange={(event) => setTypeWidth(event.target.value)}
              />
            </label>
            {typeKind === "box" ? (
              <label>
                Height
                <input
                  className="pack-measure"
                  aria-label="Height in inches"
                  value={typeHeight}
                  inputMode="decimal"
                  onChange={(event) => setTypeHeight(event.target.value)}
                />
              </label>
            ) : (
              <p className="muted">Height is entered when the pallet is packed.</p>
            )}
            <button
              type="button"
              className="secondary icon-button"
              aria-label="Add packaging type"
              title="Add packaging type"
              disabled={busy}
              onClick={() => void onAddType()}
            >
              <Plus size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        ) : null}
      </section>

      {editing ? (
        <div className="pick-finish">
          <button
            id="pack-finish"
            type="button"
            disabled={busy || Boolean(sheet.finishBlock)}
            onClick={() => void run(() => finishPack(sheet.orderId))}
          >
            Finish packing
          </button>
          {sheet.finishBlock ? <p className="muted">{sheet.finishBlock}</p> : null}
        </div>
      ) : null}

      <p className="pick-links">
        <Link href="/warehouse/pack">All packing</Link>
        {" · "}
        <Link href={`/warehouse/pick/${sheet.orderId}`}>Pick sheet</Link>
        {" · "}
        <Link href={`/sales/orders/${sheet.orderId}`}>Sales order</Link>
        {sheet.status === "packed" ? (
          <>
            {" · "}
            <Link href="/warehouse/ship">Shipping</Link>
          </>
        ) : null}
      </p>
    </main>
  );
}
