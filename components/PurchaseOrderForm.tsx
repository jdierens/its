"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useRef, useState } from "react";
import { FastArea, FastInput } from "@/components/FastField";
import { PurchaseOrderAttachments } from "@/components/PurchaseOrderAttachments";
import { Badge } from "@/components/ui/badge";
import { errorText } from "@/lib/errors";
import { PAYMENT_TERMS } from "@/lib/paymentTerms";
import { SHIPMENT_CARRIERS, parseFreightIn, trackingUrl } from "@/lib/poCharges";
import { type ImportPreview } from "@/lib/poLineImport";
import { previewPurchaseLines } from "@/lib/poLineImportServer";
import {
  formatExtension,
  formatUnitPrice,
  parseExtension,
  parseQty,
  parseUnitCost,
  syncLinePrices,
  type PriceEdit,
} from "@/lib/poLineMoney";
import { descriptionFromPickedItem, purchaseOrderStatusLabel } from "@/lib/purchaseOrderDraft";
import {
  cancelPurchaseOrder,
  savePurchaseOrder,
  savePurchaseOrderCharges,
  searchPurchaseItems,
  sendPurchaseOrder,
  type PurchaseItemHit,
  type PurchaseOrderLineView,
  type PurchaseOrderView,
  type PurchaseShipmentView,
  type PurchaseVendor,
} from "@/lib/purchaseOrders";
import { formatMoney } from "@/lib/pricing/quotes";

type LineState = PurchaseOrderLineView & {
  key: string;
  query: string;
  hits: PurchaseItemHit[];
  selected: boolean;
};

const EMPTY_LINE: LineState = {
  itemId: "",
  itemSku: "",
  itemName: "",
  description: "",
  qty: "",
  unitCost: "",
  extPrice: "",
  condition: "",
  unit: "Piece",
  query: "",
  hits: [],
  selected: false,
  key: "",
};

function blankLine(): LineState {
  return { ...EMPTY_LINE, key: crypto.randomUUID() };
}

function lineText(live: Map<string, string>, key: string, field: string, fallback: string) {
  const id = `${key}:${field}`;
  return live.has(id) ? (live.get(id) as string) : fallback;
}

