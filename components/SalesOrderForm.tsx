"use client";

import { Ban, Check, Save } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { EBAY_ORDER_CUSTOMER_NAME, EBAY_SHIPPING_ITEM_SKU } from "@/lib/ebay/orderMap";
import { initialEbayText } from "@/lib/ebayOrderDefaults";
import { initialSalesRep } from "@/lib/ebaySalesRep";
import { cleanSkuAllocation } from "@/lib/ebay/packs";
import { useRouter } from "next/navigation";
import { SalesOrderAttachments } from "@/components/SalesOrderAttachments";
import { Badge } from "@/components/ui/badge";
import { errorText } from "@/lib/errors";
import { salesOrderErrorMessage } from "@/lib/salesOrderErrors";
import {
  billToForEbay,
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
  approveSalesOrderFromDraft,
  cancelSalesOrder,
  salesCustomerDefaults,
  saveEmptyLineAllocation,
  saveSalesOrderForForm,
  searchSalesCustomers,
  suggestSalesSkus,
  type SalesCustomerHit,
  type SalesLineView,
  type SalesLookups,
  type SalesNoteView,
  type SalesOrderView,
} from "@/lib/salesOrders";

type FormAllocation = { itemId: string; sku: string; name: string; qty: string };
type FormLine = Omit<SalesLineView, "allocations"> & { allocations: FormAllocation[] };

function plainMoney(value: string): string {
  return value.replace(/[$,]/g, "");
}

function moneyAmount(value: string): number | null {
  if (!value.trim()) return null;
  const numeric = Number(plainMoney(value));
  return Number.isFinite(numeric) ? numeric : null;
}

function EbayTip({ label, text }: { label: string; text: string }) {
  return (
    <button
      type="button"
      className="so-ebay-tip"
      aria-label={label}
      title={text}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => event.preventDefault()}
    >
      <span aria-hidden="true">i</span>
      <span className="so-ebay-tip-pop" role="tooltip">
        {text}
      </span>
    </button>
  );
}

