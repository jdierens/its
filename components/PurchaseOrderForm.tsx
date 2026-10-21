"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorText } from "@/lib/errors";
import { PAYMENT_TERMS } from "@/lib/paymentTerms";
import { SHIPMENT_CARRIERS, parseFreightIn, trackingUrl } from "@/lib/poCharges";
import { purchaseOrderStatusLabel } from "@/lib/purchaseOrderDraft";
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

type LineState = PurchaseOrderLineView & { query: string; hits: PurchaseItemHit[] };

const EMPTY_LINE: LineState = {
  itemId: "",
  itemSku: "",
  description: "",
  qty: "",
  unitCost: "",
  condition: "Used",
  unit: "Piece",
  query: "",
  hits: [],
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
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [lines, setLines] = useState<LineState[]>(
    order && order.lines.length > 0 ? order.lines.map((line) => ({ ...line, query: "", hits: [] })) : [{ ...EMPTY_LINE }],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateLine(index: number, patch: Partial<LineState>) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
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
        notes,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          description: line.description,
          qty: line.qty,
          unitCost: line.unitCost,
          condition: line.condition,
          unit: line.unit,
        })),
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
      await savePurchaseOrderCharges(order.id, { freightIn: showMoney ? freightIn : "", shipments });
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

  return (
    <main className="page">
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
        <div className="grid">
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
            Ordered
            <input type="date" value={orderedOn} onChange={(event) => setOrderedOn(event.target.value)} readOnly={!editable} />
          </label>
          <label>
            Expected
            <input type="date" value={expectedOn} onChange={(event) => setExpectedOn(event.target.value)} readOnly={!editable} />
          </label>
        </div>
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
        {showMoney ? (
          <label>
            Freight in
            <input
              value={freightIn}
              onChange={(event) => setFreightIn(event.target.value)}
              readOnly={!chargesEditable}
              inputMode="decimal"
              placeholder="0.00"
            />
            <span className="hint">USD. Often entered after the order is sent. Added to the order total, not to a line.</span>
          </label>
        ) : null}
        {showMoney ? <OrderTotals lines={lines} freightIn={freightIn} /> : null}
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} readOnly={!editable} />
        </label>
        {lines.map((line, index) => (
          <fieldset key={index}>
            <legend>Line {index + 1}</legend>
            <div className="grid">
              <label>
                Description
                <input
                  value={line.description}
                  onChange={(event) => updateLine(index, { description: event.target.value })}
                  readOnly={!editable}
                />
                {line.itemSku ? <span className="hint">Item {line.itemSku}</span> : null}
              </label>
              {editable ? (
                <label>
                  Find item
                  <input
                    value={line.query}
                    onChange={(event) => updateLine(index, { query: event.target.value })}
                    placeholder="SKU or name"
                    autoComplete="off"
                  />
                  <span className="actions">
                    <button type="button" className="secondary" onClick={() => void findItem(index)}>
                      Find
                    </button>
                    {line.itemId ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => updateLine(index, { itemId: "", itemSku: "", hits: [] })}
                      >
                        Clear item
                      </button>
                    ) : null}
                  </span>
                  {line.hits.length > 0 ? (
                    <span className="actions">
                      {line.hits.map((hit) => (
                        <button
                          key={hit.id}
                          type="button"
                          className="secondary"
                          onClick={() =>
                            updateLine(index, {
                              itemId: hit.id,
                              itemSku: hit.sku,
                              description: line.description || hit.name,
                              hits: [],
                              query: "",
                            })
                          }
                        >
                          {hit.sku} {hit.name}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </label>
              ) : null}
              <label>
                Quantity
                <input value={line.qty} onChange={(event) => updateLine(index, { qty: event.target.value })} readOnly={!editable} inputMode="decimal" />
              </label>
              {showMoney ? (
                <label>
                  Unit cost
                  <input
                    value={line.unitCost}
                    onChange={(event) => updateLine(index, { unitCost: event.target.value })}
                    readOnly={!editable}
                    inputMode="decimal"
                  />
                </label>
              ) : null}
              <label>
                Condition
                {editable ? (
                  <select value={line.condition} onChange={(event) => updateLine(index, { condition: event.target.value })}>
                    <option value="Used">Used</option>
                    <option value="New">New</option>
                  </select>
                ) : (
                  <input value={line.condition} readOnly />
                )}
              </label>
              <label>
                Unit
                <input value={line.unit} onChange={(event) => updateLine(index, { unit: event.target.value })} readOnly={!editable} />
              </label>
            </div>
            {editable && lines.length > 1 ? (
              <button type="button" className="secondary" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>
                Remove line
              </button>
            ) : null}
          </fieldset>
        ))}
        <fieldset>
          <legend>Tracking</legend>
          {shipments.length === 0 && !chargesEditable ? <p className="muted">No tracking numbers yet.</p> : null}
          {shipments.map((shipment, index) => {
            const href = trackingUrl(shipment.carrier, shipment.trackingNumber);
            return (
              <div className="grid" key={index}>
                <label>
                  Carrier
                  {chargesEditable ? (
                    <select
                      value={shipment.carrier}
                      onChange={(event) =>
                        setShipments((current) =>
                          current.map((row, rowIndex) => (rowIndex === index ? { ...row, carrier: event.target.value } : row)),
                        )
                      }
                    >
                      <option value="">Choose a carrier</option>
                      {SHIPMENT_CARRIERS.map((carrier) => (
                        <option key={carrier} value={carrier}>
                          {carrier}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input value={shipment.carrier} readOnly />
                  )}
                </label>
                <label>
                  Tracking number
                  {chargesEditable ? (
                    <input
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
                  ) : href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {shipment.trackingNumber}
                    </a>
                  ) : (
                    <input value={shipment.trackingNumber} readOnly />
                  )}
                  {chargesEditable && href ? (
                    <span className="hint">
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        Open tracking
                      </a>
                    </span>
                  ) : null}
                </label>
                {chargesEditable ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setShipments((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                  >
                    Remove shipment
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
          <p className="hint">A purchase order can arrive in more than one shipment. A receipt can point at one of these later.</p>
        </fieldset>
        {editable ? (
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}>
              Add line
            </button>
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
              {saving ? "Saving…" : showMoney ? "Save freight and tracking" : "Save tracking"}
            </button>
          </div>
        ) : null}
      </form>
    </main>
  );
}

function OrderTotals({ lines, freightIn }: { lines: LineState[]; freightIn: string }) {
  let cents = 0;
  let complete = true;
  for (const line of lines) {
    if (!line.qty.trim() && !line.unitCost.trim()) continue;
    if (!line.qty.trim() || !line.unitCost.trim()) {
      complete = false;
      break;
    }
    const qty = Number(line.qty);
    const cost = Number(line.unitCost.replace(/[$,]/g, ""));
    if (!Number.isFinite(qty) || !Number.isFinite(cost)) {
      complete = false;
      break;
    }
    cents += Math.round(qty * cost * 100);
  }
  const subtotal = complete ? cents / 100 : null;
  const freight = parseFreightIn(freightIn);
  const freightAmount = freight === "invalid" ? null : freight;
  const total = subtotal == null || freight === "invalid" ? null : subtotal + (freightAmount ?? 0);
  return (
    <p className="page-note">
      Subtotal {formatMoney(subtotal)}
      {" · "}
      Freight in {freight === "invalid" ? "—" : formatMoney(freightAmount)}
      {" · "}
      Total {formatMoney(total)}
    </p>
  );
}
