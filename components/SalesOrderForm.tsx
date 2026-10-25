"use client";

import { Ban, Check, Save } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { applyPackToLine, parsePackLabel } from "@/lib/ebay/packs";
import { useRouter } from "next/navigation";
import { SalesOrderAttachments } from "@/components/SalesOrderAttachments";
import { Badge } from "@/components/ui/badge";
import { errorText } from "@/lib/errors";
import {
  allocationsCover,
  emptyAddress,
  formatSalesMoney,
  formatSalesOrderNumber,
  INCOTERMS,
  lineExtension,
  lineRequiresItem,
  syncSalesLineMoney,
  parseSalesOrderNumber,
  salesOrderStatusLabel,
  salesOrderTotal,
  sellerNet,
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
type FormLine = Omit<SalesLineView, "allocations"> & { allocations: FormAllocation[] };

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
  suggestedNumber,
}: {
  order: SalesOrderView | null;
  lookups: SalesLookups;
  canEdit: boolean;
  showMoney: boolean;
  today: string;
  suggestedNumber: number | null;
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
  // Preserved on save so an existing sales_orders.reference is not cleared. The form does not show it.
  const [reference] = useState(order?.reference ?? "");
  const [channel, setChannel] = useState(order?.channel ?? "");
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
  const [paymentRequirement] = useState(order?.paymentRequirement || "terms");
  const [paymentMethod, setPaymentMethod] = useState(order?.paymentMethod ?? "");
  const [paymentDate, setPaymentDate] = useState(order?.paymentDate ?? "");
  const [paymentRef, setPaymentRef] = useState(order?.paymentRef ?? "");
  const [paymentAmount, setPaymentAmount] = useState(order?.paymentAmount ?? "");
  const [ebayTransactionFee, setEbayTransactionFee] = useState(order?.ebayTransactionFee ?? "");
  const [ebayLabelFee, setEbayLabelFee] = useState(order?.ebayLabelFee ?? "");
  const [ebayAdFee, setEbayAdFee] = useState(order?.ebayAdFee ?? "");
  const [ebayOrderEarnings, setEbayOrderEarnings] = useState(order?.ebayOrderEarnings ?? "");
  const [exportNotes, setExportNotes] = useState(order?.exportNotes ?? "");
  const [internalNotes, setInternalNotes] = useState(order?.internalNotes ?? "");
  const [lines, setLines] = useState<FormLine[]>(
    order?.lines.length ? order.lines.map((line) => ({ ...line, extPrice: line.extPrice || lineExtension(line.qty, line.unitPrice) || "" })) : [blankLine()],
  );
  const [notes, setNotes] = useState<SalesNoteView[]>(order?.notes ?? []);
  const [orderNumber, setOrderNumber] = useState(
    order?.number ?? (suggestedNumber ? formatSalesOrderNumber(suggestedNumber) ?? "" : ""),
  );
  const [suggestions, setSuggestions] = useState<Record<number, SalesSkuHit[]>>({});
  const [allocateQuery, setAllocateQuery] = useState<Record<number, string>>({});
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
      channel,
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
      paymentMethod,
      paymentDate,
      paymentRef,
      paymentAmount: showMoney ? paymentAmount : "",
      ebayTransactionFee: showMoney ? ebayTransactionFee : "",
      ebayLabelFee: showMoney ? ebayLabelFee : "",
      ebayAdFee: showMoney ? ebayAdFee : "",
      ebayOrderEarnings: showMoney ? ebayOrderEarnings : "",
      lines: lines.map((line) => ({
        lineKind: line.lineKind || "product",
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
      setChannel(defaults.channel);
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

  function changeLineMoney(index: number, field: "qty" | "unit" | "ext", value: string, commit = false) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const qty = field === "qty" ? value : line.qty;
        if (!showMoney) return { ...line, qty };
        const synced = syncSalesLineMoney({
          qty,
          unitPrice: field === "unit" ? value : line.unitPrice,
          extPrice: field === "ext" ? value : line.extPrice,
          edited: field,
          commit,
        });
        return { ...line, qty, unitPrice: synced.unitPrice, extPrice: synced.extPrice };
      }),
    );
  }

  function pricedFromPack(line: FormLine, qty: string, unitPrice: string): Pick<FormLine, "qty" | "unitPrice" | "extPrice"> {
    if (!showMoney) return { qty, unitPrice: line.unitPrice, extPrice: line.extPrice };
    return { qty, unitPrice, extPrice: lineExtension(qty, unitPrice) ?? line.extPrice };
  }

  function rememberSuggestions(index: number, hits: SalesSkuHit[], part: string, expand: boolean) {
    setSuggestions((current) => ({ ...current, [index]: hits }));
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const fromTyped = applyPackToLine({ part, qty: line.qty, unitPrice: line.unitPrice });
        const fromPn = applyPackToLine({ part: line.customerPartNumber, qty: line.qty, unitPrice: line.unitPrice });
        const applied = fromTyped.packQty != null ? fromTyped : fromPn;
        const open = line.allocations.length === 0;
        const priced = pricedFromPack(
          line,
          expand && open ? applied.qty : line.qty,
          expand && open && showMoney ? applied.unitPrice : line.unitPrice,
        );
        const next = { ...line, ...priced };
        if (!open || hits.length !== 1 || next.allocations.some((row) => row.itemId === hits[0].id)) return next;
        return {
          ...next,
          allocations: [{ itemId: hits[0].id, sku: hits[0].sku, name: hits[0].name, qty: next.qty || "1" }],
        };
      }),
    );
  }

  async function lookupSkus(index: number, part: string, lineKind: string, expand: boolean) {
    if (!lineRequiresItem(lineKind)) {
      setSuggestions((current) => ({ ...current, [index]: [] }));
      return;
    }
    const applied = applyPackToLine({ part, qty: "1", unitPrice: "" });
    const term = applied.search;
    setAllocateQuery((current) => ({ ...current, [index]: term }));
    if (!term) {
      setSuggestions((current) => ({ ...current, [index]: [] }));
      return;
    }
    try {
      const hits = await suggestSalesSkus(term);
      rememberSuggestions(index, hits, part, expand);
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  useEffect(() => {
    let cancelled = false;
    (order?.lines ?? []).forEach((line, index) => {
      if (!lineRequiresItem(line.lineKind || "product")) return;
      const applied = applyPackToLine({ part: line.customerPartNumber, qty: line.qty, unitPrice: line.unitPrice });
      if (!applied.search) return;
      setAllocateQuery((current) => ({ ...current, [index]: applied.search }));
      void suggestSalesSkus(applied.search)
        .then((hits) => {
          if (!cancelled) rememberSuggestions(index, hits, line.customerPartNumber, true);
        })
        .catch((error) => {
          if (!cancelled) setMessage(errorText(error));
        });
    });
    return () => {
      cancelled = true;
    };
    // Look up the saved customer part once, including a pack suffix already on the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  function addAllocation(index: number, hit: SalesSkuHit) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        if (line.allocations.some((row) => row.itemId === hit.id)) return line;
        const applied = applyPackToLine({ part: line.customerPartNumber, qty: line.qty, unitPrice: line.unitPrice });
        const open = line.allocations.length === 0;
        const next = {
          ...line,
          ...pricedFromPack(line, open ? applied.qty : line.qty, open && showMoney ? applied.unitPrice : line.unitPrice),
        };
        const used = next.allocations.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
        const remaining = Math.round((Number(next.qty) - used) * 100) / 100;
        return {
          ...next,
          allocations: [
            ...next.allocations,
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
      const chosen = parseSalesOrderNumber(orderNumber);
      if (!chosen) {
        setMessage("Enter a sales order number like SO27766.");
        setBusy(false);
        return;
      }
      const saved = await saveSalesOrder(draft());
      setOrderId(saved.id);
      const approved = await approveSalesOrder(saved.id, chosen);
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
  const ebayOrder = Boolean(order?.ebayOrderId || order?.ebaySalesRecordRef);
  const buyerTotal = showMoney
    ? salesOrderTotal(lines.map((line) => ({ extPrice: line.extPrice || lineExtension(line.qty, line.unitPrice) || "" })))
    : null;
  const net = showMoney ? sellerNet(ebayOrderEarnings, ebayLabelFee) : null;

  return (
    <main className="page so-page ds">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!locked) void onSave();
        }}
      >
        <div className="so-sticky">
          <div className="so-sticky-lead">
            <p className="so-identity">
              <span className="sku">{number}</span>
              <Badge tone={status}>{salesOrderStatusLabel(status)}</Badge>
            </p>
            {!locked ? (
              <label className="so-number-field">
                Sales order number
                <input
                  id="so-number"
                  value={orderNumber}
                  autoCapitalize="characters"
                  aria-describedby="so-number-hint"
                  onChange={(event) => setOrderNumber(event.target.value.toUpperCase())}
                />
              </label>
            ) : null}
          </div>
          <div className="so-sticky-actions">
            {!locked ? (
              <button id="so-save" className="so-icon-action" type="submit" disabled={busy} aria-label="Save draft" title="Save draft">
                <Save size={18} strokeWidth={1.75} aria-hidden />
              </button>
            ) : null}
            {!locked ? (
              <button id="so-approve" className="so-icon-action" type="button" disabled={busy} aria-label="Approve" title="Approve" onClick={() => void onApprove()}>
                <Check size={18} strokeWidth={1.75} aria-hidden />
              </button>
            ) : null}
            {orderId && canEdit && status !== "cancelled" && status !== "closed" ? (
              <button
                id="so-cancel"
                className="so-icon-action secondary"
                type="button"
                disabled={busy}
                aria-label="Cancel order"
                title="Cancel order"
                onClick={() => void onCancel()}
              >
                <Ban size={18} strokeWidth={1.75} aria-hidden />
              </button>
            ) : null}
          </div>
          {!locked ? (
            <p id="so-number-hint" className="hint">
              Suggested first available number. Type another number if that one should be skipped. It is saved when you approve.
            </p>
          ) : null}
          {message ? (
            <p className="banner error" role="alert">
              {message}
            </p>
          ) : null}
        </div>
        <header className="ds-banner">
          {order?.ebaySalesRecordRef || order?.buyerName || order?.buyerUsername ? (
            <dl className="so-ebay-refs">
              {order.ebaySalesRecordRef ? (
                <>
                  <dt>Sales record number</dt>
                  <dd>{order.ebaySalesRecordRef}</dd>
                </>
              ) : null}
              {order.buyerName || order.buyerUsername ? (
                <>
                  <dt>Buyer</dt>
                  <dd>{[order.buyerName, order.buyerUsername ? `(${order.buyerUsername})` : ""].filter(Boolean).join(" ")}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
          <div className="so-head-row">
          <label>
            Channel
            <select id="so-channel" value={channel} disabled={locked} onChange={(event) => setChannel(event.target.value)}>
              <option value="">Choose a channel</option>
              {lookups.channels.map((row) => (
                <option key={row.code} value={row.code}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sales rep initials
            <input
              value={salesRep}
              maxLength={2}
              autoCapitalize="characters"
              disabled={locked}
              onChange={(event) => setSalesRep(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))}
            />
          </label>
          <label className="combo">
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
            Order date
            <input type="date" value={orderDate} disabled={locked} onChange={(event) => setOrderDate(event.target.value)} />
          </label>
          <label>
            Order reference
            {order?.ebayOrderId ? (
              <input value={order.ebayOrderId} disabled />
            ) : (
              <input value={customerPo} disabled={locked} onChange={(event) => setCustomerPo(event.target.value)} />
            )}
            {order?.ebayOrderId ? <span className="hint">eBay order id</span> : null}
          </label>
        </div>
        </header>
        <div className="so-workspace">
          <aside className="so-aside">
            <details className="ds-drawer" open>
              <summary>Terms and shipping</summary>
              <div className="so-head-row">
          <label>
            Currency
            <select value={currency} disabled={locked || !showMoney} onChange={(event) => setCurrency(event.target.value)}>
              {SO_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment terms
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
        </div>
            </details>

        <fieldset className="so-notes">
          <legend>Notes</legend>
          <label>
            Notes
            <textarea value={exportNotes} disabled={locked} onChange={(event) => setExportNotes(event.target.value)} />
            <span className="hint">Other details read from the customer PDF.</span>
          </label>
          {showMoney ? (
            <label>
              Internal notes
              <textarea value={internalNotes} disabled={locked} onChange={(event) => setInternalNotes(event.target.value)} />
            </label>
          ) : null}
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
          </aside>
          <div className="so-main">
        <fieldset>
          <legend>Lines</legend>
          <div className="so-lines-scroll">
            <table className="so-lines">
              <thead>
                <tr>
                  <th>Customer part number</th>
                  <th>Customer description</th>
                  <th className="num">Customer qty</th>
                  {showMoney ? <th className="num">Customer unit</th> : null}
                  {showMoney ? <th className="num">Cust ext</th> : null}
                  <th className="so-line-remove" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const needsItem = lineRequiresItem(line.lineKind);
                  const pack = parsePackLabel(line.customerPartNumber);
                  const allocatedQty = line.allocations.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
                  const covered = allocationsCover(
                    line.qty,
                    line.allocations.map((row) => ({ itemId: row.itemId, qty: row.qty })),
                  );
                  return (
                    <Fragment key={index}>
                      <tr>
                        <td>
                          <input
                            id={`so-line-part-${index}`}
                            aria-label={`Customer part number ${index + 1}`}
                            value={line.customerPartNumber}
                            disabled={locked}
                            onChange={(event) => updateLine(index, { customerPartNumber: event.target.value })}
                            onBlur={(event) => {
                              if (!locked) void lookupSkus(index, event.target.value, line.lineKind, true);
                            }}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Customer description ${index + 1}`}
                            value={line.customerDescription}
                            disabled={locked}
                            onChange={(event) => updateLine(index, { customerDescription: event.target.value })}
                          />
                        </td>
                        <td className="num">
                          <input
                            className="num-input"
                            aria-label={`Customer qty ${index + 1}`}
                            inputMode="decimal"
                            value={line.qty}
                            disabled={locked}
                            onChange={(event) => changeLineMoney(index, "qty", event.target.value)}
                            onBlur={(event) => changeLineMoney(index, "qty", event.target.value, true)}
                          />
                        </td>
                        {showMoney ? (
                          <td className="num">
                            <input
                              className="num-input"
                              aria-label={`Customer unit ${index + 1}`}
                              inputMode="decimal"
                              value={line.unitPrice}
                              disabled={locked}
                              onChange={(event) => changeLineMoney(index, "unit", event.target.value)}
                              onBlur={(event) => changeLineMoney(index, "unit", event.target.value, true)}
                            />
                          </td>
                        ) : null}
                        {showMoney ? (
                          <td className="num">
                            <input
                              className="num-input"
                              aria-label={`Cust ext ${index + 1}`}
                              inputMode="decimal"
                              value={line.extPrice}
                              disabled={locked}
                              onChange={(event) => changeLineMoney(index, "ext", event.target.value)}
                              onBlur={(event) => changeLineMoney(index, "ext", event.target.value, true)}
                            />
                          </td>
                        ) : null}
                        <td className="so-line-remove">
                          {!locked && lines.length > 1 ? (
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}
                            >
                              Remove
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      <tr className="so-line-extra">
                        <td colSpan={showMoney ? 6 : 4}>
                          {needsItem ? (
                            <div className="so-allocate">
                              <p className="hint">
                                Pick one or more ITS items. Their quantities have to add up to the line quantity
                                {pack ? `. ${line.customerPartNumber.trim()} is ${pack.packQty} × ${pack.baseSku}` : ""}.
                              </p>
                              {!locked ? (
                                <div className="so-find-sku">
                                  <label>
                                    Find SKU
                                    <input
                                      id={`so-allocate-${index}`}
                                      value={allocateQuery[index] ?? ""}
                                      placeholder="ITS SKU"
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setAllocateQuery((current) => ({ ...current, [index]: value }));
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          event.preventDefault();
                                          void lookupSkus(index, event.currentTarget.value || line.customerPartNumber, line.lineKind, true);
                                        }
                                      }}
                                      onBlur={(event) => {
                                        void lookupSkus(index, event.target.value || line.customerPartNumber, line.lineKind, true);
                                      }}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => void lookupSkus(index, allocateQuery[index] || line.customerPartNumber, line.lineKind, true)}
                                  >
                                    Find SKU
                                  </button>
                                </div>
                              ) : null}
                              {(suggestions[index]?.length ?? 0) > 0 ? (
                                <div className="so-suggest" id={`so-suggest-${index}`}>
                                  {suggestions[index].map((hit) => (
                                    <button
                                      key={hit.id}
                                      type="button"
                                      className="suggestion"
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => addAllocation(index, hit)}
                                    >
                                      Allocate {hit.sku}
                                      {hit.partNumber ? ` ${hit.partNumber}` : ""}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <p className="hint">This line does not need an ITS item.</p>
                          )}
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
                          {needsItem || line.allocations.length > 0 ? (
                            <p className={covered ? "hint" : "hint so-gap"}>
                              {covered
                                ? `Allocated ${allocatedQty} of ${line.qty}.`
                                : `Allocated ${allocatedQty} of ${line.qty}. Add ITS items until the quantities match.`}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!locked ? (
            <button type="button" className="secondary" onClick={() => setLines((current) => [...current, blankLine()])}>
              Add line
            </button>
          ) : null}
        </fieldset>

        {showMoney ? (
          <fieldset>
            <legend>eBay</legend>
            <div className="so-pay-row">
              <label>
                eBay transaction fee
                <input id="so-ebay-transaction-fee" className="num-input" inputMode="decimal" value={ebayTransactionFee} disabled={locked} onChange={(event) => setEbayTransactionFee(event.target.value)} />
              </label>
              <label>
                eBay label fee
                <input className="num-input" inputMode="decimal" value={ebayLabelFee} disabled={locked} onChange={(event) => setEbayLabelFee(event.target.value)} />
                <span className="hint">Deducted when a label is bought on eBay. The next order pull fills this in.</span>
              </label>
              <label>
                eBay ad fee
                <input className="num-input" inputMode="decimal" value={ebayAdFee} disabled={locked} onChange={(event) => setEbayAdFee(event.target.value)} />
              </label>
              <label>
                Seller earnings
                <input className="num-input" inputMode="decimal" value={ebayOrderEarnings} disabled={locked} onChange={(event) => setEbayOrderEarnings(event.target.value)} />
                <span className="hint">eBay&apos;s total due the seller. Marketplace fees are already out. A shipping label is not.</span>
              </label>
            </div>
            <dl className="so-money-summary">
              <div>
                <dt>Buyer total</dt>
                <dd>{buyerTotal == null ? "" : formatSalesMoney(buyerTotal, currency)}</dd>
              </div>
              {ebayOrder ? (
                <>
                  <div>
                    <dt>Seller earnings</dt>
                    <dd>{ebayOrderEarnings.trim() ? formatSalesMoney(Number(ebayOrderEarnings), currency) : ""}</dd>
                  </div>
                  <div>
                    <dt>Shipping label</dt>
                    <dd>{ebayLabelFee.trim() ? formatSalesMoney(Number(ebayLabelFee), currency) : "None yet"}</dd>
                  </div>
                  <div>
                    <dt>Seller net</dt>
                    <dd>{net == null ? "" : formatSalesMoney(net, currency)}</dd>
                  </div>
                </>
              ) : null}
            </dl>
            {ebayOrder ? (
              <p className="hint">
                Buyer total is the lines after the eBay discount, plus the shipping the buyer paid. Seller earnings is the amount eBay reports as due the seller, which already excludes marketplace fees. Seller net subtracts a shipping label bought on eBay.
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <fieldset>
          <legend>Payment</legend>
          <div className="so-pay-row">
            <label>
              Payment date
              <input type="date" value={paymentDate} disabled={locked} onChange={(event) => setPaymentDate(event.target.value)} />
            </label>
            <label>
              Payment method
              <select id="so-payment-method" value={paymentMethod} disabled={locked} onChange={(event) => setPaymentMethod(event.target.value)}>
                <option value="">Choose a payment method</option>
                {lookups.paymentMethods.map((method) => (
                  <option key={method.code} value={method.code}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Payment reference
              <input value={paymentRef} disabled={locked} onChange={(event) => setPaymentRef(event.target.value)} />
            </label>
            {showMoney ? (
              <label>
                Payment amount
                <input className="num-input" inputMode="decimal" value={paymentAmount} disabled={locked} onChange={(event) => setPaymentAmount(event.target.value)} />
              </label>
            ) : null}
          </div>
        </fieldset>

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
          </div>
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
    lineKind: "product",
    customerPartNumber: "",
    customerDescription: "",
    qty: "1",
    unitPrice: "",
    extPrice: "",
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
