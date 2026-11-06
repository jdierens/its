"use client";

import { Check, Copy, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
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
  PACK_ADD_QTY,
  packAssignmentLabel,
  packCatchUpNote,
  packCompleteBlock,
  packageContentChips,
  packageContentQty,
  packageRowStatus,
  packagingTypeError,
  packedAfterShipNote,
  packContentItemChoices,
  packContentMergeNote,
  packContentSerialNote,
  packFinishVisible,
  packOverview,
  packRoom,
  packSaveState,
  packSerialMatch,
  packSheetEditable,
  parseInches,
  parsePackContentEdit,
  parsePackQty,
  parsePackWeight,
  sheetPackProgress,
  shippingBinLabel,
  unpackedRemainder,
  type PackContentChip,
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
  const [contentFor, setContentFor] = useState<string | null>(null);
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
  const remainder = unpackedRemainder(sheet.lines);
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

  async function onAddItem(binId: string, allocationId: string, qtyText: string): Promise<boolean> {
    const line = sheet.lines.find((row) => row.allocationId === allocationId);
    if (!line) {
      setError("Choose an item that is still unpacked.");
      return false;
    }
    const room = packRoom(line.picked, line.packed, 0);
    const parsed = parsePackQty(qtyText, room);
    if (!parsed.ok) {
      setError(parsed.message);
      return false;
    }
    return run(() => assignPackQty({ packageId: binId, allocationId: line.allocationId, qty: parsed.qty }));
  }

  async function onEditItem(
    contentId: string,
    allocationId: string,
    itemQty: number,
    nextAllocationId: string,
    qtyText: string,
  ): Promise<boolean> {
    const parsed = parsePackContentEdit({
      lines: sheet.lines,
      allocationId,
      itemQty,
      nextAllocationId,
      qtyText,
    });
    if (!parsed.ok) {
      setError(parsed.message);
      return false;
    }
    if (parsed.unchanged) {
      setError(null);
      return true;
    }
    return run(() =>
      setPackItemContent({
        contentId,
        allocationId: parsed.allocationId,
        qty: parsed.qty,
      }),
    );
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
              {packOverview(sheet.lines, sheet.bins).map((row) => (
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
                    return (
                      <td
                        key={cell.binId}
                        className="num"
                        title={bin && cell.qty > 0 ? packAssignmentLabel(bin.kind, bin.number, cell.qty) : undefined}
                      >
                        {formatPackQty(cell.qty)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="card pick-table-wrap">
        <h2>Packages</h2>
        {sheet.lines.length === 0 ? (
          <p className="muted">Nothing picked is waiting to pack. Freight and service lines stay off this sheet.</p>
        ) : null}
        {sheet.bins.length === 0 ? (
          <p className="muted">No packages yet. Add a box or a pallet, then put unpacked items in it.</p>
        ) : null}
        <table className="pick-sheet pack-packages">
          <thead>
            <tr>
              <th>Package</th>
              <th>Type</th>
              <th>Size</th>
              <th>Weight</th>
              <th>Contents</th>
              <th>Status</th>
              {editing ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {sheet.bins.map((bin) => {
              const label = shippingBinLabel(bin.kind, bin.number);
              const chips = packageContentChips(bin.id, sheet.lines);
              const status = packageRowStatus(bin, packageContentQty(bin.id, sheet.lines));
              const duplicateBlock = duplicatePackBlock(bin, sheet.lines);
              const open = contentFor === bin.id;
              return (
                <Fragment key={bin.id}>
                  <tr className="pack-package">
                    <td className="pick-code">{label}</td>
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
                    <td>
                      {chips.length === 0 ? (
                        <span className="muted">Nothing in this package</span>
                      ) : (
                        <div className="pack-contents">
                          {chips.map((chip) => {
                            const line = sheet.lines.find((row) => row.allocationId === chip.allocationId);
                            const chipTitle = packAssignmentLabel(bin.kind, bin.number, chip.kind === "item" ? chip.qty : 1);
                            const removeLabel = chip.kind === "item"
                              ? `Remove ${chip.label} from ${label}`
                              : `Remove ${chip.serial} from ${label}`;
                            return (
                              <div
                                key={chip.kind === "item" ? chip.assignmentId : chip.serialId}
                                className={editing && chip.kind === "item" ? "pack-chip is-editing" : "pack-chip"}
                              >
                                <span className="pack-chip-read" title={chipTitle}>
                                  {chip.label}
                                </span>
                                {editing && chip.kind === "item" ? (
                                  <ItemContentEditor
                                    key={`${chip.assignmentId}-${chip.allocationId}-${chip.qty}`}
                                    bin={bin}
                                    chip={chip}
                                    lines={sheet.lines}
                                    busy={busy}
                                    onSave={(nextAllocationId, qtyText) =>
                                      onEditItem(chip.assignmentId, chip.allocationId, chip.qty, nextAllocationId, qtyText)
                                    }
                                  />
                                ) : null}
                                {line?.replaced ? <span className="pick-planned">Planned {line.plannedSku}</span> : null}
                                {editing ? (
                                  <button
                                    type="button"
                                    className="secondary icon-button"
                                    aria-label={removeLabel}
                                    title={removeLabel}
                                    data-pack-remove={chip.kind === "item" ? chip.assignmentId : chip.serialId}
                                    disabled={busy}
                                    onClick={() =>
                                      void run(() =>
                                        chip.kind === "item"
                                          ? releasePackItemQty(chip.assignmentId)
                                          : removePackSerial(chip.serialId),
                                      )
                                    }
                                  >
                                    <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                                  </button>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className={status === "Complete" ? "pack-status is-complete" : "pack-status muted"}>
                      {status}
                    </td>
                    {editing ? (
                      <td>
                        <div className="pick-icon-cell">
                          <button
                            type="button"
                            className="secondary icon-button"
                            aria-label={`Add contents to ${label}`}
                            title={`Add contents to ${label}`}
                            aria-expanded={open}
                            disabled={busy}
                            onClick={() => setContentFor((current) => (current === bin.id ? null : bin.id))}
                          >
                            <Plus size={16} strokeWidth={1.75} aria-hidden />
                          </button>
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
                        </div>
                      </td>
                    ) : null}
                  </tr>
                  {editing && open ? (
                    <tr className="pack-editor-row">
                      <td colSpan={7}>
                        <AddContents
                          bin={bin}
                          lines={sheet.lines}
                          busy={busy}
                          serialsAvailable={serialsAvailable}
                          onAddItem={(allocationId, qtyText) => onAddItem(bin.id, allocationId, qtyText)}
                          onAddSerial={(serial) => onAddSerial(bin.id, serial)}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {editing ? (
              <tr>
                <td colSpan={7}>
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
        {remainder.length > 0 ? (
          <p className="muted">Still to pack: {remainder.join(", ")}</p>
        ) : sheet.lines.length > 0 && sheet.bins.length > 0 ? (
          <p className="muted">Everything picked is in a package.</p>
        ) : null}
        {editing ? (
          <p className="muted">
            Add a package, enter the weight, then add unpacked items. Adding starts at 1. Change the quantity or the item on a packed line. Duplicate copies a complete package.
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

function ItemContentEditor({
  bin,
  chip,
  lines,
  busy,
  onSave,
}: {
  bin: ShippingBin;
  chip: Extract<PackContentChip, { kind: "item" }>;
  lines: readonly PackLine[];
  busy: boolean;
  onSave: (nextAllocationId: string, qtyText: string) => Promise<boolean>;
}) {
  const label = shippingBinLabel(bin.kind, bin.number);
  const choices = packContentItemChoices(lines, chip.allocationId);
  const [allocationId, setAllocationId] = useState(chip.allocationId);
  const [qtyText, setQtyText] = useState(formatPackQty(chip.qty));
  const saving = useRef(false);
  const chosen = choices.some((line) => line.allocationId === allocationId) ? allocationId : chip.allocationId;
  const mergeNote = packContentMergeNote(bin, lines, chosen, chip.allocationId);
  const serialNote = packContentSerialNote(
    bin.id,
    lines.find((line) => line.allocationId === chip.allocationId),
  );

  function submit() {
    if (busy || saving.current) return;
    const dirty = chosen !== chip.allocationId || qtyText.trim() !== formatPackQty(chip.qty);
    if (!dirty) return;
    saving.current = true;
    void onSave(chosen, qtyText).finally(() => {
      saving.current = false;
    });
  }

  return (
    <div
      className="pack-chip-edit"
      role="group"
      aria-label={`Edit ${chip.label} in ${label}`}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        if (next instanceof Element && next.getAttribute("data-pack-remove")) return;
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        submit();
      }}
    >
      <label>
        Qty
        <input
          className="pack-measure pack-content-qty"
          aria-label={`Quantity of ${chip.sku} in ${label}`}
          value={qtyText}
          inputMode="numeric"
          disabled={busy}
          onChange={(event) => setQtyText(event.target.value)}
        />
      </label>
      <span className="pack-times" aria-hidden="true">
        ×
      </span>
      <label>
        Item
        <select
          aria-label={`Item for ${chip.sku} in ${label}`}
          value={chosen}
          disabled={busy}
          onChange={(event) => setAllocationId(event.target.value)}
        >
          {choices.map((line) => {
            const unpacked = packRoom(
              line.picked,
              line.packed,
              line.allocationId === chip.allocationId ? chip.qty : 0,
            );
            const room =
              line.allocationId === chip.allocationId ? "" : ` · ${formatPackQty(unpacked)} unpacked`;
            return (
              <option key={line.allocationId} value={line.allocationId}>
                {line.sku}
                {room}
                {line.name ? ` · ${line.name}` : ""}
              </option>
            );
          })}
        </select>
      </label>
      <button
        type="button"
        className="secondary icon-button"
        aria-label={`Save ${chip.sku} in ${label}`}
        title={`Save ${chip.sku} in ${label}`}
        disabled={busy}
        onClick={submit}
      >
        <Check size={16} strokeWidth={1.75} aria-hidden />
      </button>
      {mergeNote ? <p className="muted pack-content-note">{mergeNote}</p> : null}
      {serialNote ? <p className="muted pack-content-note">{serialNote}</p> : null}
    </div>
  );
}

function AddContents({
  bin,
  lines,
  busy,
  serialsAvailable,
  onAddItem,
  onAddSerial,
}: {
  bin: ShippingBin;
  lines: readonly PackLine[];
  busy: boolean;
  serialsAvailable: boolean;
  onAddItem: (allocationId: string, qtyText: string) => Promise<boolean>;
  onAddSerial: (serial: string) => Promise<boolean>;
}) {
  const label = shippingBinLabel(bin.kind, bin.number);
  const openLines = lines.filter((line) => packRoom(line.picked, line.packed, 0) > 0);
  const [mode, setMode] = useState<"item" | "serial">("item");
  const [allocationId, setAllocationId] = useState(openLines[0]?.allocationId ?? "");
  const [qtyText, setQtyText] = useState(PACK_ADD_QTY);
  const [serialText, setSerialText] = useState("");
  const addBy = serialsAvailable && mode === "serial" ? "serial" : "item";
  const chosen = openLines.some((line) => line.allocationId === allocationId)
    ? allocationId
    : openLines[0]?.allocationId ?? "";
  const unpackedSerials = lines.flatMap((line) =>
    line.serials
      .filter((serial) => serial.packageId == null)
      .map((serial) => ({ serial: serial.serial, sku: line.sku })),
  );

  function submitItem() {
    if (!chosen || busy) return;
    void onAddItem(chosen, qtyText.trim() ? qtyText : PACK_ADD_QTY).then((saved) => {
      if (saved) setQtyText(PACK_ADD_QTY);
    });
  }

  function submitSerial() {
    if (busy || serialText.trim().length === 0) return;
    void onAddSerial(serialText).then((saved) => {
      if (saved) setSerialText("");
    });
  }

  return (
    <div className="pack-editor">
      <label>
        Add by
        <select
          aria-label={`Add contents to ${label} by`}
          value={addBy}
          onChange={(event) => setMode(event.target.value === "serial" ? "serial" : "item")}
        >
          <option value="item">Item</option>
          <option value="serial" disabled={!serialsAvailable}>
            {serialsAvailable ? "Serial" : "Serial — none on this pick"}
          </option>
        </select>
      </label>
      {addBy === "item" ? (
        <>
          <label>
            Item
            <select
              aria-label={`Item for ${label}`}
              value={chosen}
              onChange={(event) => setAllocationId(event.target.value)}
            >
              {openLines.length === 0 ? <option value="">Nothing left to pack</option> : null}
              {openLines.map((line) => (
                <option key={line.allocationId} value={line.allocationId}>
                  {line.sku} · {formatPackQty(packRoom(line.picked, line.packed, 0))} unpacked
                  {line.name ? ` · ${line.name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Qty
            <input
              className="pack-measure"
              aria-label={`Quantity for ${label}`}
              value={qtyText}
              inputMode="numeric"
              onChange={(event) => setQtyText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                submitItem();
              }}
            />
          </label>
          <button
            type="button"
            className="secondary icon-button"
            aria-label={`Add item to ${label}`}
            title={`Add item to ${label}`}
            disabled={busy || !chosen}
            onClick={submitItem}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </>
      ) : (
        <>
          <label>
            Serial
            <input
              aria-label={`Serial for ${label}`}
              value={serialText}
              list={`pack-serials-${bin.id}`}
              onChange={(event) => setSerialText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                submitSerial();
              }}
            />
          </label>
          <datalist id={`pack-serials-${bin.id}`}>
            {unpackedSerials.map((row) => (
              <option key={`${row.serial}-${row.sku}`} value={row.serial}>
                {row.sku}
              </option>
            ))}
          </datalist>
          <button
            type="button"
            className="secondary icon-button"
            aria-label={`Add serial to ${label}`}
            title={`Add serial to ${label}`}
            disabled={busy || serialText.trim().length === 0}
            onClick={submitSerial}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
