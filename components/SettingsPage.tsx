"use client";

import { FormEvent, useEffect, useState } from "react";
import { fetchSalesWindowDays, saveSalesWindowDays } from "@/lib/itemPricing";
import { errorText } from "@/lib/errors";
import {
  DEFAULT_LABEL_TEMPLATE,
  fetchLabelTemplate,
  LABEL_TYPES,
  saveLabelTemplate,
  TEMPLATES_BY_LABEL_TYPE,
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
        <h2>Labels</h2>
        <span className="hint">
          Each label type has its own template. Item labels print today. Pallet, crate, box, and
          rack location are next.
        </span>
        <div className="label-types">
          {LABEL_TYPES.map((type) => {
            const choices = TEMPLATES_BY_LABEL_TYPE[type.id];
            return (
              <div className="label-type" key={type.id}>
                <label htmlFor={`label-template-${type.id}`}>{type.label}</label>
                {type.ready ? (
                  <select
                    id={`label-template-${type.id}`}
                    aria-label={`${type.label} label template`}
                    value={template}
                    disabled={loading}
                    onChange={(event) => {
                      setTemplate(event.target.value as LabelTemplateId);
                      setSaved(false);
                    }}
                  >
                    {choices.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="muted" id={`label-template-${type.id}`}>
                    Coming soon
                  </p>
                )}
              </div>
            );
          })}
        </div>
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
