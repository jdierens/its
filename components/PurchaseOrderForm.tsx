"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorText } from "@/lib/errors";
import { purchaseOrderStatusLabel } from "@/lib/purchaseOrderDraft";
import {
  cancelPurchaseOrder,
  savePurchaseOrder,
  searchPurchaseItems,
  sendPurchaseOrder,
  type PurchaseItemHit,
  type PurchaseOrderLineView,
  type PurchaseOrderView,
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
  const [vendorId, setVendorId] = useState(order?.vendorId ?? vendors[0]?.id ?? "");
  const [fulfillment, setFulfillment] = useState(order?.fulfillment ?? "warehouse");
  const [terms, setTerms] = useState(order?.terms ?? "");
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
            <input value={terms} onChange={(event) => setTerms(event.target.value)} readOnly={!editable} />
          </label>
        ) : null}
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
      </form>
    </main>
  );
}
