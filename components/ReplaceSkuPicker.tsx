"use client";

import { useEffect, useState } from "react";
import { errorText } from "@/lib/errors";
import { searchReplacementItems } from "@/lib/skuReplacementActions";
import { replacementProblem, type ReplacementChoice } from "@/lib/skuReplacement";

export type ReplacementHit = { id: string; sku: string; name: string };

export function ReplaceSkuPicker({
  plannedItemId,
  onChoose,
  onCancel,
}: {
  plannedItemId: string;
  onChoose: (hit: ReplacementHit, reason: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [hits, setHits] = useState<ReplacementHit[]>([]);
  const [picked, setPicked] = useState<ReplacementHit | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setHits([]);
      setNote(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPending(true);
      void searchReplacementItems(trimmed)
        .then((result) => {
          if (cancelled) return;
          if (!result.ok) {
            setHits([]);
            setNote(result.message);
            return;
          }
          const rows = result.hits.filter((hit) => hit.id !== plannedItemId);
          setHits(rows);
          setNote(rows.length === 0 ? "No matching product." : null);
        })
        .catch((error: unknown) => {
          if (!cancelled) setNote(errorText(error));
        })
        .finally(() => {
          if (!cancelled) setPending(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [plannedItemId, query]);

  function choose(hit: ReplacementHit) {
    const item: ReplacementChoice = { id: hit.id, itemType: "Product", generic: false };
    const problem = replacementProblem({
      context: "approval",
      settingOn: true,
      plannedItemId,
      currentActualItemId: null,
      nextItemId: hit.id,
      nextItem: item,
      pickedQty: 0,
      reason,
    });
    if (problem) {
      setNote(problem);
      setPicked(hit);
      return;
    }
    onChoose(hit, reason.trim());
  }

  return (
    <fieldset className="sku-replace">
      <legend>Replacement SKU</legend>
      <label>
        Find SKU
        <input
          aria-label="Find a replacement SKU"
          value={query}
          autoComplete="off"
          placeholder="SKU, part, or name"
          onChange={(event) => {
            setQuery(event.target.value);
            setPicked(null);
          }}
        />
      </label>
      <label>
        Reason
        <input aria-label="Replacement reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {pending ? <p className="hint">Searching…</p> : null}
      {note ? <p className="hint">{note}</p> : null}
      <ul className="kit-choices">
        {hits.map((hit) => (
          <li key={hit.id}>
            <button type="button" className={picked?.id === hit.id ? "" : "secondary"} onClick={() => choose(hit)}>
              {hit.sku}
              {hit.name ? ` ${hit.name}` : ""}
            </button>
          </li>
        ))}
      </ul>
      <div className="kit-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}
