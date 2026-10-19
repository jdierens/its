"use client";

import { useEffect, useMemo, useState } from "react";
import {
  planTaxonomyChange,
  replaceSkuShortCode,
  skuEmbedsShortCode,
  taxonomyChangeLabel,
  type TaxonomyFieldLink,
} from "@/lib/taxonomyChange";
import type { Taxonomy } from "@/lib/types";

function linksOf(taxonomy: Taxonomy | null): TaxonomyFieldLink[] {
  return (taxonomy?.attributes ?? []).map((attribute) => ({
    id: attribute.id,
    name: attribute.name,
    required: attribute.required,
    sortOrder: attribute.sortOrder,
  }));
}

export function ChangeTaxonomyDialog({
  taxonomies,
  current,
  values,
  sku,
  busy,
  onCancel,
  onConfirm,
}: {
  taxonomies: Taxonomy[];
  current: Taxonomy | null;
  values: { id: string; name: string; value: string }[];
  sku: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (choice: { taxonomyId: string; copyNotes: boolean; regenerateSku: boolean }) => void;
}) {
  const choices = taxonomies.filter((row) => row.id !== current?.id);
  const [taxonomyId, setTaxonomyId] = useState("");
  const [copyNotes, setCopyNotes] = useState(false);
  const [keepSku, setKeepSku] = useState(true);
  const next = choices.find((row) => row.id === taxonomyId) ?? null;
  const plan = useMemo(
    () =>
      next
        ? planTaxonomyChange(
            linksOf(current),
            linksOf(next),
            values.map((row) => ({ attributeId: row.id, name: row.name, value: row.value })),
          )
        : null,
    [current, next, values],
  );
  const fromCode = current?.shortCode ?? "";
  const toCode = next?.shortCode ?? "";
  const embeds = Boolean(next && fromCode && skuEmbedsShortCode(sku, fromCode));
  const nextSku = embeds ? replaceSkuShortCode(sku, fromCode, toCode) : sku;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="dialog-backdrop" onMouseDown={busy ? undefined : onCancel}>
      <div
        className="dialog wide taxonomy-change"
        role="dialog"
        aria-modal="true"
        aria-labelledby="taxonomy-change-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="taxonomy-change-title">Change taxonomy</h2>
        <p>
          {current
            ? `${current.name}${current.shortCode ? ` (${current.shortCode})` : ""} is the current taxonomy.`
            : "This item has no taxonomy yet."}{" "}
          Shared fields keep their values. Fields the new taxonomy does not use are removed when they have a value.
        </p>
        <label>
          New taxonomy
          <select
            aria-label="New taxonomy"
            value={taxonomyId}
            disabled={busy}
            onChange={(event) => {
              setTaxonomyId(event.target.value);
              setCopyNotes(false);
              setKeepSku(true);
            }}
          >
            <option value="">Choose a taxonomy</option>
            {choices.map((row) => (
              <option key={row.id} value={row.id}>
                {row.shortCode ? `${row.shortCode} — ${row.name}` : row.name}
              </option>
            ))}
          </select>
        </label>
        {plan && next ? (
          <>
            <h3>Fields kept</h3>
            {plan.kept.length === 0 ? (
              <p className="hint">No fields are shared with {next.name}.</p>
            ) : (
              <ul>
                {plan.kept.map((field) => (
                  <li key={field.id}>
                    {field.name}
                    {field.value ? `: ${field.value}` : " (no value)"}
                  </li>
                ))}
              </ul>
            )}
            <h3>Fields that will be lost</h3>
            {plan.lost.length === 0 ? (
              <p className="hint">No saved values will be removed.</p>
            ) : (
              <ul>
                {plan.lost.map((field) => (
                  <li key={field.id}>
                    {field.name}: {field.value}
                  </li>
                ))}
              </ul>
            )}
            <h3>New fields</h3>
            {plan.added.length === 0 ? (
              <p className="hint">{next.name} does not add any fields.</p>
            ) : (
              <ul>
                {plan.added.map((field) => (
                  <li key={field.id} className={field.required ? "is-required" : undefined}>
                    {field.name}
                    {field.value ? `: ${field.value}` : ": empty"}
                    {field.required ? <span className="required-flag">Required</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {plan.lost.length > 0 ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={copyNotes}
                  disabled={busy}
                  onChange={(event) => setCopyNotes(event.target.checked)}
                />
                Copy lost values to item notes
              </label>
            ) : null}
            {embeds ? (
              <fieldset className="sku-choice">
                <legend>SKU</legend>
                <p className="hint">
                  This SKU includes {fromCode}. Keep it if a label is already printed.
                </p>
                <label>
                  <input
                    type="radio"
                    name="sku-choice"
                    checked={keepSku}
                    disabled={busy}
                    onChange={() => setKeepSku(true)}
                  />
                  Keep {sku}
                </label>
                <label>
                  <input
                    type="radio"
                    name="sku-choice"
                    checked={!keepSku}
                    disabled={busy}
                    onChange={() => setKeepSku(false)}
                  />
                  Use {nextSku}
                </label>
              </fieldset>
            ) : null}
          </>
        ) : null}
        <div className="actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            disabled={!next || busy}
            onClick={() => {
              if (!next) return;
              onConfirm({ taxonomyId: next.id, copyNotes, regenerateSku: embeds && !keepSku });
            }}
          >
            {busy ? "Working…" : taxonomyChangeLabel(plan?.lost.length ?? 0)}
          </button>
        </div>
      </div>
    </div>
  );
}
