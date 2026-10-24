"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SalesOrderAttachments } from "@/components/SalesOrderAttachments";
import { Badge } from "@/components/ui/badge";
import { errorText } from "@/lib/errors";
import {
  allocationsCover,
  emptyAddress,
  INCOTERMS,
  lineExtension,
  salesOrderStatusLabel,
  SO_CURRENCIES,
  SO_NOTE_KINDS,
  type SoAddress,
  type SoDraftInput,
} from "@/lib/salesOrderDraft";
import {
  approveSalesOrder,
  cancelSalesOrder,
  salesCustomerDefaults,
  saveSalesOrder,
  searchSalesCustomers,
  suggestSalesSkus,
  type SalesCustomerHit,
  type SalesLineView,
  type SalesLookups,
  type SalesNoteView,
  type SalesOrderView,
  type SalesSkuHit,
} from "@/lib/salesOrders";

type FormAllocation = { itemId: string; sku: string; name: string; qty: string };
type FormLine = Omit<SalesLineView, "allocations" | "extPrice"> & { allocations: FormAllocation[] };

const NOTE_RESPONSES = [
  { id: "", label: "No response yet" },
  { id: "accepted", label: "Accepted" },
  { id: "countered", label: "Countered" },
  { id: "ignored", label: "Ignored" },
];

