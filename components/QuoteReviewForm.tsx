"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { QuoteReviewRelated } from "@/components/QuoteReviewRelated";
import { errorText } from "@/lib/errors";
import { formatMoney } from "@/lib/pricing/quotes";
import { saveQuoteReview, searchQuoteItems } from "@/lib/quoteReviewsServer";
import {
  QUOTE_CHANNELS,
  QUOTE_DECISIONS,
  QUOTE_DIRECTIONS,
  QUOTE_REVIEWS_PATH,
  QUOTE_STATUSES,
  bestCompetingUnit,
  blankQuoteLine,
  quoteExtension,
  type QuoteChoice,
  type QuoteItemHit,
  type QuoteLineDraft,
  type QuoteRelationView,
  type QuoteReviewDraft,
  type QuoteVendorOption,
} from "@/lib/quoteReviews";

type EditorLine = QuoteLineDraft & { hits: QuoteItemHit[]; findNote: string };

function toEditor(line: QuoteLineDraft): EditorLine {
  return { ...line, key: line.key || crypto.randomUUID(), hits: [], findNote: "" };
}

export function QuoteReviewForm({
  canEdit,
  draft,
  vendors,
  relations,
  choices,
}: {
  canEdit: boolean;
  draft: QuoteReviewDraft;
  vendors: QuoteVendorOption[];
  relations: QuoteRelationView[];
  choices: QuoteChoice[];
}) {
  const router = useRouter();
  const [header, setHeader] = useState(draft);
  const [lines, setLines] = useState<EditorLine[]>(() => (draft.lines.length > 0 ? draft.lines.map(toEditor) : [toEditor(blankQuoteLine())]));
  const [saving, setSaving] = useState(false);
  const [finding, setFinding] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  const dueWarning =
    header.dueOn && header.receivedOn && header.dueOn < header.receivedOn
      ? "Due date is before the received date. You can still save."
      : "";

  function patchLine(key: string, patch: Partial<EditorLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function onFind(line: EditorLine) {
    const query = line.partNumber.trim() || line.sku.trim() || line.itemName.trim();
    if (!query) {
      patchLine(line.key, { findNote: "Enter a part, SKU, or name to find an item.", hits: [] });
      return;
    }
    setFinding(line.key);
    setProblem("");
    try {
      const hits = await searchQuoteItems(query);
      patchLine(line.key, { hits, findNote: hits.length === 0 ? "No item matched. The part can stay unmatched." : "" });
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setFinding(null);
    }
  }

  function pickHit(line: EditorLine, hit: QuoteItemHit) {
    patchLine(line.key, {
      itemId: hit.id,
      sku: hit.sku || line.sku,
      itemName: hit.name || line.itemName,
      partNumber: line.partNumber || hit.partNumber,
      condition: line.condition || hit.condition,
      onHand: hit.onHand,
      lastBuy: hit.lastBuy,
      lastSell: hit.lastSell,
      hits: [],
      findNote: "",
    });
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setProblem("");
    setMessage("");
    setWarnings([]);
    try {
      const result = await saveQuoteReview(header.id, {
        reference: header.reference,
        counterpartyName: header.counterpartyName,
        vendorId: header.vendorId,
        channel: header.channel,
        direction: header.direction,
        status: header.status,
        receivedOn: header.receivedOn,
        dueOn: header.dueOn,
        currency: header.currency,
        notes: header.notes,
        lines: lines.map((line) => ({
          key: line.key,
          id: line.id,
          itemId: line.itemId,
          partNumber: line.partNumber,
          sku: line.sku,
          itemName: line.itemName,
          condition: line.condition,
          qty: line.qty,
          unitPrice: line.unitPrice,
          decision: line.decision,
          decisionNote: line.decisionNote,
          bids: line.bids.map((bid) => ({
            key: bid.key,
            id: bid.id,
            bidderName: bid.bidderName,
            unitPrice: bid.unitPrice,
            note: bid.note,
          })),
        })),
      });
      const next = result.lines.flatMap((saved) => {
        const current = lines.find((line) => line.key === saved.key);
        if (!current) return [];
        return [
          {
            ...current,
            id: saved.id,
            bids: current.bids
              .filter((bid) => bid.bidderName.trim() || bid.unitPrice.trim() || bid.note.trim())
              .map((bid) => {
                const match = saved.bids.find((item) => item.key === bid.key);
                return match ? { ...bid, id: match.id } : bid;
              }),
          },
        ];
      });
      setLines(next.length > 0 ? next : [toEditor(blankQuoteLine())]);
      setWarnings(result.warnings);
      setMessage("Saved.");
      if (!header.id) {
        router.push(`${QUOTE_REVIEWS_PATH}/${result.id}`);
        return;
      }
      setHeader((current) => ({ ...current, id: result.id }));
      router.refresh();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form onSubmit={onSave}>
        <p>
          <Link href={QUOTE_REVIEWS_PATH}>Back to quote reviews</Link>
        </p>
        {problem ? (
          <p className="banner error" role="alert">
            {problem}
          </p>
        ) : null}
        {message ? (
          <p className="banner ok" role="status">
            {message}
          </p>
        ) : null}
        {warnings.map((warning) => (
          <p className="banner warn" role="status" key={warning}>
            {warning}
          </p>
        ))}
        {!canEdit ? <p className="muted">You can view this quote. Editing is limited to admin and staff.</p> : null}
        <div className="card qr-related">
          <div className="qr-head">
            <label>
              List name
              <input
                value={header.reference}
                disabled={!canEdit}
                onChange={(event) => setHeader({ ...header, reference: event.target.value })}
              />
            </label>
            <label>
              Direction
              <select
                value={header.direction}
                disabled={!canEdit}
                onChange={(event) => setHeader({ ...header, direction: event.target.value })}
              >
                {QUOTE_DIRECTIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Channel
              <select
                value={header.channel}
                disabled={!canEdit}
                onChange={(event) => setHeader({ ...header, channel: event.target.value })}
              >
                {QUOTE_CHANNELS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={header.status} disabled={!canEdit} onChange={(event) => setHeader({ ...header, status: event.target.value })}>
                {QUOTE_STATUSES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Vendor
              <select
                value={header.vendorId}
                disabled={!canEdit}
                onChange={(event) => {
                  const vendorId = event.target.value;
                  const vendor = vendors.find((item) => item.id === vendorId);
                  setHeader((current) => ({
                    ...current,
                    vendorId,
                    counterpartyName: current.counterpartyName.trim() ? current.counterpartyName : vendor?.name ?? "",
                  }));
                }}
              >
                <option value="">No vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Contact name
              <input
                value={header.counterpartyName}
                disabled={!canEdit}
                onChange={(event) => setHeader({ ...header, counterpartyName: event.target.value })}
              />
            </label>
            <label>
              Received
              <input
                type="date"
                value={header.receivedOn}
                disabled={!canEdit}
                required
                onChange={(event) => setHeader({ ...header, receivedOn: event.target.value })}
              />
            </label>
            <label>
              Due
              <input
                type="date"
                value={header.dueOn}
                disabled={!canEdit}
                onChange={(event) => setHeader({ ...header, dueOn: event.target.value })}
              />
            </label>
            <label>
              Currency
              <input
                value={header.currency}
                disabled={!canEdit}
                maxLength={3}
                onChange={(event) => setHeader({ ...header, currency: event.target.value.toUpperCase() })}
              />
            </label>
            <label className="qr-notes">
              Notes
              <textarea
                rows={3}
                value={header.notes}
                disabled={!canEdit}
                onChange={(event) => setHeader({ ...header, notes: event.target.value })}
              />
            </label>
          </div>
          {dueWarning ? <p className="hint">{dueWarning}</p> : null}
          {header.vendorId ? (
            <p className="hint">
              Vendor record: <Link href={`/vendors/${header.vendorId}`}>{vendors.find((vendor) => vendor.id === header.vendorId)?.name || "Vendor"}</Link>
            </p>
          ) : null}
        </div>
        <div className="card qr-lines">
          <div className="qr-line-bar">
            <h2>Lines</h2>
            {canEdit ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => setLines((current) => [...current, toEditor(blankQuoteLine())])}
              >
                Add line
              </button>
            ) : null}
          </div>
          <p className="hint">Sheet and photo import is not on this page. An unmatched part number can stay on the line.</p>
          <div className="qr-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Part</th>
                  <th>SKU</th>
                  <th>Name</th>
                  <th>Condition</th>
                  <th className="num">Qty</th>
                  <th className="num">Our price</th>
                  <th className="num">Ext</th>
                  <th>Decision</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const best = bestCompetingUnit(line.bids);
                  return (
                    <LineRows
                      key={line.key}
                      line={line}
                      index={index}
                      canEdit={canEdit}
                      finding={finding === line.key}
                      best={best}
                      onPatch={(patch) => patchLine(line.key, patch)}
                      onFind={() => onFind(line)}
                      onPick={(hit) => pickHit(line, hit)}
                      onRemove={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        {canEdit ? (
          <p>
            <button className="button" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save quote"}
            </button>
          </p>
        ) : null}
      </form>
      {header.id ? (
        <QuoteReviewRelated
          eventId={header.id}
          canEdit={canEdit}
          currency={header.currency || "USD"}
          sourceDirection={header.direction}
          sourceChannel={header.channel}
          sourceReference={header.reference}
          vendors={vendors}
          relations={relations}
          choices={choices}
        />
      ) : null}
      <section className="card qr-related">
        <h2>Files</h2>
        <p className="muted">
          Files are not stored on a quote review. Purchase orders and sales orders keep their own PDFs. Creating a purchase
          order or estimate from this quote is not built yet.
        </p>
      </section>
    </>
  );
}

function LineRows({
  line,
  index,
  canEdit,
  finding,
  best,
  onPatch,
  onFind,
  onPick,
  onRemove,
}: {
  line: EditorLine;
  index: number;
  canEdit: boolean;
  finding: boolean;
  best: number | null;
  onPatch: (patch: Partial<EditorLine>) => void;
  onFind: () => void;
  onPick: (hit: QuoteItemHit) => void;
  onRemove: () => void;
}) {
  const number = index + 1;
  return (
    <>
      <tr>
        <td className="num" data-label="#">
          {number}
        </td>
        <td data-label="Part">
          <input
            aria-label={`Part for line ${number}`}
            value={line.partNumber}
            disabled={!canEdit}
            onChange={(event) => onPatch({ partNumber: event.target.value })}
          />
        </td>
        <td data-label="SKU">
          <input
            aria-label={`SKU for line ${number}`}
            value={line.sku}
            disabled={!canEdit}
            onChange={(event) => onPatch({ sku: event.target.value })}
          />
          {line.itemId ? (
            <Link href={`/items/${line.itemId}`}>{line.sku || "Item"}</Link>
          ) : null}
        </td>
        <td data-label="Name">
          <input
            aria-label={`Name for line ${number}`}
            value={line.itemName}
            disabled={!canEdit}
            onChange={(event) => onPatch({ itemName: event.target.value })}
          />
        </td>
        <td data-label="Condition">
          <input
            aria-label={`Condition for line ${number}`}
            value={line.condition}
            disabled={!canEdit}
            onChange={(event) => onPatch({ condition: event.target.value })}
          />
        </td>
        <td className="num" data-label="Qty">
          <input
            className="num"
            inputMode="decimal"
            aria-label={`Quantity for line ${number}`}
            value={line.qty}
            disabled={!canEdit}
            onChange={(event) => onPatch({ qty: event.target.value })}
          />
        </td>
        <td className="num" data-label="Our price">
          <input
            className="num"
            inputMode="decimal"
            aria-label={`Our price for line ${number}`}
            value={line.unitPrice}
            disabled={!canEdit}
            onChange={(event) => onPatch({ unitPrice: event.target.value })}
          />
        </td>
        <td className="num" data-label="Ext">
          <span>{quoteExtension(line.qty, line.unitPrice) || "—"}</span>
          {best != null ? <span className="qr-context">Best {formatMoney(best)}</span> : null}
        </td>
        <td data-label="Decision">
          <select
            aria-label={`Decision for line ${number}`}
            value={line.decision}
            disabled={!canEdit}
            onChange={(event) => onPatch({ decision: event.target.value })}
          >
            <option value="">—</option>
            {QUOTE_DECISIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </td>
        <td data-label="Note">
          <input
            aria-label={`Note for line ${number}`}
            value={line.decisionNote}
            disabled={!canEdit}
            onChange={(event) => onPatch({ decisionNote: event.target.value })}
          />
        </td>
        <td data-label="">
          {canEdit ? (
            <button type="button" className="button secondary" onClick={onRemove}>
              Remove
            </button>
          ) : null}
        </td>
      </tr>
      <tr>
        <td colSpan={11} data-label="">
          <div className="qr-side">
            {line.itemId ? (
              <p className="qr-context">
                On hand {line.onHand ?? "—"}. Last buy {line.lastBuy || "—"}. Last sell {line.lastSell || "—"}.
                {canEdit ? (
                  <button type="button" className="button secondary" onClick={() => onPatch({ itemId: "", onHand: null, lastBuy: "", lastSell: "" })}>
                    Unmatch
                  </button>
                ) : null}
              </p>
            ) : line.partNumber.trim() || line.sku.trim() ? (
              <p className="qr-context">Unmatched part.</p>
            ) : null}
            {canEdit ? (
              <button type="button" className="button secondary" disabled={finding} onClick={onFind}>
                {finding ? "Finding…" : "Find item"}
              </button>
            ) : null}
            {line.findNote ? <p className="hint">{line.findNote}</p> : null}
            {line.hits.length > 0 ? (
              <ul className="qr-hits">
                {line.hits.map((hit) => (
                  <li key={hit.id}>
                    <button type="button" onClick={() => onPick(hit)}>
                      {hit.sku || hit.partNumber || "Item"} · {hit.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="qr-bids">
              {line.bids.map((bid, bidIndex) => (
                <div className="qr-bid" key={bid.key}>
                  <input
                    aria-label={`Bidder ${bidIndex + 1} on line ${number}`}
                    placeholder="Bidder"
                    value={bid.bidderName}
                    disabled={!canEdit}
                    onChange={(event) =>
                      onPatch({
                        bids: line.bids.map((item) => (item.key === bid.key ? { ...item, bidderName: event.target.value } : item)),
                      })
                    }
                  />
                  <input
                    className="num"
                    inputMode="decimal"
                    aria-label={`Bid ${bidIndex + 1} on line ${number}`}
                    placeholder="Unit price"
                    value={bid.unitPrice}
                    disabled={!canEdit}
                    onChange={(event) =>
                      onPatch({
                        bids: line.bids.map((item) => (item.key === bid.key ? { ...item, unitPrice: event.target.value } : item)),
                      })
                    }
                  />
                  <input
                    aria-label={`Bid note ${bidIndex + 1} on line ${number}`}
                    placeholder="Note"
                    value={bid.note}
                    disabled={!canEdit}
                    onChange={(event) =>
                      onPatch({
                        bids: line.bids.map((item) => (item.key === bid.key ? { ...item, note: event.target.value } : item)),
                      })
                    }
                  />
                  {canEdit ? (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => onPatch({ bids: line.bids.filter((item) => item.key !== bid.key) })}
                    >
                      Remove bid
                    </button>
                  ) : null}
                </div>
              ))}
              {canEdit ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    onPatch({
                      bids: [...line.bids, { key: crypto.randomUUID(), id: "", bidderName: "", unitPrice: "", note: "" }],
                    })
                  }
                >
                  Add bid
                </button>
              ) : null}
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}