const PoLineRow = memo(function PoLineRow({
  line,
  index,
  editable,
  showMoney,
  textLive,
  onPatch,
  onPrice,
  onBlurPrice,
  onFind,
  onPick,
  onClear,
}: {
  line: LineState;
  index: number;
  editable: boolean;
  showMoney: boolean;
  textLive: Map<string, string>;
  onPatch: (key: string, patch: Partial<LineState>) => void;
  onPrice: (key: string, edited: PriceEdit, value: string) => void;
  onBlurPrice: (key: string, edited: "unit" | "ext") => void;
  onFind: (key: string) => void;
  onPick: (key: string, hit: PurchaseItemHit) => void;
  onClear: (key: string) => void;
}) {
  return (
    <tr>
      {editable ? (
        <td className="po-check">
          <input
            type="checkbox"
            aria-label={`Select line ${index + 1}`}
            checked={line.selected}
            onChange={(event) => onPatch(line.key, { selected: event.target.checked })}
          />
        </td>
      ) : null}
      <td className="po-item" data-label="Item">
        {line.itemId ? (
          <div className="po-item-id">
            {line.itemSku} - {line.itemName}
          </div>
        ) : null}
        {editable ? (
          <div className="combo po-find">
            <FastInput
              value={line.query}
              onDraft={(next) => textLive.set(`${line.key}:query`, next)}
              onValue={(next) => onPatch(line.key, { query: next })}
              placeholder={line.itemId ? "Change item" : "SKU or name"}
              autoComplete="off"
              aria-label={`Find item for line ${index + 1}`}
            />
            <button type="button" onClick={() => void onFind(line.key)}>
              Find
            </button>
            {line.itemId ? (
              <button type="button" className="secondary" onClick={() => onClear(line.key)}>
                Clear
              </button>
            ) : null}
            {line.hits.length > 0 ? (
              <div className="combo-menu">
                {line.hits.map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    className="combo-option"
                    onClick={() => onPick(line.key, hit)}
                  >
                    <span>
                      {hit.sku} - {hit.name}
                    </span>
                    {hit.description ? <span className="hint">{hit.description}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </td>
      <td className="po-desc" data-label="Description">
        <FastInput
          aria-label={`Description for line ${index + 1}`}
          value={line.description}
          placeholder="Item description"
          onDraft={(next) => textLive.set(`${line.key}:description`, next)}
          onValue={(next) => onPatch(line.key, { description: next })}
          readOnly={!editable}
        />
      </td>
      <td className="po-num" data-label="Qty">
        <FastInput
          aria-label={`Quantity for line ${index + 1}`}
          value={line.qty}
          onDraft={(next) => textLive.set(`${line.key}:qty`, next)}
          onValue={(next) => onPrice(line.key, "qty", next)}
          readOnly={!editable}
          inputMode="decimal"
        />
      </td>
      <td className="po-unit" data-label="Unit">
        <FastInput
          aria-label={`Unit for line ${index + 1}`}
          value={line.unit}
          onDraft={(next) => textLive.set(`${line.key}:unit`, next)}
          onValue={(next) => onPatch(line.key, { unit: next })}
          readOnly={!editable}
        />
      </td>
      {showMoney ? (
        <td className="po-num" data-label="Unit price">
          <FastInput
            aria-label={`Unit price for line ${index + 1}`}
            value={line.unitCost}
            onDraft={(next) => textLive.set(`${line.key}:unitCost`, next)}
            onValue={(next) => onPrice(line.key, "unit", next)}
            onBlur={() => onBlurPrice(line.key, "unit")}
            readOnly={!editable}
            inputMode="decimal"
          />
        </td>
      ) : null}
      {showMoney ? (
        <td className="po-num" data-label="Ext price">
          <FastInput
            aria-label={`Extension for line ${index + 1}`}
            value={line.extPrice}
            onDraft={(next) => textLive.set(`${line.key}:extPrice`, next)}
            onValue={(next) => onPrice(line.key, "ext", next)}
            onBlur={() => onBlurPrice(line.key, "ext")}
            readOnly={!editable}
            inputMode="decimal"
          />
        </td>
      ) : null}
    </tr>
  );
});

export function PurchaseOrderForm({
  order,
  vendors,
  canEdit,
  showMoney,
}: {
  order: PurchaseOrderView | null;
  vendors: PurchaseVendor[];
  canEdit: boolean;
  showMoney: boolean;
}) {
  const router = useRouter();
  const editable = canEdit && (order == null || order.status === "draft");
  const chargesEditable = canEdit && (order == null || order.status !== "cancelled");
  const [vendorId, setVendorId] = useState(order?.vendorId ?? vendors[0]?.id ?? "");
  const [fulfillment, setFulfillment] = useState(order?.fulfillment ?? "warehouse");
  const [terms, setTerms] = useState(order?.terms ?? "");
  const [freightIn, setFreightIn] = useState(order?.freightIn ?? "");
  const [shipments, setShipments] = useState<PurchaseShipmentView[]>(order?.shipments ?? []);
  const [orderedOn, setOrderedOn] = useState(order?.orderedOn ?? "");
  const [expectedOn, setExpectedOn] = useState(order?.expectedOn ?? "");
  const [vendorNotes, setVendorNotes] = useState(order?.vendorNotes ?? "");
  const [internalNotes, setInternalNotes] = useState(order?.internalNotes ?? "");
  const [lines, setLines] = useState<LineState[]>(
    order && order.lines.length > 0
      ? order.lines.map((line) => ({ ...line, query: "", hits: [], selected: false, key: crypto.randomUUID() }))
      : [blankLine()],
  );
  const textLive = useRef(new Map<string, string>());
  const findGeneration = useRef(0);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const [addCount, setAddCount] = useState("1");
  const [importMode, setImportMode] = useState<"replace" | "append">("append");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateLine = useCallback((key: string, patch: Partial<LineState>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }, []);

  const editPrice = useCallback((key: string, edited: PriceEdit, value: string) => {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const qty = edited === "qty" ? value : lineText(textLive.current, key, "qty", line.qty);
        const unitCost = edited === "unit" ? value : lineText(textLive.current, key, "unitCost", line.unitCost);
        const extPrice = edited === "ext" ? value : lineText(textLive.current, key, "extPrice", line.extPrice);
        const synced = syncLinePrices({ qty, unitCost, extPrice, edited });
        textLive.current.set(`${key}:qty`, qty);
        textLive.current.set(`${key}:unitCost`, synced.unitCost);
        textLive.current.set(`${key}:extPrice`, synced.extPrice);
        return { ...line, qty, unitCost: synced.unitCost, extPrice: synced.extPrice };
      }),
    );
  }, []);

  const blurPrice = useCallback((key: string, edited: "unit" | "ext") => {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        if (edited === "unit") {
          const raw = lineText(textLive.current, key, "unitCost", line.unitCost);
          const parsed = parseUnitCost(raw);
          if (parsed == null) return line;
          const unitCost = formatUnitPrice(parsed);
          textLive.current.set(`${key}:unitCost`, unitCost);
          return { ...line, unitCost };
        }
        const raw = lineText(textLive.current, key, "extPrice", line.extPrice);
        const parsed = parseExtension(raw);
        if (parsed == null) return line;
        const extPrice = formatExtension(parsed);
        textLive.current.set(`${key}:extPrice`, extPrice);
        return { ...line, extPrice };
      }),
    );
  }, []);

  const findItem = useCallback(async (key: string) => {
    const queryId = `${key}:query`;
    const query = textLive.current.has(queryId)
      ? (textLive.current.get(queryId) as string)
      : (linesRef.current.find((line) => line.key === key)?.query ?? "");
    const generation = ++findGeneration.current;
    try {
      const hits = await searchPurchaseItems(query);
      if (generation !== findGeneration.current) return;
      const latest = textLive.current.has(queryId) ? (textLive.current.get(queryId) as string).trim() : query.trim();
      if (latest !== query.trim()) return;
      setLines((current) => current.map((line) => (line.key === key ? { ...line, hits } : line)));
      if (hits.length === 0) setMessage("No matching item.");
    } catch (error) {
      if (generation === findGeneration.current) setMessage(errorText(error));
    }
  }, []);

  const pickItem = useCallback((key: string, hit: PurchaseItemHit) => {
    const description = descriptionFromPickedItem(hit.description);
    textLive.current.set(`${key}:query`, "");
    textLive.current.set(`${key}:description`, description);
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? { ...line, itemId: hit.id, itemSku: hit.sku, itemName: hit.name, description, hits: [], query: "" }
          : line,
      ),
    );
  }, []);

  const clearItem = useCallback((key: string) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, itemId: "", itemSku: "", itemName: "", hits: [] } : line)),
    );
  }, []);

  function addLines() {
    const count = Number(addCount);
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      setMessage("Add between 1 and 20 lines.");
      return;
    }
    setMessage(null);
    setLines((current) => [...current, ...Array.from({ length: count }, () => blankLine())]);
  }

  function removeSelected() {
    setLines((current) => {
      const next = current.filter((line) => !line.selected);
      return next.length > 0 ? next : [blankLine()];
    });
  }

  function linePayload() {
    return lines.map((line) => ({
      itemId: line.itemId,
      description: lineText(textLive.current, line.key, "description", line.description),
      qty: lineText(textLive.current, line.key, "qty", line.qty),
      unitCost: lineText(textLive.current, line.key, "unitCost", line.unitCost),
      extPrice: lineText(textLive.current, line.key, "extPrice", line.extPrice),
      condition: line.condition,
      unit: lineText(textLive.current, line.key, "unit", line.unit),
    }));
  }

  function readNote(key: string, fallback: string) {
    return textLive.current.has(key) ? (textLive.current.get(key) as string) : fallback;
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await savePurchaseOrder(order?.id ?? null, {
        vendorId,
        fulfillment,
        terms: showMoney ? terms : "",
        freightIn: showMoney ? readNote("freightIn", freightIn) : "",
        shipments,
        orderedOn,
        expectedOn,
        vendorNotes: readNote("vendorNotes", vendorNotes),
        internalNotes: showMoney ? readNote("internalNotes", internalNotes) : "",
        lines: linePayload(),
      });
      if (order) router.refresh();
      else router.push(`/purchasing/orders/${saved.id}`);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveCharges() {
    if (!order) return;
    setSaving(true);
    setMessage(null);
    try {
      await savePurchaseOrderCharges(order.id, {
        freightIn: showMoney ? readNote("freightIn", freightIn) : "",
        shipments,
        vendorNotes: readNote("vendorNotes", vendorNotes),
        internalNotes: showMoney ? readNote("internalNotes", internalNotes) : "",
      });
      router.refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    if (!order || !window.confirm(`Send ${order.number}?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await sendPurchaseOrder(order.id);
      router.refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function cancel() {
    if (!order || !window.confirm(`Cancel ${order.number}?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await cancelPurchaseOrder(order.id);
      router.refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function readImport(file: File) {
    setSaving(true);
    setMessage(null);
    try {
      const fileBase64 = await fileToBase64(file);
      setPreview(await previewPurchaseLines({ fileName: file.name, fileBase64 }));
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  function applyImport() {
    if (!preview || preview.error) return;
    const usable = preview.rows.filter((row) => row.level !== "error");
    if (usable.length === 0) {
      setMessage("No lines to import.");
      return;
    }
    const imported = usable.map((row) => ({
      ...blankLine(),
      itemId: row.itemId,
      itemSku: row.itemSku,
      itemName: row.itemName,
      description: row.description,
      qty: row.qty,
      unit: row.unit,
      unitCost: row.unitCost,
      extPrice: row.extPrice,
    }));
    setLines((current) => {
      if (importMode === "replace") return imported;
      const kept = current.filter((line) => line.itemId || line.description.trim() || line.qty.trim() || line.unitCost.trim() || line.extPrice.trim());
      return [...kept, ...imported];
    });
    setPreview(null);
    setMessage(null);
  }

  const allSelected = lines.length > 0 && lines.every((line) => line.selected);

  return (
    <main className="page po-page">
      <p className="page-note">
        {order ? (
          <>
            <span className="sku">{order.number}</span>
            {" · "}
            <Badge tone={order.status}>{purchaseOrderStatusLabel(order.status)}</Badge>
            {order.vendorName ? ` · ${order.vendorName}` : ""}
            {showMoney && order.total != null ? ` · ${formatMoney(order.total, order.currency ?? "USD")}` : ""}
          </>
        ) : (
          "Create a purchase order. Sending it marks the order open. Receiving comes later."
        )}
      </p>
      {message ? (
        <p className="banner error" role="alert">
          {message}
        </p>
      ) : null}
      {!editable ? (
        <p className="muted">
          <Link href="/purchasing/orders">Back to purchase orders</Link>
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (editable) void save();
        }}
      >
        <div className="po-head">
          <label>
            Vendor
            {editable ? (
              <select value={vendorId} onChange={(event) => setVendorId(event.target.value)} required>
                <option value="">Choose a vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            ) : (
              <input value={order?.vendorName ?? ""} readOnly />
            )}
          </label>
          <label>
            Fulfillment
            {editable ? (
              <select value={fulfillment} onChange={(event) => setFulfillment(event.target.value)}>
                <option value="warehouse">Warehouse</option>
                <option value="drop_ship">Drop ship</option>
              </select>
            ) : (
              <input value={fulfillment === "drop_ship" ? "Drop ship" : "Warehouse"} readOnly />
            )}
          </label>
          <label>
            Order date
            <input type="date" value={orderedOn} onChange={(event) => setOrderedOn(event.target.value)} readOnly={!editable} />
          </label>
          <label>
            Expected
            <input type="date" value={expectedOn} onChange={(event) => setExpectedOn(event.target.value)} readOnly={!editable} />
          </label>
        </div>
        <div className={showMoney ? "po-head-2" : "po-head-2 po-head-2-single"}>
          {showMoney ? (
            <label>
              Terms
              {editable ? (
                <select value={terms} onChange={(event) => setTerms(event.target.value)} required>
                  <option value="">Choose terms</option>
                  {PAYMENT_TERMS.map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={terms || "—"} readOnly />
              )}
            </label>
          ) : null}
          <div className="po-field">
            <span className="po-label">Tracking</span>
            {shipments.length === 0 && !chargesEditable ? <p className="muted">No tracking numbers yet.</p> : null}
            {shipments.map((shipment, index) => {
              const href = trackingUrl(shipment.carrier, shipment.trackingNumber);
              return (
                <div className="po-track-row" key={index}>
                  {chargesEditable ? (
                    <select
                      aria-label="Carrier"
                      value={shipment.carrier}
                      onChange={(event) =>
                        setShipments((current) =>
                          current.map((row, rowIndex) => (rowIndex === index ? { ...row, carrier: event.target.value } : row)),
                        )
                      }
                    >
                      <option value="">Carrier</option>
                      {SHIPMENT_CARRIERS.map((carrier) => (
                        <option key={carrier} value={carrier}>
                          {carrier}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input value={shipment.carrier} readOnly aria-label="Carrier" />
                  )}
                  {chargesEditable ? (
                    <span>
                      <input
                        aria-label="Tracking number"
                        value={shipment.trackingNumber}
                        onChange={(event) =>
                          setShipments((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, trackingNumber: event.target.value } : row,
                            ),
                          )
                        }
                        autoComplete="off"
                      />
                      {href ? (
                        <a className="hint" href={href} target="_blank" rel="noopener noreferrer">
                          Open tracking
                        </a>
                      ) : null}
                    </span>
                  ) : href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {shipment.trackingNumber}
                    </a>
                  ) : (
                    <input value={shipment.trackingNumber} readOnly aria-label="Tracking number" />
                  )}
                  {chargesEditable ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setShipments((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                    >
                    Remove
                  </button>
                ) : null}
              </div>
              );
            })}
            {chargesEditable ? (
              <button
                type="button"
                className="secondary"
                onClick={() => setShipments((current) => [...current, { carrier: "", trackingNumber: "" }])}
              >
                Add tracking number
              </button>
            ) : null}
          </div>
        </div>

        <div className="po-lines">
          <table className="dense">
            <colgroup>
              {editable ? <col className="po-col-check" /> : null}
              <col className="po-col-item" />
              <col className="po-col-desc" />
              <col className="po-col-qty" />
              <col className="po-col-unit" />
              {showMoney ? <col className="po-col-price" /> : null}
              {showMoney ? <col className="po-col-ext" /> : null}
            </colgroup>
            <thead>
              <tr>
                {editable ? (
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all lines"
                      checked={allSelected}
                      onChange={(event) =>
                        setLines((current) => current.map((line) => ({ ...line, selected: event.target.checked })))
                      }
                    />
                  </th>
                ) : null}
                <th>Item</th>
                <th>Description</th>
                <th className="po-num">Qty</th>
                <th>Unit</th>
                {showMoney ? <th className="po-num">Unit price</th> : null}
                {showMoney ? <th className="po-num">Ext price</th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <PoLineRow
                  key={line.key}
                  line={line}
                  index={index}
                  editable={editable}
                  showMoney={showMoney}
                  textLive={textLive.current}
                  onPatch={updateLine}
                  onPrice={editPrice}
                  onBlurPrice={blurPrice}
                  onFind={findItem}
                  onPick={pickItem}
                  onClear={clearItem}
                />
              ))}
            </tbody>
            {showMoney ? (
              <OrderTotals
                lines={lines}
                freightIn={freightIn}
                editable={chargesEditable}
                labelSpan={(editable ? 1 : 0) + 5}
                onFreight={(next) => {
                  textLive.current.set("freightIn", next);
                  setFreightIn(next);
                }}
                onFreightDraft={(next) => textLive.current.set("freightIn", next)}
              />
            ) : null}
          </table>
        </div>
        {editable ? (
          <div className="po-line-actions">
            <label>
              Add lines
              <input value={addCount} onChange={(event) => setAddCount(event.target.value)} inputMode="numeric" />
            </label>
            <button type="button" onClick={addLines}>
              Add
            </button>
            <button type="button" className="secondary" onClick={removeSelected}>
              Remove selected
            </button>
            <label>
              Import
              <select value={importMode} onChange={(event) => setImportMode(event.target.value === "replace" ? "replace" : "append")}>
                <option value="append">Append</option>
                <option value="replace">Replace</option>
              </select>
            </label>
            <label>
              CSV or XLSX
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void readImport(file);
                }}
              />
            </label>
          </div>
        ) : null}
        {editable ? (
          <p className="hint">
            Headers: item id or SKU, qty, unit, unit price, ext price, description. An unknown item stays as a description line.
          </p>
        ) : null}
        {preview ? (
          <div className="po-preview">
            {preview.error ? <p className="banner error">{preview.error}</p> : null}
            {preview.rows.length > 0 ? (
              <table className="dense">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Item</th>
                    <th className="po-num">Qty</th>
                    {showMoney ? <th className="po-num">Unit price</th> : null}
                    {showMoney ? <th className="po-num">Ext</th> : null}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.rowNumber} className={row.level === "error" ? "po-row-error" : undefined}>
                      <td>{row.rowNumber}</td>
                      <td>{row.itemId ? `${row.itemSku} - ${row.itemName}` : row.description}</td>
                      <td className="po-num">{row.qty}</td>
                      {showMoney ? <td className="po-num">{row.unitCost}</td> : null}
                      {showMoney ? <td className="po-num">{row.extPrice}</td> : null}
                      <td>{row.message ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {editable && !preview.error ? (
              <button type="button" onClick={applyImport}>
                {importMode === "replace" ? "Replace lines" : "Append lines"}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={showMoney ? "po-notes" : "po-notes po-notes-single"}>
          <label>
            Vendor notes
            <FastArea
              value={vendorNotes}
              onDraft={(next) => textLive.current.set("vendorNotes", next)}
              onValue={setVendorNotes}
              readOnly={!chargesEditable}
            />
            <span className="hint">Printed or sent to the vendor.</span>
          </label>
          {showMoney ? (
            <label>
              Internal notes
              <FastArea
                value={internalNotes}
                onDraft={(next) => textLive.current.set("internalNotes", next)}
                onValue={setInternalNotes}
                readOnly={!chargesEditable}
              />
              <span className="hint">Never shown to the vendor.</span>
            </label>
          ) : null}
        </div>

        {showMoney ? (
          <PurchaseOrderAttachments
            orderId={order?.id ?? null}
            attachments={order?.attachments ?? []}
            canEdit={chargesEditable}
          />
        ) : null}

        {editable ? (
          <div className="actions">
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            {order ? (
              <button type="button" className="secondary" disabled={saving} onClick={() => void send()}>
                Send
              </button>
            ) : null}
            {order ? (
              <button type="button" className="secondary" disabled={saving} onClick={() => void cancel()}>
                Cancel order
              </button>
            ) : null}
          </div>
        ) : null}
        {!editable && chargesEditable && order ? (
          <div className="actions">
            <button type="button" disabled={saving} onClick={() => void saveCharges()}>
              {saving ? "Saving…" : showMoney ? "Save shipping, tracking, and notes" : "Save tracking and notes"}
            </button>
          </div>
        ) : null}
      </form>
    </main>
  );
}

function OrderTotals({
  lines,
  freightIn,
  editable,
  labelSpan,
  onFreight,
  onFreightDraft,
}: {
  lines: LineState[];
  freightIn: string;
  editable: boolean;
  labelSpan: number;
  onFreight: (value: string) => void;
  onFreightDraft?: (value: string) => void;
}) {
  let cents = 0;
  let complete = true;
  for (const line of lines) {
    if (!line.qty.trim() && !line.unitCost.trim() && !line.extPrice.trim()) continue;
    const ext = parseExtension(line.extPrice);
    const qty = parseQty(line.qty);
    const unit = parseUnitCost(line.unitCost);
    const amount = ext ?? (qty != null && unit != null ? Math.round(qty * unit * 100) / 100 : null);
    if (amount == null) {
      complete = false;
      break;
    }
    cents += Math.round(amount * 100);
  }
  const subtotal = complete ? cents / 100 : null;
  const freight = parseFreightIn(freightIn);
  const freightAmount = freight === "invalid" ? null : freight;
  const total = subtotal == null || freight === "invalid" ? null : subtotal + (freightAmount ?? 0);
  return (
    <tfoot>
      <tr>
        <td className="po-total-label" colSpan={labelSpan}>
          Subtotal
        </td>
        <td className="po-num po-total-value">{formatMoney(subtotal)}</td>
      </tr>
      <tr>
        <td className="po-total-label" colSpan={labelSpan}>
          <label htmlFor="po-freight">
            Shipping / Freight-in
            <span className="hint">USD. Optional. Often entered after the order is sent.</span>
          </label>
        </td>
        <td className="po-num">
          <FastInput
            id="po-freight"
            aria-label="Shipping / Freight-in"
            value={freightIn}
            onDraft={onFreightDraft}
            onValue={onFreight}
            readOnly={!editable}
            inputMode="decimal"
            placeholder="0.00"
          />
        </td>
      </tr>
      <tr className="po-grand">
        <td className="po-total-label" colSpan={labelSpan}>
          Total
        </td>
        <td className="po-num po-total-value">{formatMoney(total)}</td>
      </tr>
    </tfoot>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}