function MoneyField({
  value,
  currency,
  onBlur,
  onFocus,
  readOnly,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { value: string; currency: string }) {
  const [focused, setFocused] = useState(false);
  const raw = String(value ?? "");
  const numeric = moneyAmount(raw);
  const shown = (readOnly || !focused) && numeric != null ? formatSalesMoney(numeric, currency) : raw;
  return (
    <input
      {...props}
      readOnly={readOnly}
      value={shown}
      onFocus={(event) => {
        if (!readOnly) setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
    />
  );
}

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
  defaultEbaySalesRep,
  defaultEbayPaymentTerms,
  defaultEbayIncoterms,
}: {
  order: SalesOrderView | null;
  lookups: SalesLookups;
  canEdit: boolean;
  showMoney: boolean;
  today: string;
  suggestedNumber: number | null;
  defaultEbaySalesRep: string;
  defaultEbayPaymentTerms: string;
  defaultEbayIncoterms: string;
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
  const openedAsEbay = orderIsEbay(order);
  const [billTo, setBillTo] = useState<SoAddress>(
    billToForEbay({
      ebay: openedAsEbay,
      billTo: order?.billTo ?? emptyAddress(),
      shipTo: order?.shipTo ?? emptyAddress(),
    }) ?? emptyAddress(),
  );
  const [shipTo, setShipTo] = useState<SoAddress>(order?.shipTo ?? emptyAddress());
  const [saveAddress, setSaveAddress] = useState(false);
  const [terms, setTerms] = useState(
    initialEbayText({ stored: order?.terms, ebay: openedAsEbay, setting: defaultEbayPaymentTerms }),
  );
  const [incoterms, setIncoterms] = useState(
    initialEbayText({ stored: order?.incoterms, ebay: openedAsEbay, setting: defaultEbayIncoterms }),
  );
  const [shipMethod, setShipMethod] = useState(order?.shipMethod ?? "");
  const [carrierAccount, setCarrierAccount] = useState(order?.carrierAccount ?? "");
  const [currency, setCurrency] = useState(order?.currency || "USD");
  const [salesRep, setSalesRep] = useState(
    initialSalesRep({
      stored: order?.salesRep,
      ebay: openedAsEbay,
      setting: defaultEbaySalesRep,
    }),
  );
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
  const [allocateQuery, setAllocateQuery] = useState<Record<number, string>>({});
  const linesRef = useRef(lines);
  linesRef.current = lines;
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
      lines: linesRef.current.map((line) => ({
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
      setBillTo(
        billToForEbay({
          ebay:
            defaults.channel.trim().toLowerCase() === "ebay" ||
            hit.name.trim().toLowerCase() === EBAY_ORDER_CUSTOMER_NAME.toLowerCase(),
          billTo: defaults.billTo,
          shipTo: defaults.shipTo,
        }) ?? defaults.billTo,
      );
      setShipTo(defaults.shipTo);
      setCustomerPo(defaults.customerPo);
      setChannel(defaults.channel);
      setOrderDate(defaults.orderDate || today);
      setShipDate(defaults.shipDate);
      setShipMethod(defaults.shipMethod);
      setCarrierAccount(defaults.carrierAccount);
      if (defaults.currency) setCurrency(defaults.currency);
      const ebayPick =
        defaults.channel.trim().toLowerCase() === "ebay" || hit.name.trim().toLowerCase() === EBAY_ORDER_CUSTOMER_NAME.toLowerCase();
      if (defaults.salesRep) setSalesRep(defaults.salesRep);
      else if (ebayPick) setSalesRep((current) => current.trim() || defaultEbaySalesRep);
      if (ebayPick) {
        setTerms((current) => defaults.terms.trim() || current.trim() || defaultEbayPaymentTerms);
        setIncoterms((current) => defaults.incoterms.trim() || current.trim() || defaultEbayIncoterms);
      } else {
        setTerms(defaults.terms);
        setIncoterms(defaults.incoterms);
      }
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  function updateLine(index: number, patch: Partial<FormLine>) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function changeLineMoney(index: number, field: "qty" | "unit" | "ext", value: string, commit = false) {
    const cleaned = field === "qty" ? value : plainMoney(value);
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const qty = field === "qty" ? cleaned : line.qty;
        if (!showMoney) return { ...line, qty };
        const synced = syncSalesLineMoney({
          qty,
          unitPrice: field === "unit" ? cleaned : line.unitPrice,
          extPrice: field === "ext" ? cleaned : line.extPrice,
          edited: field,
          commit,
        });
        return { ...line, qty, unitPrice: synced.unitPrice, extPrice: synced.extPrice };
      }),
    );
  }

  function hasAllocation(line: FormLine): boolean {
    return line.allocations.some((row) => row.itemId && Number(row.qty) > 0);
  }

  function putAllocation(index: number, allocation: FormAllocation, onlyIfEmpty: boolean): FormLine | null {
    const current = linesRef.current;
    const line = current[index];
    if (!line) return null;
    if (onlyIfEmpty && hasAllocation(line)) return null;
    const next = current.map((row, lineIndex) =>
      lineIndex === index ? { ...row, allocations: [allocation] } : row,
    );
    linesRef.current = next;
    setLines(next);
    return line;
  }

  async function persistEmpty(line: FormLine, allocation: FormAllocation) {
    if (locked || !line.id) return;
    try {
      await saveEmptyLineAllocation({ lineId: line.id, itemId: allocation.itemId, qty: allocation.qty });
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function matchCleanSku(index: number, part: string, onlyIfEmpty: boolean) {
    const line = linesRef.current[index];
    if (!line || locked) return;
    if (onlyIfEmpty && hasAllocation(line)) return;
    const label = part.trim();
    if (!label) {
      if (!onlyIfEmpty) setMessage("Type an ITS SKU.");
      return;
    }
    try {
      const hits = await suggestSalesSkus(label);
      const latest = linesRef.current[index];
      if (!latest) return;
      const allocation = cleanSkuAllocation(label, latest.qty, hits);
      if (!allocation) {
        if (!onlyIfEmpty) setMessage("No ITS item has that SKU.");
        return;
      }
      const previous = putAllocation(index, allocation, onlyIfEmpty);
      if (previous && onlyIfEmpty) await persistEmpty(previous, allocation);
      if (!onlyIfEmpty) setMessage(null);
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  useEffect(() => {
    if (locked) return;
    let cancelled = false;
    const ebay = Boolean(order?.ebayOrderId || order?.ebaySalesRecordRef || (order?.channel ?? "").toLowerCase() === "ebay");
    (order?.lines ?? []).forEach((line, index) => {
      const freight = (line.lineKind || "product") === "freight";
      const part = freight ? (ebay ? EBAY_SHIPPING_ITEM_SKU : "") : line.customerPartNumber;
      if (!part.trim() || line.allocations.some((row) => row.itemId && Number(row.qty) > 0)) return;
      void suggestSalesSkus(part)
        .then((hits) => {
          if (cancelled) return;
          const latest = linesRef.current[index];
          if (!latest || latest.allocations.some((row) => row.itemId && Number(row.qty) > 0)) return;
          const allocation = cleanSkuAllocation(part, latest.qty, hits);
          if (!allocation) {
            if (freight) setMessage("eBay shipping could not be allocated to item 4343.");
            return;
          }
          const previous = putAllocation(index, allocation, true);
          if (previous) void persistEmpty(previous, allocation);
        })
        .catch((error) => {
          if (!cancelled) setMessage(errorText(error));
        });
    });
    return () => {
      cancelled = true;
    };
    // Fill an empty pack or eBay freight line once, from the saved customer part.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  async function onSave() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveSalesOrderForForm(draft());
      if (!saved.ok) {
        setMessage(saved.message);
        return;
      }
      setOrderId(saved.id);
      if (saved.addressWarning) setMessage(saved.addressWarning);
      if (orderId !== saved.id) router.replace(`/sales/orders/${saved.id}`);
      else router.refresh();
    } catch (error) {
      setMessage(salesOrderErrorMessage(error));
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
      const approved = await approveSalesOrderFromDraft(draft(), chosen);
      if (!approved.ok) {
        setMessage(approved.message);
        return;
      }
      setOrderId(approved.id);
      if (approved.addressWarning) setMessage(`${approved.addressWarning} Approved as ${approved.soNumber}.`);
      router.replace(`/sales/orders/${approved.id}`);
      router.refresh();
    } catch (error) {
      setMessage(salesOrderErrorMessage(error));
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
  const ebayOrder = Boolean(
    order?.ebayOrderId || order?.ebaySalesRecordRef || channel.trim().toLowerCase() === "ebay" || (order?.channel ?? "").toLowerCase() === "ebay",
  );
  const ebayCustomer = customerName.trim().toLowerCase() === EBAY_ORDER_CUSTOMER_NAME.toLowerCase();
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
          <div className={ebayOrder ? "so-head-row so-head-ebay" : "so-head-row"}>
          <label>
            Channel
            <select
              id="so-channel"
              value={channel}
              disabled={locked}
              onChange={(event) => {
                const value = event.target.value;
                setChannel(value);
                if (value.trim().toLowerCase() === "ebay") {
                  setSalesRep((current) => current.trim() || defaultEbaySalesRep);
                  setTerms((current) => current.trim() || defaultEbayPaymentTerms);
                  setIncoterms((current) => current.trim() || defaultEbayIncoterms);
                  setBillTo((current) => billToForEbay({ ebay: true, billTo: current, shipTo }) ?? current);
                }
              }}
            >
              <option value="">Choose a channel</option>
              {lookups.channels.map((row) => (
                <option key={row.code} value={row.code}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label className="so-field-rep">
            Sales rep
            <input
              id="so-sales-rep"
              aria-label="Sales rep"
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
          {ebayOrder ? (
            <label>
              Buyer
              <input id="so-buyer" aria-label="Buyer" value={buyerText(order)} disabled />
            </label>
          ) : null}
          <label className="so-field-date">
            Order date
            <input type="date" value={orderDate} disabled={locked} onChange={(event) => setOrderDate(event.target.value)} />
          </label>
          <label>
            {ebayCustomer ? "eBay order id" : "Order reference"}
            {ebayCustomer ? (
              <input id="so-order-reference" aria-label="eBay order id" value={order?.ebayOrderId ?? ""} disabled />
            ) : (
              <input id="so-order-reference" aria-label="Order reference" value={customerPo} disabled={locked} onChange={(event) => setCustomerPo(event.target.value)} />
            )}
          </label>
          {ebayOrder ? (
            <label className="so-field-record">
              eBay sales record number
              <input id="so-ebay-sales-record" aria-label="eBay sales record number" value={order?.ebaySalesRecordRef ?? ""} disabled />
            </label>
          ) : null}
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
            <select id="so-terms" value={terms} disabled={locked} onChange={(event) => setTerms(event.target.value)}>
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
            <select id="so-incoterms" value={incoterms} disabled={locked} onChange={(event) => setIncoterms(event.target.value)}>
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

        <div className="so-addresses">
          <AddressFields legend="Ship to" address={shipTo} disabled={locked} showAttention onChange={setShipTo} />
          {ebayOrder ? null : <AddressFields legend="Bill to" address={billTo} disabled={locked} onChange={setBillTo} />}
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
                  const ebayFreight = (line.lineKind || "product") === "freight" && ebayOrder;
                  const showAllocations = needsItem || ebayFreight;
                  const showFinder = showAllocations && !locked;
                  const showNoItemHint = !showAllocations;
                  const showExtra = showFinder || showNoItemHint;
                  const allocationCount = showAllocations ? line.allocations.length : 0;
                  return (
                    <Fragment key={index}>
                      <tr className={showExtra || allocationCount > 0 ? undefined : "so-line-end"}>
                        <td>
                          <input
                            id={`so-line-part-${index}`}
                            aria-label={`Customer part number ${index + 1}`}
                            value={line.customerPartNumber}
                            disabled={locked}
                            onChange={(event) => updateLine(index, { customerPartNumber: event.target.value })}
                            onBlur={(event) => {
                              if (!locked && lineRequiresItem(line.lineKind)) void matchCleanSku(index, event.target.value, true);
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
                            <MoneyField
                              className="num-input"
                              aria-label={`Customer unit ${index + 1}`}
                              inputMode="decimal"
                              value={line.unitPrice}
                              currency={currency}
                              disabled={locked}
                              onChange={(event) => changeLineMoney(index, "unit", event.target.value)}
                              onBlur={(event) => changeLineMoney(index, "unit", event.target.value, true)}
                            />
                          </td>
                        ) : null}
                        {showMoney ? (
                          <td className="num">
                            <MoneyField
                              className="num-input"
                              aria-label={`Cust ext ${index + 1}`}
                              inputMode="decimal"
                              value={line.extPrice}
                              currency={currency}
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
                      {showAllocations
                        ? line.allocations.map((allocation, allocationIndex) => (
                            <tr
                              className={showExtra || allocationIndex < allocationCount - 1 ? "so-allocation-row" : "so-allocation-row so-line-end"}
                              key={`${allocation.itemId}-${allocationIndex}`}
                            >
                              <td colSpan={2}>
                                <div className="so-allocation-sku">
                                  <span className="so-alloc-sku">
                                    {allocation.sku || "SKU"} {allocation.name}
                                  </span>
                                  <span className="so-allocation-label">Allocated qty</span>
                                </div>
                              </td>
                              <td className="num">
                                <input
                                  className="num-input"
                                  inputMode="decimal"
                                  aria-label={`Allocated qty ${index + 1} ${allocation.sku || allocationIndex + 1}`}
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
                              </td>
                              {showMoney ? (
                                <td className="num">
                                  <MoneyField
                                    className="num-input"
                                    aria-label={`Allocated unit ${index + 1} ${allocation.sku || allocationIndex + 1}`}
                                    value={line.unitPrice}
                                    currency={currency}
                                    readOnly
                                    disabled={locked}
                                    tabIndex={-1}
                                  />
                                </td>
                              ) : null}
                              {showMoney ? (
                                <td className="num">
                                  <MoneyField
                                    className="num-input"
                                    aria-label={`Allocated ext ${index + 1} ${allocation.sku || allocationIndex + 1}`}
                                    value={line.extPrice}
                                    currency={currency}
                                    readOnly
                                    disabled={locked}
                                    tabIndex={-1}
                                  />
                                </td>
                              ) : null}
                              <td className="so-line-remove">
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
                                    Remove
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          ))
                        : null}
                      {showExtra ? (
                        <tr className="so-line-extra so-line-end">
                          <td colSpan={showMoney ? 6 : 4}>
                            {showFinder ? (
                              <div className="so-allocate">
                                <div className="so-alloc-row">
                                  <label className="so-find-sku">
                                    <span>Find SKU</span>
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
                                          void matchCleanSku(index, event.currentTarget.value, false);
                                        }
                                      }}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => void matchCleanSku(index, allocateQuery[index] || "", false)}
                                  >
                                    Find
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="hint">This line does not need an ITS item.</p>
                            )}
                          </td>
                        </tr>
                      ) : null}
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
          <section className="so-ebay-card" aria-labelledby="so-ebay-heading">
            <div className="so-ebay-head">
              <h2 id="so-ebay-heading">eBay</h2>
              {ebayOrder ? (
                <details className="so-ebay-about">
                  <summary>About these amounts</summary>
                  <p>
                    Buyer total is the lines after the eBay discount, plus shipping the buyer paid. Seller earnings is what eBay reports as due the seller, with marketplace fees already out. Seller net subtracts a shipping label bought on eBay.
                  </p>
                </details>
              ) : null}
            </div>
            <div className="so-ebay-grid">
              <label>
                <span className="so-ebay-label">Transaction fee</span>
                <MoneyField id="so-ebay-transaction-fee" className="num-input" inputMode="decimal" value={ebayTransactionFee} currency={currency} disabled={locked} onChange={(event) => setEbayTransactionFee(plainMoney(event.target.value))} onBlur={(event) => setEbayTransactionFee(plainMoney(event.target.value))} />
              </label>
              <label>
                <span className="so-ebay-label">
                  Label fee
                  <EbayTip label="About the label fee" text="Deducted when a label is bought on eBay. The next order pull fills this in." />
                </span>
                <MoneyField className="num-input" inputMode="decimal" aria-label="eBay label fee" value={ebayLabelFee} currency={currency} disabled={locked} onChange={(event) => setEbayLabelFee(plainMoney(event.target.value))} onBlur={(event) => setEbayLabelFee(plainMoney(event.target.value))} />
              </label>
              <label>
                <span className="so-ebay-label">Ad fee</span>
                <MoneyField className="num-input" inputMode="decimal" aria-label="eBay ad fee" value={ebayAdFee} currency={currency} disabled={locked} onChange={(event) => setEbayAdFee(plainMoney(event.target.value))} onBlur={(event) => setEbayAdFee(plainMoney(event.target.value))} />
              </label>
              <label>
                <span className="so-ebay-label">
                  Seller earnings
                  <EbayTip label="About seller earnings" text="eBay's total due the seller. Marketplace fees are already out. A shipping label is not." />
                </span>
                <MoneyField className="num-input" inputMode="decimal" aria-label="Seller earnings" value={ebayOrderEarnings} currency={currency} disabled={locked} onChange={(event) => setEbayOrderEarnings(plainMoney(event.target.value))} onBlur={(event) => setEbayOrderEarnings(plainMoney(event.target.value))} />
              </label>
            </div>
            <dl className="so-ebay-metrics">
              <div>
                <dt>Buyer total</dt>
                <dd>{buyerTotal == null ? "—" : formatSalesMoney(buyerTotal, currency)}</dd>
              </div>
              <div>
                <dt>Seller earnings</dt>
                <dd className={moneyAmount(ebayOrderEarnings) == null ? "so-ebay-empty" : undefined}>
                  {moneyAmount(ebayOrderEarnings) == null ? "—" : formatSalesMoney(moneyAmount(ebayOrderEarnings), currency)}
                </dd>
              </div>
              <div>
                <dt>Shipping label</dt>
                <dd className={moneyAmount(ebayLabelFee) == null ? "so-ebay-empty" : undefined}>
                  {moneyAmount(ebayLabelFee) == null ? (ebayOrder ? "None yet" : "—") : formatSalesMoney(moneyAmount(ebayLabelFee), currency)}
                </dd>
              </div>
              <div>
                <dt>Seller net</dt>
                <dd className={net == null ? "so-ebay-empty" : undefined}>{net == null ? "—" : formatSalesMoney(net, currency)}</dd>
              </div>
            </dl>
          </section>
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
                <MoneyField className="num-input" inputMode="decimal" value={paymentAmount} currency={currency} disabled={locked} onChange={(event) => setPaymentAmount(plainMoney(event.target.value))} onBlur={(event) => setPaymentAmount(plainMoney(event.target.value))} />
              </label>
            ) : null}
          </div>
        </fieldset>

        <fieldset className="so-notes-files">
          <legend>Notes and files</legend>
          <div className={showMoney ? "so-notes-files-row" : "so-notes-files-row so-notes-files-one"}>
            <div className="so-notes-col">
              <label>
                Customer notes
                <textarea value={exportNotes} disabled={locked} onChange={(event) => setExportNotes(event.target.value)} />
                <span className="hint">Other details read from the customer PDF.</span>
              </label>
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
            </div>
            {showMoney ? (
              <label>
                Internal notes
                <textarea value={internalNotes} disabled={locked} onChange={(event) => setInternalNotes(event.target.value)} />
              </label>
            ) : null}
            {showMoney ? (
              <SalesOrderAttachments orderId={orderId} attachments={order?.attachments ?? []} canEdit={filesEditable} />
            ) : null}
          </div>
        </fieldset>

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
      </div>
    </fieldset>
  );
}

function blankLine(): FormLine {
  return {
    id: "",
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

function orderIsEbay(order: SalesOrderView | null): boolean {
  if (!order) return false;
  return Boolean(order.ebayOrderId || order.ebaySalesRecordRef || order.channel.toLowerCase() === "ebay");
}

function buyerText(order: SalesOrderView | null): string {
  if (!order) return "";
  return [order.buyerName, order.buyerUsername ? `(${order.buyerUsername})` : ""].filter(Boolean).join(" ");
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
