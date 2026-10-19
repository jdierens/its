"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  addItemTransaction,
  addPriceQuote,
  fetchItemPrices,
  fetchItemTransactions,
  fetchPartyChoices,
  fetchPriceQuotes,
  fetchSalesWindowDays,
  saveItemPrices,
  type ItemTransaction,
  type PartyChoice,
  type PriceQuote,
} from "@/lib/itemPricing";
import { errorText } from "@/lib/errors";
import {
  PRICE_QUOTE_SOURCES,
  QUOTE_SOURCE_LABELS,
  TRANSACTION_SOURCES,
  capturedPhrase,
  exactPacificTime,
  formatMoney,
  parseMoney,
  salesStats,
  type PriceQuoteSource,
  type TransactionSource,
  type TransactionType,
} from "@/lib/pricing/quotes";

type ProviderResult = {
  source: string;
  label: string;
  status: "ran" | "skipped" | "error";
  count: number;
  message: string | null;
};

type QuoteSortKey = "captured" | "source" | "price" | "qty" | "condition" | "seller";

const SOURCE_LABELS: Record<TransactionSource, string> = {
  manual: "Manual",
  qbo: "QuickBooks",
  ebay: "eBay",
};

export function ItemPricingPanel({ itemId }: { itemId: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ecommerce, setEcommerce] = useState("");
  const [market, setMarket] = useState("");
  const [msrp, setMsrp] = useState("");
  const [ecommerceUpdatedAt, setEcommerceUpdatedAt] = useState<string | null>(null);
  const [marketUpdatedAt, setMarketUpdatedAt] = useState<string | null>(null);
  const [msrpUpdatedAt, setMsrpUpdatedAt] = useState<string | null>(null);
  const [pricingCheckedAt, setPricingCheckedAt] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priceSaved, setPriceSaved] = useState(false);
  const [savingPrices, setSavingPrices] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSummary, setUpdateSummary] = useState<string | null>(null);
  const [reports, setReports] = useState<ProviderResult[]>([]);
  const [quotes, setQuotes] = useState<PriceQuote[]>([]);
  const [txns, setTxns] = useState<ItemTransaction[]>([]);
  const [windowDays, setWindowDays] = useState(90);
  const [customers, setCustomers] = useState<PartyChoice[]>([]);
  const [vendors, setVendors] = useState<PartyChoice[]>([]);
  const [sort, setSort] = useState<{ key: QuoteSortKey; dir: "asc" | "desc" }>({
    key: "captured",
    dir: "desc",
  });
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [addingQuote, setAddingQuote] = useState(false);
  const [quoteSource, setQuoteSource] = useState<PriceQuoteSource>("manual");
  const [quotePrice, setQuotePrice] = useState("");
  const [quoteCurrency, setQuoteCurrency] = useState("USD");
  const [quoteQty, setQuoteQty] = useState("");
  const [quoteCondition, setQuoteCondition] = useState("");
  const [quoteSeller, setQuoteSeller] = useState("");
  const [quoteVendorId, setQuoteVendorId] = useState("");
  const [quoteUrl, setQuoteUrl] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteBy, setQuoteBy] = useState("manual");
  const [typeFilter, setTypeFilter] = useState<"all" | TransactionType>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [txnError, setTxnError] = useState<string | null>(null);
  const [addingTxn, setAddingTxn] = useState(false);
  const [txnType, setTxnType] = useState<TransactionType>("sell");
  const [txnDate, setTxnDate] = useState(localIsoDate);
  const [txnQty, setTxnQty] = useState("");
  const [txnUnit, setTxnUnit] = useState("");
  const [txnCustomerId, setTxnCustomerId] = useState("");
  const [txnVendorId, setTxnVendorId] = useState("");
  const [txnReference, setTxnReference] = useState("");
  const [txnSource, setTxnSource] = useState<TransactionSource>("manual");
  const [txnNotes, setTxnNotes] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [prices, quoteRows, txnRows, days, customerRows, vendorRows] = await Promise.all([
          fetchItemPrices(itemId),
          fetchPriceQuotes(itemId),
          fetchItemTransactions(itemId),
          fetchSalesWindowDays(),
          fetchPartyChoices("customers"),
          fetchPartyChoices("vendors"),
        ]);
        if (cancelled) return;
        if (!prices) {
          setLoadError("That item was not found.");
          return;
        }
        applyPrices(prices);
        setQuotes(quoteRows);
        setTxns(txnRows);
        setWindowDays(days);
        setCustomers(customerRows);
        setVendors(vendorRows);
      } catch (error) {
        if (!cancelled) setLoadError(errorText(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    function applyPrices(prices: NonNullable<Awaited<ReturnType<typeof fetchItemPrices>>>) {
      setEcommerce(moneyField(prices.ecommercePrice));
      setMarket(moneyField(prices.marketPrice));
      setMsrp(moneyField(prices.msrp));
      setEcommerceUpdatedAt(prices.ecommerceUpdatedAt);
      setMarketUpdatedAt(prices.marketUpdatedAt);
      setMsrpUpdatedAt(prices.msrpUpdatedAt);
      setPricingCheckedAt(prices.pricingCheckedAt);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const latestIds = useMemo(() => latestQuoteIds(quotes), [quotes]);
  const sortedQuotes = useMemo(() => sortQuotes(quotes, sort.key, sort.dir), [quotes, sort]);
  const stats = useMemo(
    () =>
      salesStats(
        txns.map((txn) => ({
          type: txn.type,
          txnDate: txn.txnDate,
          qty: txn.qty,
          unitPrice: txn.unitPrice,
          total: txn.total,
          createdAt: txn.createdAt,
        })),
        windowDays,
        localIsoDate(),
      ),
    [txns, windowDays],
  );
  const visibleTxns = useMemo(
    () =>
      txns.filter((txn) => {
        if (typeFilter !== "all" && txn.type !== typeFilter) return false;
        if (fromDate && txn.txnDate < fromDate) return false;
        if (toDate && txn.txnDate > toDate) return false;
        return true;
      }),
    [txns, typeFilter, fromDate, toDate],
  );
  const txnPreview = previewTotal(txnQty, txnUnit);

  async function onSavePrices(event: FormEvent) {
    event.preventDefault();
    const ecommercePrice = parseMoney(ecommerce);
    const marketPrice = parseMoney(market);
    const msrpPrice = parseMoney(msrp);
    const invalid = [ecommercePrice, marketPrice, msrpPrice].find((result) => !result.ok);
    if (invalid && !invalid.ok) {
      setPriceError(invalid.message);
      setPriceSaved(false);
      return;
    }
    if (!ecommercePrice.ok || !marketPrice.ok || !msrpPrice.ok) return;
    setSavingPrices(true);
    setPriceError(null);
    setPriceSaved(false);
    try {
      await saveItemPrices(itemId, {
        ecommercePrice: ecommercePrice.amount,
        marketPrice: marketPrice.amount,
        msrp: msrpPrice.amount,
      });
      const prices = await fetchItemPrices(itemId);
      if (prices) {
        setEcommerce(moneyField(prices.ecommercePrice));
        setMarket(moneyField(prices.marketPrice));
        setMsrp(moneyField(prices.msrp));
        setEcommerceUpdatedAt(prices.ecommerceUpdatedAt);
        setMarketUpdatedAt(prices.marketUpdatedAt);
        setMsrpUpdatedAt(prices.msrpUpdatedAt);
        setPricingCheckedAt(prices.pricingCheckedAt);
      }
      setPriceSaved(true);
    } catch (error) {
      setPriceError(errorText(error));
    } finally {
      setSavingPrices(false);
    }
  }

  async function onUpdatePricing() {
    setUpdating(true);
    setUpdateError(null);
    setUpdateSummary(null);
    try {
      const response = await fetch(`/api/items/${itemId}/pricing`, { method: "POST" });
      const body = (await response.json()) as {
        message?: string;
        checkedAt?: string;
        reports?: ProviderResult[];
        inserted?: number;
        outliers?: number;
      };
      if (!response.ok) throw new Error(body.message || "Update pricing failed.");
      setReports(body.reports ?? []);
      if (body.checkedAt) setPricingCheckedAt(body.checkedAt);
      setQuotes(await fetchPriceQuotes(itemId));
      const stored = body.inserted ?? 0;
      const flagged = body.outliers ?? 0;
      setUpdateSummary(
        stored === 0
          ? "No new quotes were stored."
          : `Stored ${stored} quote${stored === 1 ? "" : "s"}${flagged ? `, ${flagged} flagged` : ""}.`,
      );
    } catch (error) {
      setUpdateError(errorText(error));
    } finally {
      setUpdating(false);
    }
  }

  async function onAddQuote(event: FormEvent) {
    event.preventDefault();
    const price = parseMoney(quotePrice);
    if (!price.ok) {
      setQuoteError(price.message);
      return;
    }
    if (price.amount == null || price.amount <= 0) {
      setQuoteError("Enter a price greater than zero.");
      return;
    }
    const qty = parseMoney(quoteQty);
    if (!qty.ok) {
      setQuoteError(qty.message);
      return;
    }
    if (qty.amount != null && qty.amount <= 0) {
      setQuoteError("Quantity must be greater than zero.");
      return;
    }
    const currency = quoteCurrency.trim().toUpperCase();
    if (!currency) {
      setQuoteError("Enter a currency.");
      return;
    }
    setAddingQuote(true);
    setQuoteError(null);
    try {
      await addPriceQuote(itemId, {
        source: quoteSource,
        price: price.amount,
        currency,
        qty: qty.amount,
        condition: quoteCondition,
        vendorId: quoteVendorId || null,
        sellerName: quoteSeller,
        url: quoteUrl,
        notes: quoteNotes,
        capturedBy: quoteBy,
      });
      setQuotes(await fetchPriceQuotes(itemId));
      setQuotePrice("");
      setQuoteQty("");
      setQuoteCondition("");
      setQuoteSeller("");
      setQuoteVendorId("");
      setQuoteUrl("");
      setQuoteNotes("");
    } catch (error) {
      setQuoteError(errorText(error));
    } finally {
      setAddingQuote(false);
    }
  }

  async function onAddTransaction(event: FormEvent) {
    event.preventDefault();
    const qty = parseMoney(txnQty);
    const unit = parseMoney(txnUnit);
    if (!qty.ok) {
      setTxnError(qty.message);
      return;
    }
    if (qty.amount == null || qty.amount <= 0) {
      setTxnError("Quantity must be greater than zero.");
      return;
    }
    if (!unit.ok) {
      setTxnError(unit.message);
      return;
    }
    if (unit.amount == null) {
      setTxnError("Enter a unit price.");
      return;
    }
    if (!txnDate) {
      setTxnError("Enter a date.");
      return;
    }
    setAddingTxn(true);
    setTxnError(null);
    try {
      await addItemTransaction(itemId, {
        type: txnType,
        txnDate,
        qty: qty.amount,
        unitPrice: unit.amount,
        customerId: txnType === "sell" ? txnCustomerId || null : null,
        vendorId: txnType === "buy" ? txnVendorId || null : null,
        reference: txnReference,
        source: txnSource,
        notes: txnNotes,
      });
      setTxns(await fetchItemTransactions(itemId));
      setTxnQty("");
      setTxnUnit("");
      setTxnCustomerId("");
      setTxnVendorId("");
      setTxnReference("");
      setTxnNotes("");
    } catch (error) {
      setTxnError(errorText(error));
    } finally {
      setAddingTxn(false);
    }
  }

  function toggleSort(key: QuoteSortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "source" || key === "condition" || key === "seller" ? "asc" : "desc" },
    );
  }

  if (loading) {
    return (
      <section className="page" id="item-pricing">
        <p className="muted">Loading pricing…</p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="page" id="item-pricing">
        <p className="banner error" role="alert">
          {loadError}
        </p>
      </section>
    );
  }

  return (
    <section className="page" id="item-pricing" aria-labelledby="pricing-heading">
      <h2 id="pricing-heading">Pricing</h2>
      <form onSubmit={onSavePrices}>
        <div className="grid">
          <PriceField
            label="Ecommerce price"
            value={ecommerce}
            updatedAt={ecommerceUpdatedAt}
            onChange={(value) => {
              setEcommerce(value);
              setPriceSaved(false);
            }}
          />
          <PriceField
            label="Market price"
            value={market}
            updatedAt={marketUpdatedAt}
            onChange={(value) => {
              setMarket(value);
              setPriceSaved(false);
            }}
          />
          <PriceField
            label="MSRP"
            value={msrp}
            updatedAt={msrpUpdatedAt}
            onChange={(value) => {
              setMsrp(value);
              setPriceSaved(false);
            }}
          />
        </div>
        {priceError ? (
          <p className="banner error" role="alert">
            {priceError}
          </p>
        ) : null}
        {priceSaved ? (
          <p className="banner ok" role="status">
            Prices saved.
          </p>
        ) : null}
        <div className="actions">
          <button type="submit" disabled={savingPrices}>
            {savingPrices ? "Saving…" : "Save prices"}
          </button>
          <span className="hint">USD. Each price keeps its own updated time.</span>
        </div>
      </form>

      <div className="panel-block">
        <div className="pricing-actions">
          <button type="button" onClick={() => void onUpdatePricing()} disabled={updating}>
            {updating ? "Updating…" : "Update pricing"}
          </button>
          <span>
            Last updated {pricingCheckedAt ? exactPacificTime(pricingCheckedAt) : "—"}
          </span>
        </div>
        {updateError ? (
          <p className="banner error" role="alert">
            {updateError}
          </p>
        ) : null}
        {updateSummary ? <p className="page-note">{updateSummary}</p> : null}
        {reports.length > 0 ? (
          <ul className="provider-list">
            {reports.map((report) => (
              <li key={report.source} className={report.status}>
                {report.label}: {report.status}
                {report.status === "ran" ? `, ${report.count} quote${report.count === 1 ? "" : "s"}` : ""}
                {report.message ? `. ${report.message}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Looks up the part number, or the model when the part number is blank.</p>
        )}
      </div>

      <div className="panel-block">
        <h3>Sales, last {stats.windowDays} days</h3>
        <div className="pricing-stats">
          <Stat label="Last sold" value={formatMoney(stats.lastSoldPrice)} />
          <Stat label="Last bought" value={formatMoney(stats.lastBoughtPrice)} />
          <Stat label="Qty sold" value={formatQty(stats.qtySold)} />
          <Stat label="Revenue" value={formatMoney(stats.revenue)} />
          <Stat label="Avg sell" value={formatMoney(stats.avgSellPrice)} />
          <Stat label="Qty bought" value={formatQty(stats.qtyBought)} />
          <Stat label="Spend" value={formatMoney(stats.spend)} />
        </div>
        <p className="hint">Last sold and last bought use the newest transaction of that type. Totals use the window in Admin &gt; Settings.</p>
      </div>

      <div className="panel-block">
        <h3>Price references</h3>
        {quotes.length === 0 ? (
          <p className="page-note">No price references yet.</p>
        ) : (
          <div className="card">
            <table className="dense">
              <thead>
                <tr>
                  <SortHeader label="Source" column="source" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Price" column="price" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Qty" column="qty" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Condition" column="condition" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Seller" column="seller" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Captured" column="captured" sort={sort} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {sortedQuotes.map((quote) => (
                  <tr key={quote.id} className={latestIds.has(quote.id) ? "quote-latest" : undefined}>
                    <td>
                      {QUOTE_SOURCE_LABELS[quote.source]}
                      {quote.outlier ? <span className="badge-outlier">Outlier</span> : null}
                    </td>
                    <td className="sku">
                      {formatMoney(quote.price, quote.currency)}
                      {quote.url ? (
                        <>
                          {" "}
                          <a href={quote.url} target="_blank" rel="noreferrer">
                            Link
                          </a>
                        </>
                      ) : null}
                    </td>
                    <td className="sku">{formatQty(quote.qty)}</td>
                    <td>{quote.condition || "—"}</td>
                    <td>
                      {sellerLabel(quote)}
                      {quote.notes ? <span className="hint">{quote.notes}</span> : null}
                    </td>
                    <td>
                      {capturedPhrase(quote.capturedAt)}
                      <span className="hint">{exactPacificTime(quote.capturedAt)}</span>
                      {quote.capturedBy ? <span className="hint">{quote.capturedBy}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form onSubmit={onAddQuote}>
          <h3>Add quote</h3>
          <div className="grid">
            <label>
              Source
              <select
                value={quoteSource}
                onChange={(event) => setQuoteSource(event.target.value as PriceQuoteSource)}
              >
                {PRICE_QUOTE_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {QUOTE_SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Price
              <input value={quotePrice} inputMode="decimal" autoComplete="off" onChange={(event) => setQuotePrice(event.target.value)} />
            </label>
            <label>
              Currency
              <input value={quoteCurrency} autoComplete="off" onChange={(event) => setQuoteCurrency(event.target.value)} />
            </label>
            <label>
              Qty
              <input value={quoteQty} inputMode="decimal" autoComplete="off" onChange={(event) => setQuoteQty(event.target.value)} />
            </label>
            <label>
              Condition
              <input value={quoteCondition} autoComplete="off" onChange={(event) => setQuoteCondition(event.target.value)} />
            </label>
            <label>
              Seller
              <input value={quoteSeller} autoComplete="off" onChange={(event) => setQuoteSeller(event.target.value)} />
            </label>
            <label>
              Vendor
              <select value={quoteVendorId} onChange={(event) => setQuoteVendorId(event.target.value)}>
                <option value="">None</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              URL
              <input value={quoteUrl} autoComplete="off" onChange={(event) => setQuoteUrl(event.target.value)} />
            </label>
            <label>
              Notes
              <input value={quoteNotes} autoComplete="off" onChange={(event) => setQuoteNotes(event.target.value)} />
            </label>
            <label>
              Captured by
              <input value={quoteBy} autoComplete="off" onChange={(event) => setQuoteBy(event.target.value)} />
            </label>
          </div>
          {quoteError ? (
            <p className="banner error" role="alert">
              {quoteError}
            </p>
          ) : null}
          <div className="actions">
            <button type="submit" disabled={addingQuote}>
              {addingQuote ? "Adding…" : "Add quote"}
            </button>
          </div>
        </form>
      </div>

      <div className="panel-block" id="item-transactions">
        <h3>Transactions</h3>
        <div className="pricing-filters">
          <label>
            Type
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | TransactionType)}>
              <option value="all">All</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
          <label>
            From
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
        </div>
        {txns.length === 0 ? (
          <p className="page-note">No transactions yet.</p>
        ) : visibleTxns.length === 0 ? (
          <p className="page-note">No transactions match these filters.</p>
        ) : (
          <div className="card">
            <table className="dense">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Qty</th>
                  <th>Unit price</th>
                  <th>Total</th>
                  <th>Party</th>
                  <th>Reference</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {visibleTxns.map((txn) => (
                  <tr key={txn.id}>
                    <td>{txn.type === "buy" ? "Buy" : "Sell"}</td>
                    <td className="sku">{txn.txnDate}</td>
                    <td className="sku">{formatQty(txn.qty)}</td>
                    <td className="sku">{formatMoney(txn.unitPrice)}</td>
                    <td className="sku">{formatMoney(txn.total)}</td>
                    <td>
                      {txn.type === "sell" ? txn.customerName || "—" : txn.vendorName || "—"}
                      {txn.notes ? <span className="hint">{txn.notes}</span> : null}
                    </td>
                    <td>{txn.reference || "—"}</td>
                    <td>{SOURCE_LABELS[txn.source]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form onSubmit={onAddTransaction}>
          <h3>Add transaction</h3>
          <div className="grid">
            <label>
              Type
              <select
                value={txnType}
                onChange={(event) => setTxnType(event.target.value === "buy" ? "buy" : "sell")}
              >
                <option value="sell">Sell</option>
                <option value="buy">Buy</option>
              </select>
            </label>
            <label>
              Date
              <input type="date" value={txnDate} onChange={(event) => setTxnDate(event.target.value)} />
            </label>
            <label>
              Qty
              <input value={txnQty} inputMode="decimal" autoComplete="off" onChange={(event) => setTxnQty(event.target.value)} />
            </label>
            <label>
              Unit price
              <input value={txnUnit} inputMode="decimal" autoComplete="off" onChange={(event) => setTxnUnit(event.target.value)} />
            </label>
            {txnType === "sell" ? (
              <label>
                Customer
                <select value={txnCustomerId} onChange={(event) => setTxnCustomerId(event.target.value)}>
                  <option value="">None</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Vendor
                <select value={txnVendorId} onChange={(event) => setTxnVendorId(event.target.value)}>
                  <option value="">None</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Reference
              <input
                value={txnReference}
                autoComplete="off"
                placeholder="PO, SO, or invoice #"
                onChange={(event) => setTxnReference(event.target.value)}
              />
            </label>
            <label>
              Source
              <select
                value={txnSource}
                onChange={(event) => setTxnSource(event.target.value as TransactionSource)}
              >
                {TRANSACTION_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Notes
              <input value={txnNotes} autoComplete="off" onChange={(event) => setTxnNotes(event.target.value)} />
            </label>
          </div>
          <p className="hint">Total {txnPreview == null ? "—" : formatMoney(txnPreview)}. The database stores the rounded total.</p>
          {txnError ? (
            <p className="banner error" role="alert">
              {txnError}
            </p>
          ) : null}
          <div className="actions">
            <button type="submit" disabled={addingTxn}>
              {addingTxn ? "Adding…" : "Add transaction"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function PriceField({
  label,
  value,
  updatedAt,
  onChange,
}: {
  label: string;
  value: string;
  updatedAt: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input value={value} inputMode="decimal" autoComplete="off" onChange={(event) => onChange(event.target.value)} />
      <span className="hint">{updatedAt ? `Updated ${exactPacificTime(updatedAt)}` : "Not set"}</span>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: QuoteSortKey;
  sort: { key: QuoteSortKey; dir: "asc" | "desc" };
  onSort: (key: QuoteSortKey) => void;
}) {
  const active = sort.key === column;
  return (
    <th aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="th-sort" aria-pressed={active} onClick={() => onSort(column)}>
        {label}
        {active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

function moneyField(amount: number | null): string {
  return amount == null ? "" : amount.toFixed(2);
}

function formatQty(qty: number | null): string {
  if (qty == null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(qty);
}

function sellerLabel(quote: PriceQuote): string {
  return quote.sellerName || quote.vendorName || "—";
}

function localIsoDate(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function previewTotal(qtyText: string, unitText: string): number | null {
  const qty = parseMoney(qtyText);
  const unit = parseMoney(unitText);
  if (!qty.ok || !unit.ok || qty.amount == null || unit.amount == null) return null;
  return Math.round(qty.amount * unit.amount * 100) / 100;
}

function latestQuoteIds(quotes: PriceQuote[]): Set<string> {
  const seen = new Set<string>();
  const ids = new Set<string>();
  const ordered = [...quotes].sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : a.capturedAt > b.capturedAt ? -1 : 0));
  for (const quote of ordered) {
    if (seen.has(quote.source)) continue;
    seen.add(quote.source);
    ids.add(quote.id);
  }
  return ids;
}

function sortQuotes(quotes: PriceQuote[], key: QuoteSortKey, dir: "asc" | "desc"): PriceQuote[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...quotes].sort((a, b) => factor * compareQuotes(a, b, key));
}

function compareQuotes(a: PriceQuote, b: PriceQuote, key: QuoteSortKey): number {
  switch (key) {
    case "captured":
      return a.capturedAt < b.capturedAt ? -1 : a.capturedAt > b.capturedAt ? 1 : 0;
    case "price":
      return a.price - b.price;
    case "qty":
      return (a.qty ?? -1) - (b.qty ?? -1);
    case "source":
      return QUOTE_SOURCE_LABELS[a.source].localeCompare(QUOTE_SOURCE_LABELS[b.source]);
    case "condition":
      return a.condition.localeCompare(b.condition);
    case "seller":
      return sellerLabel(a).localeCompare(sellerLabel(b));
  }
}
