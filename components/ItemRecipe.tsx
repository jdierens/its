"use client";

import { useEffect, useState } from "react";
import { loadKitRecipe, saveKitRecipe, searchParts, type KitComponentView, type PartChoice } from "@/lib/kits";
import { errorText } from "@/lib/errors";
import { kitFieldDefaults, type KitChild } from "@/lib/kitRules";

type DraftRow = {
  key: string;
  componentItemId: string;
  sku: string;
  name: string;
  generic: boolean;
  qtyPerKit: string;
  notes: string;
  longCode: string | null;
  condition: string | null;
  eccn: string | null;
};

export function ItemRecipe({
  itemId,
  taxonomyCode,
  onApplyDefaults,
}: {
  itemId: string;
  taxonomyCode: string;
  onApplyDefaults: (condition: string | null, eccn: string | null) => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<PartChoice[]>([]);
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadKitRecipe(itemId)
      .then((loaded) => {
        if (cancelled) return;
        setRows(loaded.map(toDraft));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setChoices([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchParts(trimmed, null)
        .then((found) => {
          if (!cancelled) setChoices(found);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(errorText(err));
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  function addChoice(choice: PartChoice) {
    if (rows.some((row) => row.componentItemId === choice.id)) return;
    setRows((current) => [
      ...current,
      {
        key: choice.id,
        componentItemId: choice.id,
        sku: choice.sku,
        name: choice.name,
        generic: choice.generic,
        qtyPerKit: qty.trim() || "1",
        notes: "",
        longCode: choice.longCode,
        condition: choice.condition,
        eccn: choice.eccn,
      },
    ]);
    setQuery("");
    setChoices([]);
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await saveKitRecipe(
        itemId,
        rows.map((row) => ({
          componentItemId: row.componentItemId,
          qtyPerKit: Number(row.qtyPerKit),
          notes: row.notes,
        })),
      );
      const loaded = await loadKitRecipe(itemId);
      setRows(loaded.map(toDraft));
      setNotice("Recipe saved.");
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  function applyDefaults() {
    const children: KitChild[] = rows.map((row) => ({
      id: row.componentItemId,
      longCode: row.longCode,
      condition: row.condition,
      eccn: row.eccn,
    }));
    const defaults = kitFieldDefaults(taxonomyCode, children);
    if (defaults.message && defaults.needsChoice && !defaults.condition) {
      setError(defaults.message);
      if (defaults.eccn) onApplyDefaults(null, defaults.eccn);
      return;
    }
    setError(defaults.message);
    onApplyDefaults(defaults.condition, defaults.eccn);
    setNotice("Defaults filled. You can still edit condition and ECCN.");
  }

  return (
    <section className="kit-panel" aria-label="Recipe">
      <p className="hint">
        Components are single parts. A bundle has one component. Names keep their slashes.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner">{notice}</p> : null}
      <div className="kit-table-wrap">
      <table className="kit-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Name</th>
            <th className="num">Qty</th>
            <th>Notes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>No components yet.</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key}>
                <td data-label="SKU">{row.sku}</td>
                <td data-label="Name">
                  {row.name} {row.generic ? <span className="code-badge">Generic</span> : null}
                </td>
                <td className="num" data-label="Qty">
                  <input
                    className="num"
                    aria-label={`Quantity for ${row.sku}`}
                    inputMode="numeric"
                    value={row.qtyPerKit}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((item) => (item.key === row.key ? { ...item, qtyPerKit: event.target.value } : item)),
                      )
                    }
                  />
                </td>
                <td data-label="Notes">
                  <input
                    aria-label={`Notes for ${row.sku}`}
                    value={row.notes}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((item) => (item.key === row.key ? { ...item, notes: event.target.value } : item)),
                      )
                    }
                  />
                </td>
                <td>
                  <button type="button" className="secondary" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
      <div className="kit-add">
        <label>
          Add component
          <input
            aria-label="Find a component"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="SKU or name"
          />
        </label>
        <label>
          Qty
          <input className="num" aria-label="Quantity per kit" inputMode="numeric" value={qty} onChange={(event) => setQty(event.target.value)} />
        </label>
      </div>
      {choices.length > 0 ? (
        <ul className="kit-choices">
          {choices.map((choice) => (
            <li key={choice.id}>
              <button type="button" className="secondary" onClick={() => addChoice(choice)}>
                {choice.sku} {choice.name}
                {choice.generic ? " · Generic" : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="kit-actions">
        <button type="button" onClick={() => void onSave()} disabled={saving}>
          {saving ? "Saving…" : "Save recipe"}
        </button>
        <button type="button" className="secondary" onClick={applyDefaults}>
          Apply kit defaults
        </button>
      </div>
    </section>
  );
}

function toDraft(row: KitComponentView): DraftRow {
  return {
    key: row.id,
    componentItemId: row.componentItemId,
    sku: row.sku,
    name: row.name,
    generic: row.generic,
    qtyPerKit: String(row.qtyPerKit),
    notes: row.notes,
    longCode: row.longCode,
    condition: row.condition,
    eccn: row.eccn,
  };
}
