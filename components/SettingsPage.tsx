"use client";

import { FormEvent, useEffect, useState } from "react";
import { fetchSalesWindowDays, saveSalesWindowDays } from "@/lib/itemPricing";
import { errorText } from "@/lib/errors";
import { fetchBinCounter, nextNumberError, saveBinNextNumber } from "@/lib/bins";
import {
  BIN_LABEL_TEMPLATES,
  BIN_TEMPLATE_SETTINGS,
  DEFAULT_LABEL_TEMPLATE,
  emptyBinLabelTemplates,
  fetchBinLabelTemplates,
  fetchLabelTemplate,
  LABEL_TEMPLATES,
  saveBinLabelTemplates,
  saveLabelTemplate,
  type BinLabelTemplates,
  type LabelTemplateId,
} from "@/lib/labelTemplates";
import { parseWindowDays } from "@/lib/pricing/quotes";

export function SettingsPage() {
  const [days, setDays] = useState("90");
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
        const [value, labelTemplate, binLabelTemplates, counter] = await Promise.all([
          fetchSalesWindowDays(),
          fetchLabelTemplate(),
          fetchBinLabelTemplates(),
          fetchBinCounter(),
        ]);
        if (!cancelled) {
          setDays(String(value));
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
      await saveSalesWindowDays(parsed);
      await saveLabelTemplate(template);
      await saveBinLabelTemplates(binTemplates);
      setDays(String(parsed));
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
    <main className="page">
      <p className="page-note">App settings. These are not credentials.</p>
      {loading ? <p className="muted">Loading settings…</p> : null}
      <form onSubmit={onSubmit}>
        <label htmlFor="pricing-window">Pricing/sales window (days)</label>
        <input
          id="pricing-window"
          value={days}
          inputMode="numeric"
          autoComplete="off"
          disabled={loading}
          onChange={(event) => {
            setDays(event.target.value);
            setSaved(false);
          }}
        />
        <span className="hint">
          Item sales totals count buys and sells in this many days. The default is 90.
        </span>
        <fieldset className="label-settings">
          <legend>Labels</legend>
          <label htmlFor="label-template">Item</label>
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
          <span className="hint">
            Barcode (current) is the default 90 × 29 mm Code 128 label. QR code is the same size,
            with the SKU under the symbol. Print label on an item uses this choice.
          </span>
          {BIN_TEMPLATE_SETTINGS.map((setting) => (
            <div key={setting.key}>
              <label htmlFor={setting.key}>{setting.label}</label>
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
            </div>
          ))}
          <span className="hint">
            Pallet, crate, and box labels are 90 × 29 mm. Big reference + barcode is the default.
            Big reference + QR encodes the bin reference, such as 20000-P. Pallet uses the bolder
            layout.
          </span>
        </fieldset>
        <label htmlFor="bin-next-number">Next bin number</label>
        <input
          id="bin-next-number"
          value={nextNumber}
          inputMode="numeric"
          autoComplete="off"
          disabled={loading}
          onChange={(event) => {
            setNextNumber(event.target.value);
            setSaved(false);
          }}
        />
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
    </main>
  );
}
