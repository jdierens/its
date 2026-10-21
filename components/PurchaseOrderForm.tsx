"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PurchaseOrderAttachments } from "@/components/PurchaseOrderAttachments";
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

type LineState = PurchaseOrderLineView & { query: string; hits: PurchaseItemHit[]; selected: boolean };

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
};

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
      ? order.lines.map((line) => ({ ...line, query: "", hits: [], selected: false }))
      : [{ ...EMPTY_LINE }],
  );
  const [addCount, setAddCount] = useState("1");
  const [importMode, setImportMode] = useState<"replace" | "append">("append");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateLine(index: number, patch: Partial<LineState>) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function editPrice(index: number, edited: PriceEdit, value: string) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const next = { ...line, qty: edited === "qty" ? value : line.qty, unitCost: edited === "unit" ? value : line.unitCost, extPrice: edited === "ext" ? value : line.extPrice };
        const synced = syncLinePrices({ qty: next.qty, unitCost: next.unitCost, extPrice: next.extPrice, edited });
        return { ...next, unitCost: synced.unitCost, extPrice: synced.extPrice };
      }),
    );
  }

  function blurPrice(index: number, edited: "unit" | "ext") {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        if (edited === "unit") {
          const parsed = parseUnitCost(line.unitCost);
          return parsed == null ? line : { ...line, unitCost: formatUnitPrice(parsed) };
        }
        const parsed = parseExtension(line.extPrice);
        return parsed == null ? line : { ...line, extPrice: formatExtension(parsed) };
      }),
    );
  }

  async function findItem(index: number) {
    const query = lines[index]?.query ?? "";
    try {
      const hits = await searchPurchaseItems(query);
      updateLine(index, { hits });
      if (hits.length === 0) setMessage("No matching item.");
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  function addLines() {
    const count = Number(addCount);
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      setMessage("Add between 1 and 20 lines.");
      return;
    }
    setMessage(null);
    setLines((current) => [...current, ...Array.from({ length: count }, () => ({ ...EMPTY_LINE }))]);
  }

  function removeSelected() {
    setLines((current) => {
      const next = current.filter((line) => !line.selected);
      return next.length > 0 ? next : [{ ...EMPTY_LINE }];
    });
  }

  function linePayload() {
    return lines.map((line) => ({
      itemId: line.itemId,
      description: line.description,
      qty: line.qty,
      unitCost: line.unitCost,
      extPrice: line.extPrice,
      condition: line.condition,
      unit: line.unit,
    }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await savePurchaseOrder(order?.id ?? null, {
        vendorId,
        fulfillment,
        terms: showMoney ? terms : "",
        freightIn: showMoney ? freightIn : "",
        shipments,
        orderedOn,
        expectedOn,
        vendorNotes,
        internalNotes: showMoney ? internalNotes : "",
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
        freightIn: showMoney ? freightIn : "",
        shipments,
        vendorNotes,
        internalNotes: showMoney ? internalNotes : "",
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
      ...EMPTY_LINE,
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
            {purchaseOrderStatusLabel(order.status)}
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
                <tr key={index}>
                  {editable ? (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select line ${index + 1}`}
                        checked={line.selected}
                        onChange={(event) => updateLine(index, { selected: event.target.checked })}
                      />
                    </td>
                  ) : null}
                  <td className="po-item">
                    {line.itemId ? (
                      <div className="po-item-id">
                        {line.itemSku} - {line.itemName}
                      </div>
                    ) : null}
                    {editable ? (
                      <div className="combo po-find">
                        <input
                          value={line.query}
                          onChange={(event) => updateLine(index, { query: event.target.value })}
                          placeholder={line.itemId ? "Change item" : "SKU or name"}
                          autoComplete="off"
                          aria-label={`Find item for line ${index + 1}`}
                        />
                        <button type="button" className="secondary" onClick={() => void findItem(index)}>
                          Find
                        </button>
                        {line.itemId ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => updateLine(index, { itemId: "", itemSku: "", itemName: "", hits: [] })}
                          >
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
                                onClick={() =>
                                  updateLine(index, {
                                    itemId: hit.id,
                                    itemSku: hit.sku,
                                    itemName: hit.name,
                                    description: descriptionFromPickedItem(hit.description),
                                    hits: [],
                                    query: "",
                                  })
                                }
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
                  <td className="po-desc">
                    <input
                      aria-label={`Description for line ${index + 1}`}
                      value={line.description}
                      placeholder="Item description"
                      onChange={(event) => updateLine(index, { description: event.target.value })}
                      readOnly={!editable}
                    />
                  </td>
                  <td className="po-num">
                    <input
                      aria-label={`Quantity for line ${index + 1}`}
                      value={line.qty}
                      onChange={(event) => editPrice(index, "qty", event.target.value)}
                      readOnly={!editable}
                      inputMode="decimal"
                    />
                  </td>
                  <td className="po-unit">
                    <input
                      aria-label={`Unit for line ${index + 1}`}
                      value={line.unit}
                      onChange={(event) => updateLine(index, { unit: event.target.value })}
                      readOnly={!editable}
                    />
                  </td>
                  {showMoney ? (
                    <td className="po-num">
                      <input
                        aria-label={`Unit price for line ${index + 1}`}
                        value={line.unitCost}
                        onChange={(event) => editPrice(index, "unit", event.target.value)}
                        onBlur={() => blurPrice(index, "unit")}
                        readOnly={!editable}
                        inputMode="decimal"
                      />
                    </td>
                  ) : null}
                  {showMoney ? (
                    <td className="po-num">
                      <input
                        aria-label={`Extension for line ${index + 1}`}
                        value={line.extPrice}
                        onChange={(event) => editPrice(index, "ext", event.target.value)}
                        onBlur={() => blurPrice(index, "ext")}
                        readOnly={!editable}
                        inputMode="decimal"
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            {showMoney ? (
              <OrderTotals
                lines={lines}
                freightIn={freightIn}
                editable={chargesEditable}
                labelSpan={(editable ? 1 : 0) + 5}
                onFreight={setFreightIn}
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
            <button type="button" className="secondary" onClick={addLines}>
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
            <textarea value={vendorNotes} onChange={(event) => setVendorNotes(event.target.value)} readOnly={!chargesEditable} />
            <span className="hint">Printed or sent to the vendor.</span>
          </label>
          {showMoney ? (
            <label>
              Internal notes
              <textarea value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} readOnly={!chargesEditable} />
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
}: {
  lines: LineState[];
  freightIn: string;
  editable: boolean;
  labelSpan: number;
  onFreight: (value: string) => void;
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
          <input
            id="po-freight"
            aria-label="Shipping / Freight-in"
            value={freightIn}
            onChange={(event) => onFreight(event.target.value)}
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
