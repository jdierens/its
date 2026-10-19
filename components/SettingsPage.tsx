"use client";

import { FormEvent, useEffect, useState } from "react";
import { fetchSalesWindowDays, saveSalesWindowDays } from "@/lib/itemPricing";
import { errorText } from "@/lib/errors";
import {
  DEFAULT_LABEL_TEMPLATE,
  fetchLabelTemplate,
  LABEL_TEMPLATES,
  saveLabelTemplate,
  type LabelTemplateId,
} from "@/lib/labelTemplates";
import { parseWindowDays } from "@/lib/pricing/quotes";

export function SettingsPage() {
  const [days, setDays] = useState("90");
  const [template, setTemplate] = useState<LabelTemplateId>(DEFAULT_LABEL_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [value, labelTemplate] = await Promise.all([
          fetchSalesWindowDays(),
          fetchLabelTemplate(),
        ]);
        if (!cancelled) {
          setDays(String(value));
          setTemplate(labelTemplate);
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
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveSalesWindowDays(parsed);
      await saveLabelTemplate(template);
      setDays(String(parsed));
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
        <label htmlFor="label-template">Label template</label>
        <select
          id="label-template"
          aria-label="Label template"
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
