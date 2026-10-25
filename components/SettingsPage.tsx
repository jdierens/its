"use client";

import { FormEvent, useEffect, useState } from "react";
import { INCOTERMS } from "@/lib/salesOrderDraft";
import { fetchEbayDraftDefaults, fetchSalesPaymentTerms, saveEbayDefaultIncoterms, saveEbayDefaultPaymentTerms } from "@/lib/ebayOrderDefaultsSettings";
import { saveEbayDefaultSalesRep } from "@/lib/ebaySalesRepSettings";
import { normalizeSalesRep } from "@/lib/ebaySalesRep";
import { fetchSalesWindowDays, saveSalesWindowDays } from "@/lib/itemPricing";
import { errorText } from "@/lib/errors";
import { fetchBinCounter, saveBinNextNumber } from "@/lib/binActions";
import { nextNumberError } from "@/lib/bins";
import { fetchBinLabelTemplates, fetchLabelTemplate, saveBinLabelTemplates, saveLabelTemplate } from "@/lib/labelActions";
import {
  BIN_LABEL_TEMPLATES,
  BIN_TEMPLATE_SETTINGS,
  DEFAULT_LABEL_TEMPLATE,
  emptyBinLabelTemplates,
  LABEL_TEMPLATES,
  type BinLabelTemplates,
  type LabelTemplateId,
} from "@/lib/labelTemplates";
import { parseWindowDays } from "@/lib/pricing/quotes";
import { PutawaySettings } from "@/components/PutawaySettings";

