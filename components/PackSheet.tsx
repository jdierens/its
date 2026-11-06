"use client";

import { Copy, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePageMeta } from "@/components/AppShell";
import { SalesOrderStageNav } from "@/components/SalesOrderStageNav";
import {
  addPackagingType,
  addShippingBin,
  assignPackQty,
  assignPackSerial,
  duplicateShippingBin,
  finishPack,
  releasePackItemQty,
  removePackSerial,
  removeShippingBin,
  retirePackagingType,
  setPackItemContent,
  setShippingBinHeight,
  setShippingBinWeight,
} from "@/lib/packActions";
import { errorText } from "@/lib/errors";
import { isSaveShortcut } from "@/lib/formDirty";
import {
  duplicatePackBlock,
  explainPackEdit,
  formatBinSize,
  formatPackQty,
  orderHasPackSerials,
  packAssignmentLabel,
  packCatchUpNote,
  packCompleteBlock,
  packagingTypeError,
  packedAfterShipNote,
  packFinishVisible,
  packMatrixQtyAction,
  packOverview,
  packPackedSerials,
  packSaveState,
  packSerialLabel,
  packSerialMatch,
  packSheetEditable,
  parseInches,
  parsePackWeight,
  sheetPackProgress,
  shippingBinLabel,
  type PackagingType,
  type PackLine,
  type PackSheetModel,
  type ShippingBin,
} from "@/lib/packSheet";

const NEW_PACKAGING_TYPE = "__new";

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