export function SalesOrderForm({
  order,
  lookups,
  canEdit,
  showMoney,
  today,
}: {
  order: SalesOrderView | null;
  lookups: SalesLookups;
  canEdit: boolean;
  showMoney: boolean;
  today: string;
}) {
  const router = useRouter();
  const locked = !canEdit || (order != null && order.status !== "draft");
  const [orderId, setOrderId] = useState(order?.id ?? null);
  const [customerId, setCustomerId] = useState(order?.customerId ?? "");
  const [customerName, setCustomerName] = useState(order?.customerName ?? "");
  const [customerQuery, setCustomerQuery] = useState(order?.customerName ?? "");
  const [customerHits, setCustomerHits] = useState<SalesCustomerHit[]>([]);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerPo, setCustomerPo] = useState(order?.customerPo ?? "");
  const [reference, setReference] = useState(order?.reference ?? "");
  const [orderDate, setOrderDate] = useState(order?.orderDate || today);
  const [shipDate, setShipDate] = useState(order?.shipDate ?? "");
  const [billTo, setBillTo] = useState<SoAddress>(order?.billTo ?? emptyAddress());
  const [shipTo, setShipTo] = useState<SoAddress>(order?.shipTo ?? emptyAddress());
  const [saveAddress, setSaveAddress] = useState(false);
  const [terms, setTerms] = useState(order?.terms ?? "");
  const [incoterms, setIncoterms] = useState(order?.incoterms ?? "");
  const [shipMethod, setShipMethod] = useState(order?.shipMethod ?? "");
  const [carrierAccount, setCarrierAccount] = useState(order?.carrierAccount ?? "");
  const [currency, setCurrency] = useState(order?.currency || "USD");
  const [salesRep, setSalesRep] = useState(order?.salesRep ?? "");
  const [paymentRequirement, setPaymentRequirement] = useState(order?.paymentRequirement || "terms");
  const [exportNotes, setExportNotes] = useState(order?.exportNotes ?? "");
  const [internalNotes, setInternalNotes] = useState(order?.internalNotes ?? "");
  const [lines, setLines] = useState<FormLine[]>(order?.lines.length ? order.lines : [blankLine()]);
  const [notes, setNotes] = useState<SalesNoteView[]>(order?.notes ?? []);
  const [suggestions, setSuggestions] = useState<Record<number, SalesSkuHit[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const query = customerQuery.trim();
    if (!query || query === customerName) {
      setCustomerHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchSalesCustomers(query)
        .then(setCustomerHits)
        .catch((error) => setMessage(errorText(error)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customerQuery, customerName]);

  function draft(): SoDraftInput {
    return {
      id: orderId,
      customerId,
      customerPo,
      reference,
      orderDate,
      shipDate,
      billTo,
      shipTo,
      terms,
      incoterms,
      shipMethod,
      carrierAccount,
      currency,
      salesRep,
      exportNotes,
      internalNotes,
      paymentRequirement,
      lines: lines.map((line) => ({
        customerPartNumber: line.customerPartNumber,
        customerDescription: line.customerDescription,
        qty: line.qty,
        unitPrice: showMoney ? line.unitPrice : "",
        condition: line.condition,
        allocations: line.allocations.map((row) => ({ itemId: row.itemId, qty: row.qty })),
      })),
      notes,
      saveAddressToCustomer: saveAddress,
    };
  }

  async function pickCustomer(hit: SalesCustomerHit) {
    setCustomerId(hit.id);
    setCustomerName(hit.name);
    setCustomerQuery(hit.name);
    setCustomerOpen(false);
    setMessage(null);
    try {
      const defaults = await salesCustomerDefaults(hit.id);
      if (!defaults) return;
      setBillTo(defaults.billTo);
      setShipTo(defaults.shipTo);
      setCustomerPo(defaults.customerPo);
      setReference(defaults.reference);
      setOrderDate(defaults.orderDate || today);
      setShipDate(defaults.shipDate);
      setTerms(defaults.terms);
      setIncoterms(defaults.incoterms);
      setShipMethod(defaults.shipMethod);
      setCarrierAccount(defaults.carrierAccount);
      if (defaults.currency) setCurrency(defaults.currency);
      if (defaults.salesRep) setSalesRep(defaults.salesRep);
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  function updateLine(index: number, patch: Partial<FormLine>) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  async function loadSuggestions(index: number, part: string) {
    try {
      const hits = await suggestSalesSkus(part);
      setSuggestions((current) => ({ ...current, [index]: hits }));
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  function addAllocation(index: number, hit: SalesSkuHit) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        if (line.allocations.some((row) => row.itemId === hit.id)) return line;
        const used = line.allocations.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
        const remaining = Math.round((Number(line.qty) - used) * 100) / 100;
        return {
          ...line,
          allocations: [
            ...line.allocations,
            { itemId: hit.id, sku: hit.sku, name: hit.name, qty: remaining > 0 ? String(remaining) : "1" },
          ],
        };
      }),
    );
  }

  async function onSave() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveSalesOrder(draft());
      setOrderId(saved.id);
      if (saved.addressWarning) setMessage(saved.addressWarning);
      if (orderId !== saved.id) router.replace(`/sales/orders/${saved.id}`);
      else router.refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function onApprove() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveSalesOrder(draft());
      setOrderId(saved.id);
      const approved = await approveSalesOrder(saved.id);
      if (saved.addressWarning) setMessage(`${saved.addressWarning} Approved as ${approved.soNumber}.`);
      router.replace(`/sales/orders/${saved.id}`);
      router.refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!orderId || !window.confirm("Cancel this sales order?")) return;
    setBusy(true);
    setMessage(null);
    try {
      await cancelSalesOrder(orderId);
      router.refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const status = order?.status ?? "draft";
  const number = order?.number ?? "Draft";
  const filesEditable = canEdit && status !== "cancelled" && status !== "closed";

  return (
    <main className="page so-page">
      <p className="so-identity">
        <span className="sku">{number}</span>
        <Badge tone={status}>{salesOrderStatusLabel(status)}</Badge>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!locked) void onSave();
        }}
      >
        <fieldset>
          <legend>Customer</legend>
          <div className="so-grid">
            <label className="combo wide">
              Customer
              <input
                id="so-customer"
                role="combobox"
                aria-expanded={customerOpen}
                aria-controls="so-customer-list"
                aria-autocomplete="list"
                value={customerQuery}
                autoComplete="off"
                disabled={locked}
                onFocus={() => setCustomerOpen(true)}
                onChange={(event) => {
                  setCustomerQuery(event.target.value);
                  setCustomerOpen(true);
                  if (event.target.value.trim() !== customerName) setCustomerId("");
                }}
                onBlur={() => {
                  window.setTimeout(() => setCustomerOpen(false), 250);
                }}
              />
              {customerOpen && !locked ? (
                <ul className="combo-menu" id="so-customer-list" role="listbox">
                  {customerHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        className="combo-option"
                        role="option"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => void pickCustomer(hit)}
                      >
                        {hit.name}
                      </button>
                    </li>
                  ))}
                  {customerQuery.trim() && customerHits.length === 0 ? <li className="combo-empty">No matching customer.</li> : null}
                </ul>
              ) : null}
            </label>
            <label>
              Customer PO
              <input value={customerPo} disabled={locked} onChange={(event) => setCustomerPo(event.target.value)} />
            </label>
            <label>
              Internal reference
              <input value={reference} disabled={locked} onChange={(event) => setReference(event.target.value)} />
            </label>
            <label>
              Order date
              <input type="date" value={orderDate} disabled={locked} onChange={(event) => setOrderDate(event.target.value)} />
            </label>
            <label>
              Requested ship date
              <input type="date" value={shipDate} disabled={locked} onChange={(event) => setShipDate(event.target.value)} />
            </label>
            <label>
              Terms
              <select value={terms} disabled={locked} onChange={(event) => setTerms(event.target.value)}>
                <option value="">Choose terms</option>
                {lookups.terms.map((term) => (
                  <option key={term.code} value={term.code}>
                    {term.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Incoterms
              <select value={incoterms} disabled={locked} onChange={(event) => setIncoterms(event.target.value)}>
                <option value="">Choose Incoterms</option>
                {INCOTERMS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ship method
              <select value={shipMethod} disabled={locked} onChange={(event) => setShipMethod(event.target.value)}>
                <option value="">Choose a ship method</option>
                {lookups.shipMethods.map((method) => (
                  <option key={method.code} value={method.code}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Carrier account
              <input value={carrierAccount} disabled={locked} onChange={(event) => setCarrierAccount(event.target.value)} />
            </label>
            <label>
              Sales rep
              <input
                value={salesRep}
                maxLength={2}
                autoCapitalize="characters"
                disabled={locked}
                onChange={(event) => setSalesRep(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))}
              />
            </label>
            {showMoney ? (
              <label>
                Currency
                <select value={currency} disabled={locked} onChange={(event) => setCurrency(event.target.value)}>
                  {SO_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Payment
              <select value={paymentRequirement} disabled={locked} onChange={(event) => setPaymentRequirement(event.target.value)}>
                <option value="terms">Terms</option>
                <option value="prepay">Prepay</option>
              </select>
            </label>
          </div>
        </fieldset>

        <div className="so-addresses">
          <AddressFields legend="Bill to" address={billTo} disabled={locked} onChange={setBillTo} />
          <AddressFields legend="Ship to" address={shipTo} disabled={locked} showAttention onChange={setShipTo} />
        </div>
        {!locked ? (
          <label className="so-check">
            <input type="checkbox" checked={saveAddress} onChange={(event) => setSaveAddress(event.target.checked)} />
            Save address to customer
          </label>
        ) : null}

        <fieldset>
          <legend>Lines</legend>
          {lines.map((line, index) => {
            const extension = showMoney ? lineExtension(line.qty, line.unitPrice) : null;
            const covered = allocationsCover(
              line.qty,
              line.allocations.map((row) => ({ itemId: row.itemId, qty: row.qty })),
            );
            return (
              <div className="so-line" key={index}>
                <div className="so-line-head">
                  <strong>Line {index + 1}</strong>
                  {!locked && lines.length > 1 ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}
                    >
                      Remove line
                    </button>
                  ) : null}
                </div>
                <div className="so-grid">
                  <label>
                    Customer part number
                    <input
                      id={`so-line-part-${index}`}
                      value={line.customerPartNumber}
                      disabled={locked}
                      onChange={(event) => updateLine(index, { customerPartNumber: event.target.value })}
                      onBlur={(event) => {
                        if (!locked) void loadSuggestions(index, event.target.value);
                      }}
                    />
                  </label>
                  <label>
                    Description
                    <input
                      value={line.customerDescription}
                      disabled={locked}
                      onChange={(event) => updateLine(index, { customerDescription: event.target.value })}
                    />
                  </label>
                </div>
                <div className="so-line-money">
                  <label>
                    Qty
                    <input
                      className="num-input"
                      inputMode="decimal"
                      value={line.qty}
                      disabled={locked}
                      onChange={(event) => updateLine(index, { qty: event.target.value })}
                    />
                  </label>
                  {showMoney ? (
                    <label>
                      Unit price
                      <input
                        className="num-input"
                        inputMode="decimal"
                        value={line.unitPrice}
                        disabled={locked}
                        onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                      />
                    </label>
                  ) : null}
                  {showMoney ? (
                    <label>
                      Ext
                      <input className="num-input" value={extension ?? ""} readOnly tabIndex={-1} />
                    </label>
                  ) : null}
                </div>
                <label>
                  Condition
                  <select value={line.condition} disabled={locked} onChange={(event) => updateLine(index, { condition: event.target.value })}>
                    <option value="">Condition</option>
                    <option value="New">New</option>
                    <option value="Used">Used</option>
                  </select>
                </label>
                {!locked && (suggestions[index]?.length ?? 0) > 0 ? (
                  <div className="so-suggest" id={`so-suggest-${index}`}>
                    {suggestions[index].map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        className="suggestion"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => addAllocation(index, hit)}
                      >
                        {hit.sku} {hit.partNumber}
                      </button>
                    ))}
                  </div>
                ) : null}
                {line.allocations.map((allocation, allocationIndex) => (
                  <div className="so-allocation" key={`${allocation.itemId}-${allocationIndex}`}>
                    <span>
                      {allocation.sku || "SKU"} {allocation.name}
                    </span>
                    <label>
                      Allocated qty
                      <input
                        className="num-input"
                        inputMode="decimal"
                        value={allocation.qty}
                        disabled={locked}
                        onChange={(event) =>
                          updateLine(index, {
                            allocations: line.allocations.map((row, rowIndex) =>
                              rowIndex === allocationIndex ? { ...row, qty: event.target.value } : row,
                            ),
                          })
                        }
                      />
                    </label>
                    {!locked ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          updateLine(index, {
                            allocations: line.allocations.filter((_, rowIndex) => rowIndex !== allocationIndex),
                          })
                        }
                      >
                        Remove SKU
                      </button>
                    ) : null}
                  </div>
                ))}
                <p className={covered ? "hint" : "hint so-gap"}>{covered ? "Allocated." : "Allocate this line to SKUs that add up to the quantity."}</p>
              </div>
            );
          })}
          {!locked ? (
            <button type="button" className="secondary" onClick={() => setLines((current) => [...current, blankLine()])}>
              Add line
            </button>
          ) : null}
        </fieldset>

        <fieldset>
          <legend>Customer notes</legend>
          {notes.map((note, index) => (
            <div className="so-note" key={index}>
              <label>
                Kind
                <select
                  value={note.kind}
                  disabled={locked}
                  onChange={(event) => setNotes((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, kind: event.target.value } : row)))}
                >
                  {SO_NOTE_KINDS.map((kind) => (
                    <option key={kind.id} value={kind.id}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Note
                <textarea
                  value={note.customerText}
                  disabled={locked}
                  onChange={(event) =>
                    setNotes((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, customerText: event.target.value } : row)))
                  }
                />
              </label>
              <label>
                Response
                <select
                  value={note.response}
                  disabled={locked}
                  onChange={(event) =>
                    setNotes((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, response: event.target.value } : row)))
                  }
                >
                  {NOTE_RESPONSES.map((response) => (
                    <option key={response.id || "none"} value={response.id}>
                      {response.label}
                    </option>
                  ))}
                </select>
              </label>
              {note.response === "countered" ? (
                <label>
                  Counter
                  <textarea
                    value={note.counterText}
                    disabled={locked}
                    onChange={(event) =>
                      setNotes((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, counterText: event.target.value } : row)))
                    }
                  />
                </label>
              ) : null}
              {!locked ? (
                <button type="button" className="secondary" onClick={() => setNotes((current) => current.filter((_, rowIndex) => rowIndex !== index))}>
                  Remove note
                </button>
              ) : null}
            </div>
          ))}
          {!locked ? (
            <button
              type="button"
              className="secondary"
              onClick={() => setNotes((current) => [...current, { kind: "other", customerText: "", response: "", counterText: "" }])}
            >
              Add note
            </button>
          ) : null}
        </fieldset>

        {showMoney ? (
          <label>
            Internal notes
            <textarea value={internalNotes} disabled={locked} onChange={(event) => setInternalNotes(event.target.value)} />
          </label>
        ) : null}
        <label>
          Export notes
          <textarea value={exportNotes} disabled={locked} onChange={(event) => setExportNotes(event.target.value)} />
        </label>

        {showMoney ? (
          <SalesOrderAttachments orderId={orderId} attachments={order?.attachments ?? []} canEdit={filesEditable} />
        ) : null}

        {order && order.events.length > 0 ? (
          <fieldset>
            <legend>History</legend>
            <ul className="so-events">
              {order.events.map((event, index) => (
                <li key={`${event.occurredAt}-${index}`}>
                  <span>{event.event.replaceAll("_", " ")}</span>
                  <span className="num">{event.operatorLabel}</span>
                  <time dateTime={event.occurredAt}>{formatWhen(event.occurredAt)}</time>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        {message ? (
          <p className="banner error" role="alert">
            {message}
          </p>
        ) : null}

        <div className="actions">
          {!locked ? (
            <button id="so-save" type="submit" disabled={busy}>
              Save draft
            </button>
          ) : null}
          {!locked ? (
            <button id="so-approve" type="button" disabled={busy} onClick={() => void onApprove()}>
              Approve
            </button>
          ) : null}
          {orderId && canEdit && status !== "cancelled" && status !== "closed" ? (
            <button id="so-cancel" type="button" className="secondary" disabled={busy} onClick={() => void onCancel()}>
              Cancel order
            </button>
          ) : null}
        </div>
      </form>
    </main>
  );
}

function AddressFields({
  legend,
  address,
  disabled,
  showAttention = false,
  onChange,
}: {
  legend: string;
  address: SoAddress;
  disabled: boolean;
  showAttention?: boolean;
  onChange: (address: SoAddress) => void;
}) {
  function set(key: keyof SoAddress, value: string) {
    onChange({ ...address, [key]: value });
  }
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="so-grid">
        <label className="wide">
          Line 1
          <input value={address.line1} disabled={disabled} onChange={(event) => set("line1", event.target.value)} />
        </label>
        <label className="wide">
          Line 2
          <input value={address.line2} disabled={disabled} onChange={(event) => set("line2", event.target.value)} />
        </label>
        {showAttention ? (
          <label>
            Attention
            <input value={address.attention} disabled={disabled} onChange={(event) => set("attention", event.target.value)} />
          </label>
        ) : null}
        {showAttention ? (
          <label>
            Phone
            <input value={address.phone} disabled={disabled} onChange={(event) => set("phone", event.target.value)} />
          </label>
        ) : null}
        <label>
          City
          <input value={address.city} disabled={disabled} onChange={(event) => set("city", event.target.value)} />
        </label>
        <label>
          State
          <input value={address.countrySubDivisionCode} disabled={disabled} onChange={(event) => set("countrySubDivisionCode", event.target.value)} />
        </label>
        <label>
          Postal code
          <input value={address.postalCode} disabled={disabled} onChange={(event) => set("postalCode", event.target.value)} />
        </label>
        <label>
          Country
          <input value={address.country} disabled={disabled} onChange={(event) => set("country", event.target.value)} />
        </label>
      </div>
    </fieldset>
  );
}

function blankLine(): FormLine {
  return {
    customerPartNumber: "",
    customerDescription: "",
    qty: "1",
    unitPrice: "",
    condition: "",
    allocations: [],
  };
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Los_Angeles",
  }).format(date);
}