export function SettingsPage() {
  const [days, setDays] = useState("90");
  const [ebaySalesRep, setEbaySalesRep] = useState("MT");
  const [ebayPaymentTerms, setEbayPaymentTerms] = useState("Payment In Advance");
  const [ebayIncoterms, setEbayIncoterms] = useState("FOB");
  const [paymentTerms, setPaymentTerms] = useState<{ code: string; label: string }[]>([]);
  const [template, setTemplate] = useState<LabelTemplateId>(DEFAULT_LABEL_TEMPLATE);
  const [binTemplates, setBinTemplates] = useState<BinLabelTemplates>(emptyBinLabelTemplates);
  const [nextNumber, setNextNumber] = useState("20000");
  const [highestIssued, setHighestIssued] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [value, labelTemplate, binLabelTemplates, counter, ebayDefaults, termChoices] = await Promise.all([
          fetchSalesWindowDays(),
          fetchLabelTemplate(),
          fetchBinLabelTemplates(),
          fetchBinCounter(),
          fetchEbayDraftDefaults(),
          fetchSalesPaymentTerms(),
        ]);
        if (!cancelled) {
          setDays(String(value));
          setEbaySalesRep(ebayDefaults.salesRep);
          setEbayPaymentTerms(ebayDefaults.paymentTerms);
          setEbayIncoterms(ebayDefaults.incoterms);
          setPaymentTerms(termChoices);
          setTemplate(labelTemplate);
          setBinTemplates(binLabelTemplates);
          setNextNumber(String(counter.nextNumber));
          setHighestIssued(counter.highestIssued);
        }
      } catch (loadError) {
        if (!cancelled) setError(errorText(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseWindowDays(days);
    if (parsed == null) {
      setError("Enter a whole number of days from 1 to 3650.");
      setSaved(false);
      return;
    }
    if (!/^\d+$/.test(nextNumber.trim())) {
      setError("Next bin number must be a whole number of at least 1.");
      setSaved(false);
      return;
    }
    if (ebaySalesRep.trim() !== "" && !normalizeSalesRep(ebaySalesRep)) {
      setError("eBay sales rep is 2 letters.");
      setSaved(false);
      return;
    }
    if (paymentTerms.length > 0 && !paymentTerms.some((term) => term.code === ebayPaymentTerms)) {
      setError("Payment In Advance is not a payment term yet. Apply supabase/migrations/20261025120000_ebay_default_terms.sql.");
      setSaved(false);
      return;
    }
    const proposedNext = Number(nextNumber);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const counter = await fetchBinCounter();
      const refused = nextNumberError(proposedNext, counter.highestIssued);
      if (refused) {
        setHighestIssued(counter.highestIssued);
        setError(refused);
        return;
      }
      const savedNext = await saveBinNextNumber(proposedNext);
      const savedRep = await saveEbayDefaultSalesRep(ebaySalesRep);
      const savedTerms = await saveEbayDefaultPaymentTerms(ebayPaymentTerms);
      const savedIncoterms = await saveEbayDefaultIncoterms(ebayIncoterms);
      await saveSalesWindowDays(parsed);
      await saveLabelTemplate(template);
      await saveBinLabelTemplates(binTemplates);
      setDays(String(parsed));
      setEbaySalesRep(savedRep);
      setEbayPaymentTerms(savedTerms);
      setEbayIncoterms(savedIncoterms);
      setNextNumber(String(savedNext));
      setHighestIssued(counter.highestIssued);
      setSaved(true);
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page settings-page desk-fields">
      <p className="page-note">App settings. These are not credentials.</p>
      {loading ? <p className="muted">Loading settings…</p> : null}
      <form onSubmit={onSubmit}>
        <label htmlFor="pricing-window">
          <span>Pricing/sales window (days)</span>
          <input
            id="pricing-window"
            className="num-input"
            value={days}
            inputMode="numeric"
            autoComplete="off"
            disabled={loading}
            onChange={(event) => {
              setDays(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <span className="hint">
          Item sales totals count buys and sells in this many days. The default is 90.
        </span>
        <label htmlFor="ebay-sales-rep">
          <span>eBay sales rep</span>
          <input
            id="ebay-sales-rep"
            className="ebay-sales-rep"
            value={ebaySalesRep}
            maxLength={2}
            autoCapitalize="characters"
            autoComplete="off"
            disabled={loading}
            onChange={(event) => {
              setEbaySalesRep(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2));
              setSaved(false);
            }}
          />
        </label>
        <span className="hint">
          New and pulled eBay drafts start with these initials. Two letters. An empty value stays MT.
        </span>
        <label htmlFor="ebay-payment-terms">
          <span>eBay payment terms</span>
          <select
            id="ebay-payment-terms"
            className="ebay-payment-terms"
            value={ebayPaymentTerms}
            disabled={loading}
            onChange={(event) => {
              setEbayPaymentTerms(event.target.value);
              setSaved(false);
            }}
          >
            {paymentTermOptions(paymentTerms, ebayPaymentTerms).map((term) => (
              <option key={term.code} value={term.code}>
                {term.label}
              </option>
            ))}
          </select>
        </label>
        <span className="hint">
          New and pulled eBay drafts use this when payment terms are empty. An empty value stays Payment In Advance.
        </span>
        <label htmlFor="ebay-incoterms">
          <span>eBay Incoterms</span>
          <select
            id="ebay-incoterms"
            className="ebay-incoterms"
            value={ebayIncoterms}
            disabled={loading}
            onChange={(event) => {
              setEbayIncoterms(event.target.value);
              setSaved(false);
            }}
          >
            {INCOTERMS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <span className="hint">
          New and pulled eBay drafts use this when Incoterms are empty. An empty value stays FOB.
        </span>
        <fieldset className="label-settings">
          <legend>Labels</legend>
          <label htmlFor="label-template">
            <span>Item</span>
            <select
              id="label-template"
              aria-label="Item label template"
              value={template}
              disabled={loading}
              onChange={(event) => {
                setTemplate(event.target.value as LabelTemplateId);
                setSaved(false);
              }}
            >
              {LABEL_TEMPLATES.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <span className="hint">
            Barcode (current) is the default 90 × 29 mm Code 128 label. QR code is the same size,
            with the SKU under the symbol. Print label on an item uses this choice.
          </span>
          {BIN_TEMPLATE_SETTINGS.map((setting) => (
            <div key={setting.key}>
              <label htmlFor={setting.key}>
                <span>{setting.label}</span>
                <select
                  id={setting.key}
                  aria-label={`${setting.label} label template`}
                  value={binTemplates[setting.type]}
                  disabled={loading}
                  onChange={(event) => {
                    const value = event.target.value as LabelTemplateId;
                    setBinTemplates((current) => ({ ...current, [setting.type]: value }));
                    setSaved(false);
                  }}
                >
                  {BIN_LABEL_TEMPLATES.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
          <span className="hint">
            Pallet, crate, and box labels are 90 × 29 mm. DDS + barcode is the default. The
            barcode is Code 128 of the reference, such as 10041-C, with DDS on the left and the
            reference on the right. The type word is not printed. DDS + QR encodes that same
            reference.
          </span>
          <div>
            <label htmlFor="label-template-location">
              <span>Rack location</span>
            </label>
            <p className="muted" id="label-template-location">
              Coming soon
            </p>
          </div>
        </fieldset>
        <label htmlFor="bin-next-number">
          <span>Next bin number</span>
          <input
            id="bin-next-number"
            className="num-input"
            value={nextNumber}
            inputMode="numeric"
            autoComplete="off"
            disabled={loading}
            onChange={(event) => {
              setNextNumber(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <span className="hint">
          {highestIssued == null
            ? "No bin number has been issued. The next number starts at 20000 and can be any whole number of at least 1."
            : `Highest issued number is ${highestIssued}. The next number must be higher than that.`}{" "}
          One counter covers pallets, crates, and boxes.
        </span>
        {error ? (
          <p className="banner error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="banner ok" role="status">
            Saved.
          </p>
        ) : null}
        <div className="actions">
          <button type="submit" disabled={loading || saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
      <PutawaySettings />
    </main>
  );
}

function paymentTermOptions(
  terms: { code: string; label: string }[],
  selected: string,
): { code: string; label: string }[] {
  if (!selected || terms.some((term) => term.code === selected)) return terms;
  return [...terms, { code: selected, label: selected }];
}