export function PackSheet({ initial, canPack }: { initial: PackSheetModel; canPack: boolean }) {
  const [sheet, setSheet] = useState(initial);
  const [typeId, setTypeId] = useState(initial.types[0]?.id ?? NEW_PACKAGING_TYPE);
  const [palletHeight, setPalletHeight] = useState("");
  const [typeName, setTypeName] = useState("");
  const [typeKind, setTypeKind] = useState("box");
  const [typeLength, setTypeLength] = useState("");
  const [typeWidth, setTypeWidth] = useState("");
  const [typeHeight, setTypeHeight] = useState("");
  const [catalogName, setCatalogName] = useState("");
  const [catalogKind, setCatalogKind] = useState("box");
  const [catalogLength, setCatalogLength] = useState("");
  const [catalogWidth, setCatalogWidth] = useState("");
  const [catalogHeight, setCatalogHeight] = useState("");
  const [serialText, setSerialText] = useState("");
  const [serialBinId, setSerialBinId] = useState(initial.bins[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const finishingRef = useRef(false);
  const editing = packSheetEditable({
    canPack,
    status: sheet.status,
    packedAt: sheet.packedAt,
    serverEditable: sheet.editable,
    pickStatus: sheet.pickStatus,
  });
  const showFinish = editing && packFinishVisible({
    status: sheet.status,
    packedAt: sheet.packedAt,
    finishBlock: sheet.finishBlock,
  });
  const catchUp = editing && !sheet.packedAt ? packCatchUpNote(sheet.status) : null;
  const stayedShipped = sheet.packedAt ? packedAfterShipNote(sheet.status) : null;
  const correction = editing && !sheet.finishBlock ? " Bins, weights, and quantities can still be corrected." : "";
  const progress = sheetPackProgress(sheet.lines);
  const title = sheet.soNumber ? `Pack SO${sheet.soNumber}` : "Pack";
  const creatingType = typeId === NEW_PACKAGING_TYPE || !sheet.types.some((row) => row.id === typeId);
  const selectedType = sheet.types.find((row) => row.id === typeId) ?? null;
  const needsPalletHeight = creatingType ? typeKind === "pallet" : selectedType?.kind === "pallet";
  const serialsAvailable = orderHasPackSerials(sheet.lines);
  const serialPackageId = sheet.bins.some((bin) => bin.id === serialBinId) ? serialBinId : sheet.bins[0]?.id ?? "";
  const packedSerials = packPackedSerials(sheet.lines);
  const liveBlock = packCompleteBlock(
    sheet.lines.map((line) => ({
      lineNo: line.lineNo,
      sku: line.sku,
      picked: line.picked,
      packed: line.packed,
    })),
    sheet.bins.map((bin) => ({
      number: bin.number,
      kind: bin.kind,
      weightLb: bin.weightLb,
      heightIn: bin.heightIn,
    })),
  );
  const save = packSaveState({
    editable: editing,
    packedAt: sheet.packedAt,
    finishBlock: sheet.finishBlock,
    finishing,
  });
  const canFinish = save.dirty && showFinish && !busy && !finishing;
  const canFinishRef = useRef(canFinish);
  const finishRef = useRef<() => void>(() => undefined);
  canFinishRef.current = canFinish;

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
      setError(explainPackEdit(errorText(cause)));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onFinish() {
    if (finishingRef.current || busyRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    await run(() => finishPack(sheet.orderId));
    finishingRef.current = false;
    setFinishing(false);
  }

  finishRef.current = () => {
    void onFinish();
  };

  useEffect(() => {
    if (!editing) return;
    function onKey(event: KeyboardEvent) {
      if (!isSaveShortcut(event)) return;
      event.preventDefault();
      if (!canFinishRef.current) return;
      finishRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  async function ensurePackagingType(): Promise<PackagingType | null> {
    if (!creatingType && selectedType) return selectedType;
    const problem = packagingTypeError({
      name: typeName,
      kind: typeKind,
      length: typeLength,
      width: typeWidth,
      height: typeKind === "pallet" ? "" : typeHeight,
    });
    if (problem) {
      setError(problem);
      return null;
    }
    if (busyRef.current) return null;
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
      const created = types[types.length - 1] ?? null;
      setSheet((current) => ({ ...current, types }));
      if (created) setTypeId(created.id);
      setTypeName("");
      setTypeLength("");
      setTypeWidth("");
      setTypeHeight("");
      return created;
    } catch (cause) {
      setError(errorText(cause));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onAddPackage() {
    const kind = creatingType ? typeKind : selectedType?.kind;
    if (kind === "pallet") {
      const parsed = parseInches(palletHeight, "the pallet height");
      if (!parsed.ok) {
        setError(parsed.message);
        return;
      }
    }
    const chosen = await ensurePackagingType();
    if (!chosen) return;
    const saved = await run(() =>
      addShippingBin({
        orderId: sheet.orderId,
        typeId: chosen.id,
        height: chosen.kind === "pallet" ? palletHeight : null,
      }),
    );
    if (saved) setPalletHeight("");
  }

  async function onAddType() {
    const problem = packagingTypeError({
      name: catalogName,
      kind: catalogKind,
      length: catalogLength,
      width: catalogWidth,
      height: catalogKind === "pallet" ? "" : catalogHeight,
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
        name: catalogName,
        kind: catalogKind,
        length: catalogLength,
        width: catalogWidth,
        height: catalogKind === "pallet" ? "" : catalogHeight,
      });
      setSheet((current) => ({ ...current, types }));
      setTypeId(types[types.length - 1]?.id ?? typeId);
      setCatalogName("");
      setCatalogLength("");
      setCatalogWidth("");
      setCatalogHeight("");
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
      setTypeId((current) => (current === id ? types[0]?.id ?? NEW_PACKAGING_TYPE : current));
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

  function onMatrixQty(line: PackLine, binId: string, qtyText: string) {
    const action = packMatrixQtyAction(line, binId, qtyText);
    if (action.type === "error") {
      setError(action.message);
      return;
    }
    if (action.type === "noop") {
      setError(null);
      return;
    }
    if (action.type === "assign") {
      void run(() => assignPackQty({ packageId: action.packageId, allocationId: action.allocationId, qty: action.qty }));
      return;
    }
    if (action.type === "set") {
      void run(() =>
        setPackItemContent({
          contentId: action.contentId,
          allocationId: action.allocationId,
          qty: action.looseQty,
        }),
      );
      return;
    }
    void run(() => releasePackItemQty(action.contentId));
  }

  async function onAddSerial(binId: string, serial: string): Promise<boolean> {
    const match = packSerialMatch(sheet.lines, serial);
    if (!match.ok) {
      setError(match.message);
      return false;
    }
    return run(() => assignPackSerial({ packageId: binId, serial }));
  }

  const finishTitle = save.dirty ? "Finish packing (Ctrl/Cmd+S)" : "No unsaved changes";

  return (
    <main className="page pick-page ds">
      {editing ? (
        <div className="so-sticky pick-savebar no-print">
          <div className="so-sticky-lead">
            <div className="so-identity">
              <span className="sku">{title}</span>
              <SalesOrderStageNav
                orderId={sheet.orderId}
                status={sheet.status}
                pickStatus={sheet.pickStatus}
                numbered={sheet.soNumber != null}
                current="pack"
              />
            </div>
            <span className="hint" role="status">
              {save.hint}
            </span>
          </div>
          <div className="so-sticky-actions">
            <button
              id="pack-finish"
              className="so-icon-action"
              type="button"
              disabled={!canFinish}
              aria-label="Finish packing"
              title={finishTitle}
              onClick={() => void onFinish()}
            >
              <Save size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

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
      {sheet.status === "packed" && !sheet.finishBlock ? (
        <p className="banner ok" role="status">
          Packed.{correction} <Link href="/warehouse/ship">Shipping</Link> is next. Carrier labels and rate shopping are not on this screen.
        </p>
      ) : null}
      {stayedShipped && !sheet.finishBlock ? (
        <p className="banner ok" role="status">
          {stayedShipped}
          {correction}
        </p>
      ) : null}
      {catchUp ? (
        <p className="banner warn" role="status">
          {catchUp}
        </p>
      ) : null}
      {sheet.packedAt && liveBlock && !sheet.finishBlock ? (
        <p className="banner warn" role="status">
          {liveBlock}
        </p>
      ) : null}
      {sheet.finishBlock ? <p className="muted">{sheet.finishBlock}</p> : null}
      {!canPack ? <p className="muted">You can look at this sheet. Packing is turned off for this sign-in.</p> : null}

      {sheet.lines.length > 0 ? (
        <section className="card pick-table-wrap">
          <h2>Overview</h2>
          <table className="pick-sheet pack-overview" aria-label="Pack overview">
            <thead>
              <tr>
                <th className="sku">SKU</th>
                <th>Name</th>
                <th className="num">Picked</th>
                <th className="num">Remaining</th>
                {sheet.bins.map((bin) => (
                  <th key={bin.id} className="num">
                    {shippingBinLabel(bin.kind, bin.number)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {packOverview(sheet.lines, sheet.bins).map((row) => {
                const line = sheet.lines.find((candidate) => candidate.allocationId === row.allocationId);
                return (
                  <tr key={row.allocationId}>
                    <td className="sku">
                      {row.sku}
                      {row.replaced ? <span className="pick-planned">Planned {row.plannedSku}</span> : null}
                    </td>
                    <td>{dash(row.name)}</td>
                    <td className="num">{formatPackQty(row.picked)}</td>
                    <td className="num">{formatPackQty(row.remaining)}</td>
                    {row.packedByBin.map((cell) => {
                      const bin = sheet.bins.find((candidate) => candidate.id === cell.binId);
                      const label = bin ? shippingBinLabel(bin.kind, bin.number) : "package";
                      return (
                        <td
                          key={cell.binId}
                          className="num"
                          title={cell.qty > 0 ? packAssignmentLabel(bin?.kind ?? "box", bin?.number ?? 0, cell.qty) : undefined}
                        >
                          {editing && line && bin ? (
                            <>
                              <span className="pack-matrix-read">{formatPackQty(cell.qty)}</span>
                              <MatrixQty
                                key={`${cell.binId}-${cell.qty}`}
                                sku={row.sku}
                                label={label}
                                qty={cell.qty}
                                busy={busy}
                                onCommit={(qtyText) => onMatrixQty(line, cell.binId, qtyText)}
                              />
                            </>
                          ) : (
                            formatPackQty(cell.qty)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {serialsAvailable ? (
            <div className="pack-serials">
              {packedSerials.length > 0 ? (
                <ul className="pack-serial-list">
                  {packedSerials.map((row) => {
                    const bin = sheet.bins.find((candidate) => candidate.id === row.binId);
                    const where = bin ? shippingBinLabel(bin.kind, bin.number) : "a package";
                    return (
                      <li key={row.serialId}>
                        <span>{packSerialLabel(row.serial, row.sku)} · {where}</span>
                        {editing ? (
                          <button
                            type="button"
                            className="secondary icon-button"
                            aria-label={`Remove ${row.serial} from ${where}`}
                            title={`Remove ${row.serial} from ${where}`}
                            disabled={busy}
                            onClick={() => void run(() => removePackSerial(row.serialId))}
                          >
                            <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {editing && sheet.bins.length > 0 ? (
                <div className="pack-add">
                  <label>
                    Serial
                    <input
                      aria-label="Serial"
                      value={serialText}
                      list="pack-overview-serials"
                      onChange={(event) => setSerialText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        if (!serialPackageId || serialText.trim().length === 0) return;
                        void onAddSerial(serialPackageId, serialText).then((saved) => {
                          if (saved) setSerialText("");
                        });
                      }}
                    />
                  </label>
                  <datalist id="pack-overview-serials">
                    {sheet.lines.flatMap((line) =>
                      line.serials
                        .filter((serial) => serial.packageId == null)
                        .map((serial) => (
                          <option key={serial.id} value={serial.serial}>
                            {line.sku}
                          </option>
                        )),
                    )}
                  </datalist>
                  <label>
                    Package
                    <select
                      aria-label="Package for serial"
                      value={serialPackageId}
                      onChange={(event) => setSerialBinId(event.target.value)}
                    >
                      {sheet.bins.map((bin) => (
                        <option key={bin.id} value={bin.id}>
                          {shippingBinLabel(bin.kind, bin.number)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="secondary icon-button"
                    aria-label="Add serial"
                    title="Add serial"
                    disabled={busy || !serialPackageId || serialText.trim().length === 0}
                    onClick={() => {
                      void onAddSerial(serialPackageId, serialText).then((saved) => {
                        if (saved) setSerialText("");
                      });
                    }}
                  >
                    <Plus size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="card pick-table-wrap">
        <h2>Packages</h2>
        {sheet.lines.length === 0 ? (
          <p className="muted">Nothing picked is waiting to pack. Freight and service lines stay off this sheet.</p>
        ) : null}
        <table className="pick-sheet pack-packages">
          <thead>
            <tr>
              <th>Box</th>
              <th>Type</th>
              <th>Dim</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {sheet.bins.map((bin) => {
              const label = shippingBinLabel(bin.kind, bin.number);
              const duplicateBlock = duplicatePackBlock(bin, sheet.lines);
              return (
                <tr key={bin.id} className="pack-package">
                  <td className="pick-code">
                    <span className="pack-box-cell">
                      {label}
                      {editing ? (
                        <>
                          <button
                            type="button"
                            className="secondary icon-button"
                            aria-label={`Duplicate ${label}`}
                            title={duplicateBlock ?? `Duplicate ${label}`}
                            disabled={busy || Boolean(duplicateBlock)}
                            onClick={() => void run(() => duplicateShippingBin(bin.id))}
                          >
                            <Copy size={16} strokeWidth={1.75} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="secondary icon-button"
                            aria-label={`Remove ${label}`}
                            title={`Remove ${label}`}
                            disabled={busy}
                            onClick={() => void run(() => removeShippingBin(bin.id))}
                          >
                            <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                          </button>
                        </>
                      ) : null}
                    </span>
                  </td>
                  <td>{bin.typeName}</td>
                  <td className="pick-code">
                    {bin.kind === "pallet" && editing ? (
                      <span className="pick-qty-cell">
                        {formatPackQty(bin.lengthIn)} × {formatPackQty(bin.widthIn)} ×
                        <input
                          key={`${bin.id}-h-${bin.heightIn ?? ""}`}
                          className="pack-measure"
                          aria-label={`Height for ${label}`}
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
                        aria-label={`Weight for ${label}`}
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
                    ) : bin.weightLb == null ? (
                      "—"
                    ) : (
                      `${formatPackQty(bin.weightLb)} lb`
                    )}
                  </td>
                </tr>
              );
            })}
            {editing ? (
              <tr>
                <td colSpan={4}>
                  <div className="pack-add">
                    <label>
                      Packaging
                      <select
                        aria-label="Packaging type"
                        value={creatingType ? NEW_PACKAGING_TYPE : selectedType?.id ?? NEW_PACKAGING_TYPE}
                        onChange={(event) => setTypeId(event.target.value)}
                      >
                        {sheet.types.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name} · {row.kind === "pallet"
                              ? `${formatPackQty(row.lengthIn)} × ${formatPackQty(row.widthIn)} in`
                              : formatBinSize(row)}
                          </option>
                        ))}
                        <option value={NEW_PACKAGING_TYPE}>New packaging type</option>
                      </select>
                    </label>
                    {creatingType ? (
                      <>
                        <label>
                          Name
                          <input
                            aria-label="New packaging name"
                            value={typeName}
                            onChange={(event) => setTypeName(event.target.value)}
                          />
                        </label>
                        <label>
                          Kind
                          <select
                            aria-label="New packaging kind"
                            value={typeKind}
                            onChange={(event) => setTypeKind(event.target.value)}
                          >
                            <option value="box">Box</option>
                            <option value="pallet">Pallet</option>
                          </select>
                        </label>
                        <label>
                          Length
                          <input
                            className="pack-measure"
                            aria-label="New packaging length in inches"
                            value={typeLength}
                            inputMode="decimal"
                            onChange={(event) => setTypeLength(event.target.value)}
                          />
                        </label>
                        <label>
                          Width
                          <input
                            className="pack-measure"
                            aria-label="New packaging width in inches"
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
                              aria-label="New packaging height in inches"
                              value={typeHeight}
                              inputMode="decimal"
                              onChange={(event) => setTypeHeight(event.target.value)}
                            />
                          </label>
                        ) : null}
                      </>
                    ) : null}
                    {needsPalletHeight ? (
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
                      aria-label="Add package"
                      title="Add package"
                      disabled={busy}
                      onClick={() => void onAddPackage()}
                    >
                      <Plus size={16} strokeWidth={1.75} aria-hidden />
                    </button>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {sheet.bins.length === 0 ? (
          <p className="muted">No packages yet. Add a box or a pallet, then enter quantities in the overview.</p>
        ) : null}
        {editing ? (
          <p className="muted">
            Add a package and enter its weight. Quantities are edited in the overview. Duplicate copies a complete package.
          </p>
        ) : null}
        {editing && !sheet.packedAt && sheet.finishBlock ? <p className="muted">{sheet.finishBlock}</p> : null}
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
              <input
                aria-label="Packaging name"
                value={catalogName}
                onChange={(event) => setCatalogName(event.target.value)}
              />
            </label>
            <label>
              Kind
              <select
                aria-label="Packaging kind"
                value={catalogKind}
                onChange={(event) => setCatalogKind(event.target.value)}
              >
                <option value="box">Box</option>
                <option value="pallet">Pallet</option>
              </select>
            </label>
            <label>
              Length
              <input
                className="pack-measure"
                aria-label="Length in inches"
                value={catalogLength}
                inputMode="decimal"
                onChange={(event) => setCatalogLength(event.target.value)}
              />
            </label>
            <label>
              Width
              <input
                className="pack-measure"
                aria-label="Width in inches"
                value={catalogWidth}
                inputMode="decimal"
                onChange={(event) => setCatalogWidth(event.target.value)}
              />
            </label>
            {catalogKind === "box" ? (
              <label>
                Height
                <input
                  className="pack-measure"
                  aria-label="Height in inches"
                  value={catalogHeight}
                  inputMode="decimal"
                  onChange={(event) => setCatalogHeight(event.target.value)}
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

function MatrixQty({
  sku,
  label,
  qty,
  busy,
  onCommit,
}: {
  sku: string;
  label: string;
  qty: number;
  busy: boolean;
  onCommit: (qtyText: string) => void;
}) {
  const shown = formatPackQty(qty);
  const [text, setText] = useState(shown);

  function commit(value: string) {
    if (busy || value.trim() === shown) return;
    onCommit(value);
  }

  return (
    <input
      className="pack-measure pack-matrix-qty"
      aria-label={`Quantity of ${sku} in ${label}`}
      title={qty > 0 ? `${shown} in ${label}` : `Quantity of ${sku} in ${label}`}
      value={text}
      inputMode="numeric"
      disabled={busy}
      onChange={(event) => setText(event.target.value)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit(event.currentTarget.value);
      }}
    />
  );
}
