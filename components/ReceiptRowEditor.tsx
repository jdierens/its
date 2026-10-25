"use client";

import { FormEvent, useState } from "react";
import { errorText } from "@/lib/errors";
import { editReceipt, searchReceivingScan } from "@/lib/receivingActions";
import { receiptFlagsForPrep, receivePrepKind } from "@/lib/receivingLine";
import { receiptChangeSummary, receiptSearchQuery, scanSearchNote } from "@/lib/receivingScan";
import { originQtyInput, parseReceiptDate, type ReceivingEntry } from "@/lib/receivingSettings";
import type { LabelItem } from "@/lib/types";

function parseEditQty(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000000) return null;
  return parsed;
}

export function ReceiptRowEditor({
  entry,
  initials,
  onCancel,
  onSaved,
}: {
  entry: ReceivingEntry;
  initials: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [receivedOn, setReceivedOn] = useState(entry.receivedOn.slice(0, 10));
  const [project, setProject] = useState(entry.project ?? "");
  const [incomingTag, setIncomingTag] = useState(entry.incomingBin ?? "");
  const [origin, setOrigin] = useState(entry.originatingSystem ?? "");
  const [originQty, setOriginQty] = useState(entry.originQty == null ? "" : String(entry.originQty));
  const [sku, setSku] = useState(entry.sku);
  const [itemId, setItemId] = useState(entry.itemId);
  const [itemName, setItemName] = useState(entry.itemName);
  const [qty, setQty] = useState(String(entry.qty));
  const [comment, setComment] = useState(entry.comment ?? "");
  const [searchQuery, setSearchQuery] = useState(entry.searchQuery ?? "");
  const [shortCode, setShortCode] = useState(entry.shortCode);
  const [longCode, setLongCode] = useState(entry.longCode);
  const [taxonomyName, setTaxonomyName] = useState(entry.taxonomyName);
  const [cleaned, setCleaned] = useState(entry.cleaned === true);
  const [wiped, setWiped] = useState(entry.wiped === true);
  const [matches, setMatches] = useState<LabelItem[]>([]);
  const [lookupQuery, setLookupQuery] = useState("");
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(item: LabelItem, query: string) {
    setItemId(item.id);
    setSku(item.sku || item.name);
    setItemName(item.name);
    setShortCode(item.shortCode);
    setLongCode(item.longCode ?? null);
    setTaxonomyName(item.taxonomyName ?? null);
    setSearchQuery(query);
    setCleaned(false);
    setWiped(false);
    setMatches([]);
    setConfirming(false);
  }

  async function lookUpSku() {
    const query = sku.trim();
    if (!query) {
      setError("Enter a SKU, name, or description.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const result = await searchReceivingScan(query);
      const found = Boolean(result.exact || result.matches.length > 0);
      setLookupQuery(query);
      setScanNote(scanSearchNote({ token: result.token, tried: result.tried, found }));
      if (result.exact) {
        pick(result.exact, query);
        return;
      }
      if (result.matches.length === 1) {
        pick(result.matches[0], query);
        return;
      }
      setMatches(result.matches);
      if (result.matches.length === 0) setError("No items found");
    } catch (lookupError) {
      setError(errorText(lookupError));
    } finally {
      setSaving(false);
    }
  }

  async function save(confirmed: boolean) {
    if (!/^[A-Z]{2}$/.test(initials)) {
      setError("Operator initials must be 2 letters.");
      return;
    }
    let date = "";
    try {
      date = parseReceiptDate(receivedOn);
    } catch (dateError) {
      setError(errorText(dateError));
      return;
    }
    const parsedQty = parseEditQty(qty);
    if (parsedQty == null) {
      setError("Enter a whole number from 0 to 1000000.");
      return;
    }
    const originParsed = originQtyInput(originQty);
    if (!originParsed.ok) {
      setError("Originating system qty is a whole number from 0 to 1000000.");
      return;
    }
    if (!itemId) {
      setError("Choose an item.");
      return;
    }
    const summary = receiptChangeSummary({
      sku: entry.sku,
      nextSku: sku,
      qty: entry.qty,
      nextQty: parsedQty,
    });
    if (summary && !confirmed) {
      setConfirming(true);
      setError(null);
      return;
    }
    const prep = receivePrepKind({ shortCode, longCode, taxonomyName });
    const flags = receiptFlagsForPrep(prep, cleaned, wiped);
    setSaving(true);
    setError(null);
    try {
      await editReceipt({
        eventId: entry.id,
        receivedOn: date,
        project,
        incomingTag,
        origin,
        originQty: originParsed.qty,
        comment,
        qty: parsedQty,
        itemId,
        confirmed: Boolean(summary),
        cleaned: flags.cleaned,
        wiped: flags.wiped,
        searchQuery: receiptSearchQuery(searchQuery),
      });
      onSaved();
    } catch (saveError) {
      setError(errorText(saveError));
      setSaving(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void save(false);
  }

  const summary = receiptChangeSummary({
    sku: entry.sku,
    nextSku: sku,
    qty: entry.qty,
    nextQty: parseEditQty(qty) ?? entry.qty,
  });

  return (
    <form id="receipt-edit" className="receive-edit" onSubmit={onSubmit}>
      <div className="receive-edit-grid">
        <label htmlFor={`edit-date-${entry.id}`}>
          <span>Date</span>
          <input id={`edit-date-${entry.id}`} type="date" value={receivedOn} onChange={(event) => { setReceivedOn(event.target.value); setConfirming(false); }} />
        </label>
        <label htmlFor={`edit-initials-${entry.id}`}>
          <span>Initials</span>
          <input id={`edit-initials-${entry.id}`} className="initials" value={initials} readOnly required maxLength={2} autoCapitalize="characters" />
        </label>
        <label htmlFor={`edit-project-${entry.id}`}>
          <span>Project</span>
          <input id={`edit-project-${entry.id}`} value={project} autoComplete="off" onChange={(event) => { setProject(event.target.value); setConfirming(false); }} />
        </label>
        <label htmlFor={`edit-incoming-${entry.id}`}>
          <span>Incoming bin</span>
          <input id={`edit-incoming-${entry.id}`} value={incomingTag} autoComplete="off" onChange={(event) => { setIncomingTag(event.target.value); setConfirming(false); }} />
        </label>
        <label htmlFor={`edit-origin-${entry.id}`}>
          <span>Originating system</span>
          <input id={`edit-origin-${entry.id}`} value={origin} autoComplete="off" onChange={(event) => { setOrigin(event.target.value); setConfirming(false); }} />
        </label>
        <label htmlFor={`edit-origin-qty-${entry.id}`}>
          <span>Originating system qty</span>
          <input id={`edit-origin-qty-${entry.id}`} className="num-input" inputMode="numeric" value={originQty} autoComplete="off" onChange={(event) => { setOriginQty(event.target.value); setConfirming(false); }} />
        </label>
        <label htmlFor={`edit-search-${entry.id}`}>
          <span>Search</span>
          <input
            id={`edit-search-${entry.id}`}
            value={searchQuery}
            autoComplete="off"
            autoCapitalize="off"
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setConfirming(false);
            }}
          />
        </label>
        <label htmlFor={`edit-sku-${entry.id}`}>
          <span>SKU</span>
          <input
            id={`edit-sku-${entry.id}`}
            value={sku}
            autoComplete="off"
            autoCapitalize="off"
            onChange={(event) => {
              setSku(event.target.value);
              setItemId("");
              setShortCode(null);
              setLongCode(null);
              setTaxonomyName(null);
              setCleaned(false);
              setWiped(false);
              setConfirming(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void lookUpSku();
              }
            }}
          />
        </label>
        <label htmlFor={`edit-name-${entry.id}`}>
          <span>Item name</span>
          <input id={`edit-name-${entry.id}`} value={itemName} readOnly />
        </label>
        <label htmlFor={`edit-qty-${entry.id}`}>
          <span>Qty</span>
          <input id={`edit-qty-${entry.id}`} className="num-input" inputMode="numeric" value={qty} autoComplete="off" onChange={(event) => { setQty(event.target.value); setConfirming(false); }} />
        </label>
        {receivePrepKind({ shortCode, longCode, taxonomyName }) === "cleaned" ? (
          <label className="receive-prep" htmlFor={`edit-cleaned-${entry.id}`}>
            <span>Cleaned</span>
            <input
              id={`edit-cleaned-${entry.id}`}
              type="checkbox"
              checked={cleaned}
              onChange={(event) => {
                setCleaned(event.target.checked);
                setConfirming(false);
              }}
            />
          </label>
        ) : null}
        {receivePrepKind({ shortCode, longCode, taxonomyName }) === "wiped" ? (
          <label className="receive-prep" htmlFor={`edit-wiped-${entry.id}`}>
            <span>Wiped</span>
            <input
              id={`edit-wiped-${entry.id}`}
              type="checkbox"
              checked={wiped}
              onChange={(event) => {
                setWiped(event.target.checked);
                setConfirming(false);
              }}
            />
          </label>
        ) : null}
        <label className="wide" htmlFor={`edit-comment-${entry.id}`}>
          <span>Comment</span>
          <input id={`edit-comment-${entry.id}`} value={comment} autoComplete="off" onChange={(event) => { setComment(event.target.value); setConfirming(false); }} />
        </label>
      </div>
      {scanNote ? <p className="hint">{scanNote}</p> : null}
      {matches.length > 0 ? (
        <div className="receive-actions">
          {matches.map((match) => (
            <button key={match.id} type="button" className="secondary" onClick={() => pick(match, lookupQuery)}>
              {match.sku || match.name}
              {match.name ? ` · ${match.name}` : ""}
            </button>
          ))}
        </div>
      ) : null}
      {confirming && summary ? (
        <div id="receipt-edit-confirm" className="receive-confirm" role="alert">
          <p>{summary}</p>
          <p className="hint">Recorded as {initials}.</p>
        </div>
      ) : null}
      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="actions">
        {confirming && summary ? (
          <button type="button" disabled={saving} onClick={() => void save(true)}>
            {saving ? "Saving…" : "Confirm"}
          </button>
        ) : (
          <button type="submit" disabled={saving || !/^[A-Z]{2}$/.test(initials)}>
            {saving ? "Saving…" : "Save edit"}
          </button>
        )}
        <button type="button" className="secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="secondary" disabled={saving} onClick={() => void lookUpSku()}>
          Look up SKU
        </button>
      </div>
    </form>
  );
}
